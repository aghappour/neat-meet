// Shared types used across the server, transcription layer, and UI.

/** A single transcript segment produced by a transcription provider. */
export interface TranscriptSegment {
  /** Monotonic id within a session (server-assigned). */
  id: number;
  /** "me" = the local mic; "them" = far-end (meeting tab) audio. */
  speaker: "me" | "them" | "unknown";
  /** The recognized text. */
  text: string;
  /** True while the provider may still revise this segment. */
  interim: boolean;
  /** ms since session start when this segment began. */
  startMs: number;
  /** Wall-clock epoch ms when the segment was finalized (final only). */
  at: number;
}

// Audio framing over the WebSocket:
//  - Control messages are JSON strings (ClientAudioMessage / ServerAudioMessage).
//  - Audio is sent as BINARY frames, each prefixed with a single channel byte:
//      byte 0: 0x00 = "me" (local mic), 0x01 = "them" (meeting tab)
//      bytes 1..: little-endian Int16 PCM, mono, 16 kHz.
export const CHANNEL_BYTE = { me: 0x00, them: 0x01 } as const;

/** JSON control messages the browser sends up the audio WebSocket. */
export type ClientAudioMessage =
  | { type: "start"; sessionId: string; sampleRate: number; profile: WhisperProfile }
  | { type: "stop" };

/** Messages the server pushes down the audio WebSocket. */
export type ServerAudioMessage =
  | { type: "ready"; sessionId: string }
  | { type: "segment"; segment: TranscriptSegment }
  | { type: "error"; message: string };

export type WhisperProfile = "capable" | "modest";

/** A grounded insight card returned by /api/insights. */
export interface Insight {
  /** Short headline for the card. */
  title: string;
  /** One or two sentences the user could say or share. */
  insight: string;
  /** Where it came from, e.g. "Notion: Q3 Planning" or "Live discussion". */
  source: string;
  /** Optional deep link to the source document. */
  url?: string;
}

/** Structured rolling summary returned by /api/summary. */
export interface MeetingSummary {
  /** 1–3 sentence gist of the conversation so far. */
  gist: string;
  decisions: string[];
  openQuestions: string[];
  actionItems: string[];
}

/** Where a shared insight should be delivered. */
export type ShareTarget = "slack" | "notion" | "gmail" | "telegram";
