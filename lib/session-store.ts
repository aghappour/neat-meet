import type { RawSegment } from "@/lib/transcription/provider";
import type { ContextItem, TranscriptSegment } from "@/lib/types";

interface Session {
  id: string;
  createdAt: number;
  /** Finalized segments only, in arrival order. */
  segments: TranscriptSegment[];
  nextId: number;
  /** Non-spoken context: chat, shared docs/links, captured slides. */
  context: ContextItem[];
  nextContextId: number;
  /**
   * True once Google Meet captions (from the companion extension) start
   * flowing for this session. While true, the server suppresses duplicate
   * Whisper segments so the same words aren't transcribed twice.
   */
  captionDriven: boolean;
}

/** A user- or Meet-supplied override of a speaker's display name. */
export type SpeakerNames = Record<string, string>;

/**
 * In-memory, per-session transcript store. The custom server and Next's route
 * handlers run in the same process but are bundled separately, so we pin the Map
 * to `globalThis` to guarantee both see the *same* instance — the WebSocket relay
 * writes segments, the API routes read them for summary / insights. Ephemeral by
 * design: a meeting's transcript lives only for its session.
 */
const globalStore = globalThis as typeof globalThis & {
  __neatMeetSessions?: Map<string, Session>;
  /** The most recently started session — where extension captions are routed. */
  __neatMeetActiveSession?: string;
};
const sessions: Map<string, Session> =
  globalStore.__neatMeetSessions ?? (globalStore.__neatMeetSessions = new Map());

export function getOrCreateSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      createdAt: Date.now(),
      segments: [],
      nextId: 1,
      context: [],
      nextContextId: 1,
      captionDriven: false,
    };
    sessions.set(id, s);
  }
  return s;
}

/** Mark a session as the active one (last to send `start`). */
export function setActiveSession(id: string): void {
  globalStore.__neatMeetActiveSession = id;
  getOrCreateSession(id);
}

/** The session extension captions should be attributed to, if any. */
export function activeSessionId(): string | undefined {
  return globalStore.__neatMeetActiveSession;
}

export function isCaptionDriven(sessionId: string): boolean {
  return sessions.get(sessionId)?.captionDriven ?? false;
}

/**
 * Assign a monotonic id to a raw segment. Finalized segments are retained for
 * summary/insights; interim segments get an id (for live UI reconciliation) but
 * are not stored.
 */
export function recordSegment(sessionId: string, raw: RawSegment): TranscriptSegment {
  const s = getOrCreateSession(sessionId);
  const segment: TranscriptSegment = { ...raw, id: s.nextId++ };
  if (!segment.interim) s.segments.push(segment);
  return segment;
}

/**
 * Record a caption line from the Meet extension against the active session.
 * Flips the session into caption-driven mode. Returns the stored segment and
 * its session id, or null when there is no active session to attribute it to.
 */
export function recordCaption(caption: {
  speaker: "me" | "them";
  speakerName: string;
  text: string;
  interim?: boolean;
}): { sessionId: string; segment: TranscriptSegment } | null {
  const sessionId = activeSessionId();
  if (!sessionId) return null;
  const s = getOrCreateSession(sessionId);
  s.captionDriven = true;
  const segment = recordSegment(sessionId, {
    speaker: caption.speaker,
    speakerName: caption.speakerName,
    text: caption.text,
    interim: caption.interim ?? false,
    startMs: Date.now() - s.createdAt,
    at: Date.now(),
    origin: "meet",
  });
  return { sessionId, segment };
}

const URL_RE = /\bhttps?:\/\/[^\s]+/i;

/** Store a context item against a session, assigning a monotonic id. */
function addContext(sessionId: string, item: Omit<ContextItem, "id">): ContextItem {
  const s = getOrCreateSession(sessionId);
  const stored: ContextItem = { ...item, id: s.nextContextId++ };
  s.context.push(stored);
  return stored;
}

