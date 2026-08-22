import { WebSocket } from "ws";
import type {
  ErrorHandler,
  ProviderConfig,
  SegmentHandler,
  TranscriptionProvider,
} from "./provider";

type Channel = "me" | "them";

/**
 * Streams audio to the local faster-whisper sidecar. Opens one sidecar
 * connection per channel so "me" (mic) and "them" (meeting tab) transcribe
 * independently and carry their own speaker label.
 */
export class WhisperProvider implements TranscriptionProvider {
  private readonly config: ProviderConfig;
  private readonly sockets: Record<Channel, WebSocket | null> = { me: null, them: null };
  private readonly ready: Record<Channel, boolean> = { me: false, them: false };
  private readonly pending: Record<Channel, Buffer[]> = { me: [], them: [] };
  private segmentCb: SegmentHandler = () => {};
  private errorCb: ErrorHandler = () => {};
  private stopped = false;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  onSegment(cb: SegmentHandler): void {
    this.segmentCb = cb;
  }

  onError(cb: ErrorHandler): void {
    this.errorCb = cb;
  }

  async start(): Promise<void> {
    await Promise.all([this.openChannel("me"), this.openChannel("them")]);
  }

  private openChannel(channel: Channel): Promise<void> {
    return new Promise((resolve) => {
      const ws = new WebSocket(this.config.sidecarUrl);
      this.sockets[channel] = ws;

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "config", profile: this.config.profile }));
      });

      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        let msg: { type?: string; text?: string; interim?: boolean; startMs?: number; message?: string };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (msg.type === "ready") {
          this.ready[channel] = true;
          // Flush any audio that arrived before the sidecar was ready.
          for (const buf of this.pending[channel]) ws.send(buf);
          this.pending[channel] = [];
          resolve();
          return;
        }
        if (msg.type === "segment" && typeof msg.text === "string") {
          this.segmentCb({
            speaker: channel,
            text: msg.text,
            interim: Boolean(msg.interim),
            startMs: msg.startMs ?? 0,
            at: Date.now(),
          });
          return;
        }
        if (msg.type === "error") {
          this.errorCb(new Error(`whisper sidecar (${channel}): ${msg.message ?? "unknown"}`));
        }
      });

      ws.on("error", (err) => {
        if (!this.stopped) {
          this.errorCb(
            new Error(
              `Cannot reach the Whisper sidecar at ${this.config.sidecarUrl}. ` +
                `Is it running? (${(err as Error).message})`,
            ),
          );
        }
        resolve(); // don't block start() forever on a dead channel
      });

      ws.on("close", () => {
        this.ready[channel] = false;
      });
    });
  }

  pushAudio(channel: Channel, pcm: Buffer): void {
    const ws = this.sockets[channel];
    if (ws && this.ready[channel] && ws.readyState === WebSocket.OPEN) {
      ws.send(pcm);
    } else {
      // Buffer until the sidecar signals ready (bounded to avoid unbounded growth).
      const queue = this.pending[channel];
      queue.push(pcm);
      if (queue.length > 400) queue.shift();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const channel of ["me", "them"] as Channel[]) {
      this.sockets[channel]?.close();
      this.sockets[channel] = null;
      this.pending[channel] = [];
    }
  }
}
