/**
 * The memory/context layer over the message archive: turns stored Signal +
 * WhatsApp messages into a compact, token-bounded text block an agent can drop
 * straight into a prompt. Same philosophy as the meeting token guard — keep the
 * newest lines, mark the trim, never blow the caller's budget.
 */
import { scrubPii } from "@/lib/redact";
import { messageStore } from "./store";
import type { MessageQuery, StoredMessage } from "./types";

/** Default budget for a context block (~4 chars ≈ 1 token, so ~2k tokens). */
const DEFAULT_MAX_CHARS = 8000;

export interface ContextOptions extends MessageQuery {
  maxChars?: number;
  /** Redact emails/phones/SSNs/cards/IPs locally before the text is handed out. */
  scrub?: boolean;
}

export interface MessageContext {
  /** Prompt-ready block; empty string when nothing matched. */
  text: string;
  /** Messages represented in the block (after any trim). */
  count: number;
  truncated: boolean;
}

function stamp(at: number): string {
  return new Date(at).toISOString().slice(0, 16).replace("T", " ");
}

/** One prompt line per message, e.g.
 *  `[signal] 2026-08-19 14:03 · Hiking · Bob: photos! [media: trail.jpg (image/jpeg)]` */
export function formatMessageLine(m: StoredMessage): string {
  const who = m.fromMe ? "Me" : (m.senderName ?? m.sender);
  const chat = m.chatName ?? m.chatId;
  const media = m.media
    .map((x) => ` [media: ${x.filename ?? x.id} (${x.contentType})]`)
    .join("");
  return `[${m.platform}] ${stamp(m.at)} · ${chat} · ${who}: ${m.text}${media}`;
}

/**
 * Build a bounded context block from the archive. Filters are the store's
 * search filters; the newest messages win when the budget trims.
 */
export function buildMessageContext(opts: ContextOptions = {}): MessageContext {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const matched = messageStore().search(opts);
  if (matched.length === 0) return { text: "", count: 0, truncated: false };

  const lines = matched.map(formatMessageLine);
  let count = matched.length;
  let truncated = false;
  let text = lines.join("\n");
  while (text.length > maxChars && count > 1) {
    truncated = true;
    lines.shift(); // drop the oldest whole line
    count--;
    text = lines.join("\n");
  }
  if (text.length > maxChars) {
    // A single enormous message: hard-cap it rather than exceed the budget.
    truncated = true;
    text = text.slice(text.length - maxChars);
  }
  if (truncated) text = `[…older messages omitted to bound cost…]\n${text}`;
  if (opts.scrub) text = scrubPii(text);
  return { text, count, truncated };
}

/** Parse a `since`/`until` query value: epoch ms, or anything Date can parse. */
export function parseWhen(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d{10,}$/.test(value)) return Number(value);
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}