/**
 * Record a Meet chat message against the active session. A URL in the text is
 * pulled out as a shared document; otherwise it's a plain chat item. Returns the
 * stored item and session id, or null when there is no active session.
 */
export function recordChat(chat: {
  author: string;
  text: string;
  url?: string;
}): { sessionId: string; item: ContextItem } | null {
  const sessionId = activeSessionId();
  if (!sessionId) return null;
  const url = chat.url ?? chat.text.match(URL_RE)?.[0];
  const item = addContext(sessionId, {
    kind: url ? "doc" : "chat",
    at: Date.now(),
    author: chat.author,
    text: chat.text,
    url,
  });
  return { sessionId, item };
}

/** Record extracted content from a shared video frame (slide) against a session. */
export function addSlideContext(sessionId: string, text: string): ContextItem {
  return addContext(sessionId, { kind: "slide", at: Date.now(), text });
}

/**
 * A prompt block summarizing non-spoken context (chat, shared docs, slides).
 * Empty string when there's nothing, so callers can append unconditionally.
 */
export function contextText(sessionId: string, maxChars?: number): string {
  const s = sessions.get(sessionId);
  if (!s || s.context.length === 0) return "";
  const lines = s.context.map((c) => {
    if (c.kind === "slide") return `[shared slide] ${c.text}`;
    if (c.kind === "doc") return `[shared doc] ${c.author ? `${c.author}: ` : ""}${c.text}`;
    return `[chat] ${c.author ?? "Someone"}: ${c.text}`;
  });
  let text = lines.join("\n");
  if (maxChars && text.length > maxChars) {
    text = `[…earlier shared context omitted…]\n${text.slice(text.length - maxChars)}`;
  }
  return text;
}

/** Full transcript as speaker-attributed lines, honoring name overrides. */
export function transcriptText(sessionId: string, names?: SpeakerNames): string {
  const s = sessions.get(sessionId);
  if (!s) return "";
  return s.segments.map((seg) => `${displayName(seg, names)}: ${seg.text}`).join("\n");
}

/** The trailing `maxChars` of the transcript — used for the insight window. */
export function recentTranscript(sessionId: string, maxChars = 4000, names?: SpeakerNames): string {
  const full = transcriptText(sessionId, names);
  return full.length <= maxChars ? full : full.slice(full.length - maxChars);
}

/**
 * The transcript, bounded to `maxChars` to keep per-call token cost predictable
 * on long meetings. Keeps the most recent portion (aligned to a line boundary)
 * and prepends a marker when anything was dropped. `truncated` lets callers note
 * the trim in the UI.
 */
export function cappedTranscript(
  sessionId: string,
  maxChars: number,
  names?: SpeakerNames,
): { text: string; truncated: boolean } {
  const full = transcriptText(sessionId, names);
  if (full.length <= maxChars) return { text: full, truncated: false };
  const tail = full.slice(full.length - maxChars);
  const nl = tail.indexOf("\n");
  const clean = nl >= 0 ? tail.slice(nl + 1) : tail; // don't start mid-line
  return { text: `[…earlier transcript omitted to bound cost…]\n${clean}`, truncated: true };
}

export function hasContent(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  return s.segments.length > 0 || s.context.length > 0;
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
  if (globalStore.__neatMeetActiveSession === sessionId) {
    globalStore.__neatMeetActiveSession = undefined;
  }
}

/**
 * Resolve a segment's display name. Precedence: a user override keyed by the
 * speaker's own name, then an override keyed by the channel (me/them), then the
 * segment's Meet-supplied name, then the channel default.
 */
function displayName(seg: TranscriptSegment, names?: SpeakerNames): string {
  if (names) {
    if (seg.speakerName && names[seg.speakerName]) return names[seg.speakerName];
    if (names[seg.speaker]) return names[seg.speaker];
  }
  if (seg.speakerName) return seg.speakerName;
  return seg.speaker === "me" ? "Me" : seg.speaker === "them" ? "Participant" : "Speaker";
}
