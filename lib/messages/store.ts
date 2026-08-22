/**
 * Local, disk-backed archive of Signal + WhatsApp messages.
 *
 * Storage is deliberately boring so it stays inspectable and portable:
 *   <MESSAGES_DIR>/messages.jsonl   one StoredMessage per line, append-only
 *   <MESSAGES_DIR>/media/<id>       attachment bytes, named by content hash
 *
 * Everything stays on this machine — nothing here talks to the network. The
 * archive is the substrate for the memory/context layer (lib/messages/memory.ts),
 * the HTTP API (/api/messages/*), and the agent-facing MCP server
 * (scripts/messages-mcp.ts).
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ChatSummary,
  IncomingMedia,
  IncomingMessage,
  MessageQuery,
  StoredMedia,
  StoredMessage,
} from "./types";

const DEFAULT_LIMIT = 100;

/** File extension for a media id, from its MIME type. Falls back to "bin". */
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

function extFor(contentType: string): string {
  return EXT_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()] ?? "bin";
}

export class MessageStore {
  private readonly dir: string;
  private readonly mediaDir: string;
  private readonly logPath: string;
  private messages: StoredMessage[] = [];
  private ids = new Set<string>();
  private loaded = false;

  constructor(dir: string) {
    this.dir = resolve(dir);
    this.mediaDir = join(this.dir, "media");
    this.logPath = join(this.dir, "messages.jsonl");
  }

  /** Read the JSONL log into memory once; later ingests keep both in sync. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    mkdirSync(this.mediaDir, { recursive: true });
    if (!existsSync(this.logPath)) return;
    for (const line of readFileSync(this.logPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as StoredMessage;
        if (msg.id && !this.ids.has(msg.id)) {
          this.ids.add(msg.id);
          this.messages.push(msg);
        }
      } catch {
        // A torn line (crash mid-append) loses that one message, never the log.
      }
    }
    this.messages.sort((a, b) => a.at - b.at);
  }

  /**
   * Persist one normalized message (and its media bytes). Returns the stored
   * row, or null when this platform message id was already archived — ingest is
   * idempotent so webhook retries and daemon reconnects can't duplicate.
   */
  ingest(incoming: IncomingMessage): StoredMessage | null {
    this.load();
    const id = `${incoming.platform}:${incoming.externalId}`;
    if (this.ids.has(id)) return null;

    const media: StoredMedia[] = [];
    for (const m of incoming.media ?? []) {
      const saved = this.saveMedia(m);
      if (saved) media.push(saved);
    }

    const msg: StoredMessage = {
      id,
      platform: incoming.platform,
      chatId: incoming.chatId,
      chatName: incoming.chatName,
      sender: incoming.sender,
      senderName: incoming.senderName,
      fromMe: incoming.fromMe,
      at: incoming.at,
      text: incoming.text,
      media,
      ingestedAt: Date.now(),
    };
    this.ids.add(id);
    this.messages.push(msg);
    appendFileSync(this.logPath, JSON.stringify(msg) + "\n");
    return msg;
  }

  /** Write media bytes under a content-hash name (identical files stored once). */
  private saveMedia(m: IncomingMedia): StoredMedia | null {
    let data = m.data;
    if (!data && m.sourcePath) {
      if (!existsSync(m.sourcePath)) return null;
      data = readFileSync(m.sourcePath);
    }
    if (!data || data.length === 0) return null;
    const id = `${createHash("sha256").update(data).digest("hex").slice(0, 24)}.${extFor(m.contentType)}`;
    const path = join(this.mediaDir, id);
    if (!existsSync(path)) {
      if (m.sourcePath && !m.data) copyFileSync(m.sourcePath, path);
      else writeFileSync(path, data);
    }
    return { id, contentType: m.contentType, filename: m.filename, size: data.length };
  }

  /**
   * Absolute path of a stored media file, or null if unknown. Only hash-named
   * ids are accepted, so a crafted id can never escape the media directory.
   */
  mediaPath(id: string): string | null {
    if (!/^[0-9a-f]{24}\.[a-z0-9]{2,4}$/.test(id)) return null;
    const path = join(this.mediaDir, id);
    return existsSync(path) ? path : null;
  }

  /** Filter the archive; results are chronological, keeping the newest `limit`. */
  search(query: MessageQuery = {}): StoredMessage[] {
    this.load();
    const q = query.q?.toLowerCase();
    const chat = query.chat?.toLowerCase();
    const matches = this.messages.filter((m) => {
      if (query.platform && m.platform !== query.platform) return false;
      if (chat && m.chatId.toLowerCase() !== chat && m.chatName?.toLowerCase() !== chat)
        return false;
      if (query.since && m.at < query.since) return false;
      if (query.until && m.at > query.until) return false;
      if (query.hasMedia && m.media.length === 0) return false;
      if (q) {
        const hay =
          `${m.text}\n${m.senderName ?? ""}\n${m.sender}\n${m.chatName ?? ""}\n${m.chatId}\n` +
          m.media.map((x) => x.filename ?? "").join("\n");
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const limit = query.limit ?? DEFAULT_LIMIT;
    return matches.length > limit ? matches.slice(matches.length - limit) : matches;
  }

  /** One row per conversation, most recently active first. */
  listChats(): ChatSummary[] {
    this.load();
    const byChat = new Map<string, ChatSummary>();
    for (const m of this.messages) {
      const key = `${m.platform}:${m.chatId}`;
      const cur = byChat.get(key);
      if (!cur) {
        byChat.set(key, {
          platform: m.platform,
          chatId: m.chatId,
          chatName: m.chatName,
          messageCount: 1,
          mediaCount: m.media.length,
          lastAt: m.at,
          lastText: m.text,
        });
      } else {
        cur.messageCount++;
        cur.mediaCount += m.media.length;
        if (m.chatName) cur.chatName = m.chatName;
        if (m.at >= cur.lastAt) {
          cur.lastAt = m.at;
          cur.lastText = m.text;
        }
      }
    }
    return [...byChat.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  count(): number {
    this.load();
    return this.messages.length;
  }
}

/** Where the archive lives; override with MESSAGES_DIR (default ./data/messages). */
export function messagesDir(): string {
  return process.env.MESSAGES_DIR || join(process.cwd(), "data", "messages");
}

/**
 * Process-wide store singleton. The custom server and Next's route handlers are
 * bundled separately, so (as with the session store) it's pinned to globalThis
 * to guarantee both sides share one instance and one in-memory index.
 */
const globalStore = globalThis as typeof globalThis & { __neatMeetMessages?: MessageStore };

export function messageStore(): MessageStore {
  return (globalStore.__neatMeetMessages ??= new MessageStore(messagesDir()));
}
