import { WebSocket } from "ws";
import type {
  ErrorHandler,
  ProviderConfig,
  SegmentHandler,
  TranscriptionProvider,
} from "./provider";

type Channel = "me" | "them";

const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen" +
  "?encoding=linear16&sample_rate=16000&channels=1" +
  "&interim_results=true&punctuate=true&smart_format=true&model=nova-2";

/**
 * Optional drop-in transcription via Deepgram's streaming API. Lowest latency
 * and best accuracy, at ~$0.005/min. Same two-connection (per-channel) shape as
 * the Whisper provider so speaker labels come from the channel.
 */
export class DeepgramProvider implements TranscriptionProvider {
  private readonly apiKey: string;
  private readonly sockets: Record<Channel, WebSocket | null> = { me: null, them: null };
  private readonly startedAt = Date.now();
  private segmentCb: SegmentHandler = () => {};
  private errorCb: ErrorHandler = () => {};
  private stopped = false;

  constructor(config: ProviderConfig) {
    this.apiKey = config.deepgramApiKey ?? "";
  }

  onSegment(cb: SegmentHandler): void {
    this.segmentCb = cb;
  }

  onError(cb: ErrorHandler): void {
    this.errorCb = cb;
  }

  async start(): Promise<void> {
    await Promise.all([this.openChannel("me"), this.openChannel("them")]);
  }

  private openChannel(channel: Channel): Promise<void> {
    return new Promise((resolve) => {
      const ws = new WebSocket(DEEPGRAM_URL, {
        headers: { Authorization: `Token ${this.apiKey}` },
      });
      this.sockets[channel] = ws;

      ws.on("open", () => resolve());

      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        let msg: {
          channel?: { alternatives?: { transcript?: string }[] };
          is_final?: boolean;
          start?: number;
        };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim();
        if (!transcript) return;
        this.segmentCb({
          speaker: channel,
          text: transcript,
          interim: !msg.is_final,
          startMs: Math.round((msg.start ?? 0) * 1000),
          at: Date.now(),
        });
      });

      ws.on("error", (err) => {
        if (!this.stopped) {
          this.errorCb(new Error(`Deepgram (${channel}): ${(err as Error).message}`));
        }
        resolve();
      });
    });
  }

  pushAudio(channel: Channel, pcm: Buffer): void {
    const ws = this.sockets[channel];
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(pcm);
  }

  stop(): void {
    this.stopped = true;
    for (const channel of ["me", "them"] as Channel[]) {
      const ws = this.sockets[channel];
      // Deepgram expects a CloseStream control message to flush.
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        } catch {
          /* ignore */
        }
      }
      ws?.close();
      this.sockets[channel] = null;
    }
  }
}
