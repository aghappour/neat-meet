import type { RawSegment } from "@/lib/transcription/provider";
import type { TranscriptSegment } from "@/lib/types";

interface Session {
  id: string;
  createdAt: number;
  /** Finalized segments only, in arrival order. */
  segments: TranscriptSegment[];
  nextId: number;
}

/**
 * In-memory, per-session transcript store. The custom server and Next's route
 * handlers run in the same process but are bundled separately, so we pin the Map
 * to `globalThis` to guarantee both see the *same* instance — the WebSocket relay
 * writes segments, the API routes read them for summary / insights. Ephemeral by
 * design: a meeting's transcript lives only for its session.
 */
const globalStore = globalThis as typeof globalThis & {
  __neatMeetSessions?: Map<string, Session>;
};
const sessions: Map<string, Session> =
  globalStore.__neatMeetSessions ?? (globalStore.__neatMeetSessions = new Map());

export function getOrCreateSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { id, createdAt: Date.now(), segments: [], nextId: 1 };
    sessions.set(id, s);
  }
  return s;
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

/** Full transcript as speaker-attributed lines. */
export function transcriptText(sessionId: string): string {
  const s = sessions.get(sessionId);
  if (!s) return "";
  return s.segments.map(formatLine).join("\n");
}

/** The trailing `maxChars` of the transcript — used for the insight window. */
export function recentTranscript(sessionId: string, maxChars = 4000): string {
  const full = transcriptText(sessionId);
  return full.length <= maxChars ? full : full.slice(full.length - maxChars);
}

export function hasContent(sessionId: string): boolean {
  return (sessions.get(sessionId)?.segments.length ?? 0) > 0;
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

function formatLine(seg: TranscriptSegment): string {
  const who = seg.speaker === "me" ? "Me" : seg.speaker === "them" ? "Participant" : "Speaker";
  return `${who}: ${seg.text}`;
}
