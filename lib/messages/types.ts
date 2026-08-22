// Shared types for the personal message archive (Signal + WhatsApp ingestion).

export type MessagePlatform = "signal" | "whatsapp";

/** A media file (image, voice note, video, document) attached to a message. */
export interface StoredMedia {
  /** Internal id — content hash + extension; also the filename in the media dir. */
  id: string;
  contentType: string;
  /** Original filename when the platform provided one. */
  filename?: string;
  /** Size in bytes of the stored file. */
  size: number;
}

/** One archived message, normalized across platforms. */
export interface StoredMessage {
  /** Globally unique: `${platform}:${externalId}`. Dedupe key across re-delivery. */
  id: string;
  platform: MessagePlatform;
  /** Stable conversation key: E.164 number, Signal group id, or WhatsApp chat id. */
  chatId: string;
  /** Human-readable conversation name when known (group name / contact name). */
  chatName?: string;
  /** Sender identifier (number / wa_id); "me" for messages you sent. */
  sender: string;
  senderName?: string;
  fromMe: boolean;
  /** Platform timestamp, epoch ms. */
  at: number;
  text: string;
  media: StoredMedia[];
  /** When this row was written locally, epoch ms. */
  ingestedAt: number;
}

/**
 * A message as produced by an ingest adapter (Signal SSE, WhatsApp webhook,
 * generic bridge), before the store assigns storage-level fields. Media arrives
 * as raw bytes (or a local file to copy) and is persisted by the store.
 */
export interface IncomingMessage {
  platform: MessagePlatform;
  /** Platform-native message id/timestamp used for dedupe. */
  externalId: string;
  chatId: string;
  chatName?: string;
  sender: string;
  senderName?: string;
  fromMe: boolean;
  at: number;
  text: string;
  media?: IncomingMedia[];
}

export interface IncomingMedia {
  contentType: string;
  filename?: string;
  /** Raw bytes (webhook downloads, bridge base64). */
  data?: Buffer;
  /** Or a local file to copy (signal-cli writes attachments to its own dir). */
  sourcePath?: string;
}

/** Search filters accepted by the store, the HTTP API, and the MCP tools. */
export interface MessageQuery {
  /** Case-insensitive substring over text, names, and chat ids. */
  q?: string;
  platform?: MessagePlatform;
  /** Match chatId exactly, or chatName case-insensitively. */
  chat?: string;
  /** Epoch ms bounds. */
  since?: number;
  until?: number;
  /** Only messages with attached media. */
  hasMedia?: boolean;
  /** Max results, newest kept (default 100). */
  limit?: number;
}

/** Aggregate view of one conversation, for browsing/agent orientation. */
export interface ChatSummary {
  platform: MessagePlatform;
  chatId: string;
  chatName?: string;
  messageCount: number;
  mediaCount: number;
  lastAt: number;
  lastText: string;
}
