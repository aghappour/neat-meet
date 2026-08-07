import type { TranscriptSegment, WhisperProfile } from "@/lib/types";

/** A transcription result before the session assigns it a monotonic id. */
export type RawSegment = Omit<TranscriptSegment, "id">;
export type SegmentHandler = (seg: RawSegment) => void;
export type ErrorHandler = (err: Error) => void;

export interface ProviderConfig {
  profile: WhisperProfile;
  /** ws URL of the local faster-whisper sidecar, e.g. ws://127.0.0.1:8765 */
  sidecarUrl: string;
  /** Only used by the Deepgram provider. */
  deepgramApiKey?: string;
}

/**
 * A per-session transcription engine. The server feeds it channel-tagged PCM
 * (mic = "me", tab = "them") and receives transcript segments back. Speaker
 * attribution comes from the channel, so no diarization is required.
 */
export interface TranscriptionProvider {
  start(): Promise<void>;
  pushAudio(channel: "me" | "them", pcm: Buffer): void;
  stop(): void;
  onSegment(cb: SegmentHandler): void;
  onError(cb: ErrorHandler): void;
}

/** Selects the transcription provider from env / config. */
export async function createProvider(
  kind: "whisper" | "deepgram",
  config: ProviderConfig,
): Promise<TranscriptionProvider> {
  if (kind === "deepgram") {
    if (!config.deepgramApiKey) {
      throw new Error("TRANSCRIPTION_PROVIDER=deepgram but DEEPGRAM_API_KEY is not set");
    }
    const { DeepgramProvider } = await import("./deepgram");
    return new DeepgramProvider(config);
  }
  const { WhisperProvider } = await import("./whisper");
  return new WhisperProvider(config);
}
