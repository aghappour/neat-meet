// Shared types used across the server, transcription layer, and UI.

/** A single transcript segment produced by a transcription provider. */
export interface TranscriptSegment {
  /** Monotonic id within a session (server-assigned). */
  id: number;
  /** "me" = the local mic; "them" = far-end (meeting tab) audio. */
  speaker: "me" | "them" | "unknown";
  /**
   * Resolved human name for the speaker when known — e.g. from Google Meet
   * captions (via the companion extension). Absent for channel-only
   * (Whisper) segments, which fall back to the me/them label.
   */
  speakerName?: string;
  /** The recognized text. */
  text: string;
  /** True while the provider may still revise this segment. */
  interim: boolean;
  /** ms since session start when this segment began. */
  startMs: number;
  /** Wall-clock epoch ms when the segment was finalized (final only). */
  at: number;
  /** Where this segment came from: local Whisper, or Meet captions. */
  origin?: "whisper" | "meet";
}

/**
 * Non-spoken meeting context: chat messages, shared links/documents, and
 * snapshots of shared video frames (e.g. a slide). Kept alongside the transcript
 * and fed to the summary/insight prompts.
 */
export interface ContextItem {
  id: number;
  kind: "chat" | "doc" | "slide";
  /** Wall-clock epoch ms. */
  at: number;
  /** Chat author (chat only). */
  author?: string;
  /** Chat text, shared-doc title, or extracted slide content. */
  text: string;
  /** Link for a shared document / URL posted in chat. */
  url?: string;
}

// Audio framing over the WebSocket:
//  - Control messages are JSON strings (ClientAudioMessage / ServerAudioMessage).
//  - Audio is sent as BINARY frames, each prefixed with a single channel byte:
//      byte 0: 0x00 = "me" (local mic), 0x01 = "them" (meeting tab)
//      bytes 1..: little-endian Int16 PCM, mono, 16 kHz.
export const CHANNEL_BYTE = { me: 0x00, them: 0x01 } as const;

/** JSON control messages sent up the audio WebSocket (by the app or the extension). */
export type ClientAudioMessage =
  | { type: "start"; sessionId: string; sampleRate: number; profile: WhisperProfile }
  | { type: "stop" }
  // Sent by the Google Meet companion extension: a caption line with a real
  // speaker name. No sessionId — the server routes it to the active session.
  | {
      type: "caption";
      speaker: "me" | "them";
      speakerName: string;
      text: string;
      interim?: boolean;
    }
  // Sent by the Meet extension: a chat message (with an optional shared link).
  // No sessionId — routed to the active session, like captions.
  | { type: "chat"; author: string; text: string; url?: string };

/** Messages the server pushes down the audio WebSocket. */
export type ServerAudioMessage =
  | { type: "ready"; sessionId: string }
  | { type: "segment"; segment: TranscriptSegment }
  | { type: "context"; item: ContextItem }
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

/** One timestamped rolling-summary generation, retained for the history view. */
export interface SummaryVersion {
  at: number;
  summary: MeetingSummary;
  /** True when the transcript was capped for this run (token guard). */
  truncated?: boolean;
}

/** One timestamped insights generation, retained for the history view. */
export interface InsightsVersion {
  at: number;
  insights: Insight[];
  grounded: string[];
  /** True when the transcript was capped for this run (token guard). */
  truncated?: boolean;
}
