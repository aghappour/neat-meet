/**
 * Custom Next.js server.
 *
 * Next route handlers don't cleanly host a long-lived WebSocket, so we boot Next
 * ourselves and attach a `ws` server on the same port at /api/audio. That socket
 * carries browser audio up and transcript segments down. In development we also
 * spawn the Python faster-whisper sidecar as a child process.
 */
import { createServer } from "node:http";
import { parse } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { createProvider, type TranscriptionProvider } from "./lib/transcription/provider";
import {
  recordSegment,
  recordCaption,
  recordChat,
  setActiveSession,
  isCaptionDriven,
} from "./lib/session-store";
import { CHANNEL_BYTE, type ClientAudioMessage, type WhisperProfile } from "./lib/types";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const sidecarPort = process.env.WHISPER_SIDECAR_PORT ?? "8765";
const sidecarUrl = `ws://127.0.0.1:${sidecarPort}`;
const providerKind = (process.env.TRANSCRIPTION_PROVIDER ?? "whisper") as "whisper" | "deepgram";

const app = next({ dev });
const handle = app.getRequestHandler();

let sidecar: ChildProcess | null = null;

/**
 * Sockets watching each session. The app page opens one; the Google Meet
 * companion extension opens another (to push captions). When a caption arrives
 * on any socket we fan the resulting segment out to every socket watching the
 * active session, so the app's transcript updates even though the words came in
 * through the extension's connection.
 */
const liveSockets = new Map<string, Set<WebSocket>>();

function watch(sessionId: string, ws: WebSocket): void {
  let set = liveSockets.get(sessionId);
  if (!set) liveSockets.set(sessionId, (set = new Set()));
  set.add(ws);
}

function unwatch(ws: WebSocket): void {
  for (const [sessionId, set] of liveSockets) {
    set.delete(ws);
    if (set.size === 0) liveSockets.delete(sessionId);
  }
}

function broadcast(sessionId: string, msg: object): void {
  const set = liveSockets.get(sessionId);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

/**
 * Interpreter for the sidecar. The README has you install the dependencies into
 * `whisper-sidecar/.venv`, so prefer that over whatever bare `python3` happens
 * to be on PATH — a pyenv/conda shim without faster-whisper would otherwise die
 * on the import guard the moment the server starts.
 */
function sidecarPython(): string {
  if (process.env.WHISPER_PYTHON) return process.env.WHISPER_PYTHON;
  const venv = join(process.cwd(), "whisper-sidecar", ".venv", "bin", "python3");
  return existsSync(venv) ? venv : "python3";
}

/** Spawn the local Whisper sidecar (only when using the whisper provider). */
function startSidecar(): void {
  if (providerKind !== "whisper" || sidecar) return;
  const python = sidecarPython();
  console.log(`[sidecar] starting with ${python}`);
  sidecar = spawn(python, ["whisper-sidecar/main.py"], {
    stdio: "inherit",
    env: { ...process.env, WHISPER_SIDECAR_PORT: sidecarPort },
  });
  sidecar.on("exit", (code) => {
    console.warn(`[sidecar] exited with code ${code}`);
    sidecar = null;
  });
  sidecar.on("error", (err) => {
    console.error(
      `[sidecar] failed to start (${err.message}). Install it: pip install -r whisper-sidecar/requirements.txt`,
    );
  });
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url ?? "/", true));
  });

  const wss = new WebSocketServer({ noServer: true });
  // Next owns its own upgrades in development (the HMR / dev-overlay socket).
  // Destroying those breaks hot reload and suppresses the error overlay, so
  // anything that isn't our audio socket gets handed back to Next.
  const upgradeHandler = app.getUpgradeHandler();

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "");
    if (pathname === "/api/audio") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      // Don't let a rejected upgrade become an unhandled rejection.
      Promise.resolve(upgradeHandler(req, socket, head)).catch(() => socket.destroy());
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    let provider: TranscriptionProvider | null = null;
    let sessionId = "";

    const send = (msg: object) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.on("message", async (data, isBinary) => {
      // Binary frame: [channel byte][Int16 PCM...]
      if (isBinary) {
        if (!provider) return;
        const buf = data as Buffer;
        if (buf.length < 2) return;
        const channel = buf[0] === CHANNEL_BYTE.them ? "them" : "me";
        provider.pushAudio(channel, buf.subarray(1));
        return;
      }

      // JSON control message.
      let msg: ClientAudioMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.type === "start") {
        sessionId = msg.sessionId;
        setActiveSession(sessionId);
        watch(sessionId, ws);
        try {
          provider = await createProvider(providerKind, {
            profile: (msg.profile ?? "modest") as WhisperProfile,
            sidecarUrl,
            deepgramApiKey: process.env.DEEPGRAM_API_KEY,
          });
          provider.onSegment((raw) => {
            // Once Meet captions are flowing they are the source of truth; drop
            // Whisper output to avoid transcribing the same words twice.
            if (isCaptionDriven(sessionId)) return;
            const segment = recordSegment(sessionId, raw);
            send({ type: "segment", segment });
          });
          provider.onError((err) => send({ type: "error", message: err.message }));
          await provider.start();
          send({ type: "ready", sessionId });
        } catch (err) {
          send({ type: "error", message: (err as Error).message });
        }
      } else if (msg.type === "caption") {
        // From the Meet extension: attribute to the active session and fan out.
        const recorded = recordCaption({
          speaker: msg.speaker,
          speakerName: msg.speakerName,
          text: msg.text,
          interim: msg.interim,
        });
        if (recorded) broadcast(recorded.sessionId, { type: "segment", segment: recorded.segment });
      } else if (msg.type === "chat") {
        // From the Meet extension: a chat message / shared link.
        const recorded = recordChat({ author: msg.author, text: msg.text, url: msg.url });
        if (recorded) broadcast(recorded.sessionId, { type: "context", item: recorded.item });
      } else if (msg.type === "stop") {
        provider?.stop();
        provider = null;
      }
    });

    ws.on("close", () => {
      provider?.stop();
      provider = null;
      unwatch(ws);
    });
  });

  startSidecar();

  server.listen(port, () => {
    console.log(`> neat-meet ready on http://localhost:${port}`);
    console.log(`> transcription provider: ${providerKind}`);
  });
});

// Clean up the sidecar on exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    sidecar?.kill();
    process.exit(0);
  });
}
