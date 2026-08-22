/**
 * Signal message ingestion via the same LOCAL signal-cli linked-device bridge
 * used for sending (lib/signal.ts).
 *
 * signal-cli's HTTP daemon exposes incoming traffic as Server-Sent Events at
 * /api/v1/events (each event is a JSON-RPC "receive" notification). We stream
 * that endpoint, normalize each envelope, and archive it in the message store.
 * Two envelope kinds carry content:
 *   - dataMessage           — a message someone sent you (direct or group)
 *   - syncMessage.sentMessage — a message YOU sent from your phone (synced to
 *     linked devices), so the archive holds both sides of every conversation.
 * Receipts, typing indicators, and other bookkeeping are ignored.
 *
 * Attachments: signal-cli has already written the bytes to its own data dir
 * (~/.local/share/signal-cli/attachments/<id>); we copy them into the archive's
 * media dir. Override the location with SIGNAL_ATTACHMENTS_DIR if your
 * signal-cli uses a custom data path.
 *
 * Everything stays on localhost. Enable with SIGNAL_INGEST=1 (plus the existing
 * SIGNAL_CLI_URL) — receiving is opt-in, separate from sending.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { messageStore } from "./store";
import type { IncomingMessage } from "./types";

interface SignalAttachment {
  contentType?: string;
  filename?: string | null;
  id?: string;
  /** Newer signal-cli versions include the absolute path directly. */
  file?: string;
  size?: number;
}

interface SignalGroupInfo {
  groupId?: string;
  groupName?: string;
}

interface SignalDataMessage {
  timestamp?: number;
  message?: string | null;
  attachments?: SignalAttachment[];
  groupInfo?: SignalGroupInfo;
}

export interface SignalEnvelope {
  source?: string;
  sourceNumber?: string | null;
  sourceName?: string | null;
  timestamp?: number;
  dataMessage?: SignalDataMessage;
  syncMessage?: {
    sentMessage?: SignalDataMessage & {
      destination?: string | null;
      destinationNumber?: string | null;
    };
  };
}

export function signalIngestEnabled(): boolean {
  const flag = process.env.SIGNAL_INGEST;
  return Boolean(process.env.SIGNAL_CLI_URL) && (flag === "1" || flag === "true");
}

function attachmentsDir(): string {
  return (
    process.env.SIGNAL_ATTACHMENTS_DIR ??
    join(homedir(), ".local", "share", "signal-cli", "attachments")
  );
}

/** The daemon's SSE endpoint, derived from the configured JSON-RPC URL. */
export function signalEventsUrl(rpcUrl: string, account?: string): string {
  const url = new URL(rpcUrl);
  url.pathname = url.pathname.replace(/\/rpc\/?$/, "/events");
  if (!url.pathname.endsWith("/events")) url.pathname = "/api/v1/events";
  if (account) url.searchParams.set("account", account);
  return url.toString();
}

/**
 * Normalize one signal-cli envelope into the archive's message shape.
 * Returns null for envelopes without content (receipts, typing, empty).
 * Pure aside from resolving attachment paths, so it's directly testable.
 */
export function normalizeSignalEnvelope(envelope: SignalEnvelope): IncomingMessage | null {
  const sent = envelope.syncMessage?.sentMessage;
  const data = sent ?? envelope.dataMessage;
  if (!data) return null;

  const text = data.message ?? "";
  const attachments = data.attachments ?? [];
  if (!text && attachments.length === 0) return null;

  const fromMe = Boolean(sent);
  const sourceNumber = envelope.sourceNumber ?? envelope.source ?? "unknown";
  const at = data.timestamp ?? envelope.timestamp ?? Date.now();
  const group = data.groupInfo?.groupId;
  const peer = fromMe ? (sent?.destinationNumber ?? sent?.destination ?? "unknown") : sourceNumber;

  const dir = attachmentsDir();
  return {
    platform: "signal",
    // A Signal message is identified by (sender, timestamp).
    externalId: `${fromMe ? "me" : sourceNumber}-${at}`,
    chatId: group ?? peer,
    chatName: data.groupInfo?.groupName ?? (fromMe ? undefined : (envelope.sourceName ?? undefined)),
    sender: fromMe ? "me" : sourceNumber,
    senderName: fromMe ? undefined : (envelope.sourceName ?? undefined),
    fromMe,
    at,
    text,
    media: attachments
      .filter((a) => a.file || a.id)
      .map((a) => ({
        contentType: a.contentType ?? "application/octet-stream",
        filename: a.filename ?? undefined,
        sourcePath: a.file ?? join(dir, a.id!),
      })),
  };
}

/** One SSE event may batch fields; we only care about `data:` payload lines. */
function* sseDataLines(buffer: string): Generator<string> {
  for (const raw of buffer.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("data:")) yield line.slice(5).trim();
  }
}

function handleEventData(json: string): void {
  let parsed: { method?: string; params?: { envelope?: SignalEnvelope } };
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  const envelope = parsed.params?.envelope ?? (parsed as { envelope?: SignalEnvelope }).envelope;
  if (!envelope) return;
  const normalized = normalizeSignalEnvelope(envelope);
  if (!normalized) return;
  const stored = messageStore().ingest(normalized);
  if (stored) {
    console.log(
      `[messages] signal: archived ${stored.fromMe ? "sent" : "received"} message in ${
        stored.chatName ?? stored.chatId
      }${stored.media.length ? ` (+${stored.media.length} media)` : ""}`,
    );
  }
}

let running = false;

/**
 * Long-running consumer of the daemon's event stream. Reconnects with backoff
 * (the daemon may not be up yet, or may restart) and never throws — ingest
 * problems are logged, not fatal to the meeting server hosting it.
 */
export function startSignalIngest(): void {
  if (running || !signalIngestEnabled()) return;
  running = true;
  const rpcUrl = process.env.SIGNAL_CLI_URL!;
  const url = signalEventsUrl(rpcUrl, process.env.SIGNAL_ACCOUNT);
  console.log(`[messages] signal ingest: streaming ${url}`);

  let backoffMs = 1000;
  const loop = async (): Promise<void> => {
    for (;;) {
      try {
        const res = await fetch(url, { headers: { accept: "text/event-stream" } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        backoffMs = 1000; // connected — reset backoff
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          // SSE events are separated by a blank line.
          const events = pending.split("\n\n");
          pending = events.pop() ?? "";
          for (const event of events) for (const data of sseDataLines(event)) handleEventData(data);
        }
        throw new Error("event stream ended");
      } catch (err) {
        console.warn(
          `[messages] signal ingest: ${(err as Error).message} — retrying in ${backoffMs / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 60_000);
      }
    }
  };
  void loop();
}
