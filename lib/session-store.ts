import type { RawSegment } from "@/lib/transcription/provider";
import type { TranscriptSegment } from "@/lib/types";

interface Session {
  id: string;
  createdAt: number;
  /** Finalized segments only, in arrival order. */
  segments: TranscriptSegment[];
  nextId: number;
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
    s = { id, createdAt: Date.now(), segments: [], nextId: 1, captionDriven: false };
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

export function hasContent(sessionId: string): boolean {
  return (sessions.get(sessionId)?.segments.length ?? 0) > 0;
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
