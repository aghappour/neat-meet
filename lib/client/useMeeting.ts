"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Insight,
  MeetingSummary,
  ServerAudioMessage,
  ShareTarget,
  TranscriptSegment,
  WhisperProfile,
} from "@/lib/types";

export type CaptureStatus = "idle" | "connecting" | "live" | "error";

interface MeetingState {
  status: CaptureStatus;
  error: string | null;
  /** Finalized transcript segments, in arrival order. */
  segments: TranscriptSegment[];
  /** Latest interim (not-yet-final) segment per speaker, for live display. */
  interims: Record<string, TranscriptSegment | undefined>;
  summary: MeetingSummary | null;
  summarizing: boolean;
  insights: Insight[];
  insightsLoading: boolean;
  /** Connector labels the last insight run was grounded in, e.g. ["Notion"]. */
  grounded: string[];
  /** Share targets a configured connector can actually deliver. */
  targets: ShareTarget[];
  profile: WhisperProfile;
}

const WS_PATH = "/api/audio";

export function useMeeting() {
  const [state, setState] = useState<MeetingState>({
    status: "idle",
    error: null,
    segments: [],
    interims: {},
    summary: null,
    summarizing: false,
    insights: [],
    insightsLoading: false,
    grounded: [],
    targets: [],
    // Default to the profile that keeps up on a CPU-only machine — `capable`
    // needs a CUDA GPU to hit its latency target.
    profile: "modest",
  });

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const sessionIdRef = useRef<string>("");

  const patch = useCallback((p: Partial<MeetingState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const setProfile = useCallback((profile: WhisperProfile) => patch({ profile }), [patch]);

  // Ask once which connectors are configured, so the share menu offers only
  // targets that can actually deliver. On failure we leave `targets` empty —
  // the UI then says nothing is configured rather than offering dead options.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/connectors")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { targets?: ShareTarget[] } | null) => {
        if (!cancelled && data?.targets) patch({ targets: data.targets });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [patch]);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    for (const stream of streamsRef.current) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamsRef.current = [];
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  const onServerMessage = useCallback((msg: ServerAudioMessage) => {
    if (msg.type === "ready") {
      patch({ status: "live" });
    } else if (msg.type === "segment") {
      const seg = msg.segment;
      setState((s) => {
        if (seg.interim) {
          return { ...s, interims: { ...s.interims, [seg.speaker]: seg } };
        }
        // Finalize: append and clear that speaker's interim.
        const interims = { ...s.interims };
        delete interims[seg.speaker];
        return { ...s, segments: [...s.segments, seg], interims };
      });
    } else if (msg.type === "error") {
      patch({ status: "error", error: msg.message });
    }
  }, [patch]);

  const start = useCallback(async () => {
    if (state.status === "live" || state.status === "connecting") return;
    // Each start mints a new sessionId, and the server numbers segments from 1
    // per session — so carrying the previous meeting's state over would collide
    // on segment id and blend two transcripts into one pane.
    patch({
      status: "connecting",
      error: null,
      segments: [],
      interims: {},
      summary: null,
      insights: [],
    });

    try {
      // 1. Capture mic + meeting-tab audio.
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Chrome requires a video track to be offered tab audio
        audio: true,
      });
      // We only want the tab's audio; drop the video track.
      for (const v of display.getVideoTracks()) v.stop();
      if (display.getAudioTracks().length === 0) {
        cleanup();
        patch({
          status: "error",
          error:
            'No tab audio captured. When the share picker opens, choose the meeting tab and tick "Share tab audio".',
        });
        return;
      }
      streamsRef.current = [mic, display];

      // 2. Build the 16 kHz audio graph with one PCM worklet per channel.
      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/pcm-worklet.js");

      // 3. Open the audio WebSocket.
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      const sessionId = crypto.randomUUID();
      sessionIdRef.current = sessionId;

      ws.onmessage = (ev) => {
        try {
          onServerMessage(JSON.parse(ev.data as string) as ServerAudioMessage);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onerror = () => patch({ status: "error", error: "Audio connection failed." });
      ws.onclose = () => {
        if (wsRef.current === ws) patch({ status: "idle" });
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        setTimeout(() => reject(new Error("WebSocket open timed out")), 8000);
      });

      ws.send(
        JSON.stringify({
          type: "start",
          sessionId,
          sampleRate: ctx.sampleRate,
          profile: state.profile,
        }),
      );

      // 4. Wire each source through its worklet node, tagging the channel byte.
      const silent = ctx.createGain();
      silent.gain.value = 0;
      silent.connect(ctx.destination);

      const wire = (stream: MediaStream, channel: "me" | "them") => {
        if (stream.getAudioTracks().length === 0) return;
        const src = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "pcm-worklet", {
          processorOptions: { channel },
        });
        node.port.onmessage = (e: MessageEvent<{ channel: string; pcm: ArrayBuffer }>) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const pcm = new Uint8Array(e.data.pcm);
          const frame = new Uint8Array(1 + pcm.byteLength);
          frame[0] = channel === "them" ? 1 : 0;
          frame.set(pcm, 1);
          ws.send(frame);
        };
        src.connect(node);
        node.connect(silent); // pull the graph without audible output
      };

      wire(mic, "me");
      wire(display, "them");
    } catch (err) {
      cleanup();
      patch({ status: "error", error: (err as Error).message });
    }
  }, [state.status, state.profile, patch, cleanup, onServerMessage]);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    cleanup();
    patch({ status: "idle" });
  }, [cleanup, patch]);

  const refreshSummary = useCallback(async () => {
    if (!sessionIdRef.current) return;
    patch({ summarizing: true });
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Summary failed");
      const summary = (await res.json()) as MeetingSummary;
      patch({ summary, summarizing: false });
    } catch (err) {
      patch({ summarizing: false, error: (err as Error).message });
    }
  }, [patch]);

  const refreshInsights = useCallback(async () => {
    if (!sessionIdRef.current) return;
    patch({ insightsLoading: true });
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Insights failed");
      const { insights, grounded } = (await res.json()) as {
        insights: Insight[];
        grounded?: string[];
      };
      patch({ insights, grounded: grounded ?? [], insightsLoading: false });
    } catch (err) {
      patch({ insightsLoading: false, error: (err as Error).message });
    }
  }, [patch]);

  const share = useCallback(
    async (insight: Insight, target: ShareTarget, destination: string) => {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ insight, target, destination }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Share failed");
      return (await res.json()) as { ok: true };
    },
    [],
  );

  return { state, setProfile, start, stop, refreshSummary, refreshInsights, share };
}
