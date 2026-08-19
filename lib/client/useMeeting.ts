"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildMeetingMarkdown } from "@/lib/export";
import type {
  ContextItem,
  ExportTarget,
  Insight,
  InsightsVersion,
  MeetingSummary,
  ServerAudioMessage,
  ShareTarget,
  SummaryVersion,
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
  /** When on, the summary re-runs on an interval while the meeting is live. */
  autoSummary: boolean;
  /** Every summary generated this session, oldest first (latest is current). */
  summaryHistory: SummaryVersion[];
  insights: Insight[];
  insightsLoading: boolean;
  /** Connector labels the last insight run was grounded in, e.g. ["Notion"]. */
  grounded: string[];
  /** Every insights generation this session, oldest first. */
  insightHistory: InsightsVersion[];
  /** Share targets a configured connector can actually deliver. */
  targets: ShareTarget[];
  profile: WhisperProfile;
  /** User (or Meet) overrides of speaker display names, keyed by identity. */
  speakerNames: Record<string, string>;
  /** Every name ever assigned, remembered for quick-pick when renaming. */
  roster: string[];
  /** True once Google Meet captions (via the extension) are driving the transcript. */
  captionsActive: boolean;
  /** Non-spoken context: chat, shared docs, captured slides. */
  context: ContextItem[];
  /** True while a captured video frame is being sent to Claude for extraction. */
  capturingFrame: boolean;
  /** Privacy hold: no MCP connectors attached, sharing/export disabled. Per-meeting. */
  blockConnectors: boolean;
  /** Scrub PII (emails/phones/SSNs/cards/IPs) from text before it leaves for Claude. */
  scrubPii: boolean;
  /** Export targets a configured connector can save to ("markdown" always works). */
  exportTargets: Array<"notion" | "gdrive">;
  /** True while a Notion/Drive export is in flight. */
  exporting: boolean;
  /** Success detail from the last export, e.g. a link. */
  exportDetail: string | null;
}

const WS_PATH = "/api/audio";
/** How often the rolling summary re-runs while live (when there's new transcript). */
const SUMMARY_REFRESH_MS = 30_000;
/** localStorage key for speaker-name overrides, remembered across meetings. */
const SPEAKER_NAMES_KEY = "neatmeet.speakerNames";

function loadSpeakerNames(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SPEAKER_NAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveSpeakerNames(names: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SPEAKER_NAMES_KEY, JSON.stringify(names));
  } catch {
    /* storage full or unavailable — names just won't persist */
  }
}

/** localStorage key for the roster — every name ever assigned, for quick-pick. */
const ROSTER_KEY = "neatmeet.roster";

function loadRoster(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ROSTER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRoster(roster: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  } catch {
    /* ignore */
  }
}

export function useMeeting() {
  const [state, setState] = useState<MeetingState>({
    status: "idle",
    error: null,
    segments: [],
    interims: {},
    summary: null,
    summarizing: false,
    autoSummary: true,
    summaryHistory: [],
    insights: [],
    insightsLoading: false,
    grounded: [],
    insightHistory: [],
    speakerNames: {},
    roster: [],
    captionsActive: false,
    context: [],
    capturingFrame: false,
    blockConnectors: false,
    scrubPii: false,
    exportTargets: [],
    exporting: false,
    exportDetail: null,
    targets: [],
    // Default to the profile that keeps up on a CPU-only machine — `capable`
    // needs a CUDA GPU to hit its latency target.
    profile: "modest",
  });

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const sessionIdRef = useRef<string>("");
  // The tab's display stream, kept (video track alive) so we can grab a frame.
  const displayStreamRef = useRef<MediaStream | null>(null);
  // Refs the auto-refresh interval reads without re-subscribing each tick:
  // current final-segment count, whether a summary is already in flight, and
  // the count captured at the last summary request (to skip when nothing new).
  const segmentCountRef = useRef(0);
  const summarizingRef = useRef(false);
  const lastSummarizedCountRef = useRef(0);
  // Latest speaker-name overrides, mirrored for the stable refresh callbacks.
  const speakerNamesRef = useRef<Record<string, string>>({});
  // Latest summary, folded into the next summary call so it stays cumulative
  // even when the transcript is capped by the token guard.
  const latestSummaryRef = useRef<MeetingSummary | null>(null);
  // Server watermarks for delta summaries: only lines/context after these ids
  // are sent on the next call, keeping steady-state cost small and flat.
  const lastSummarizedSegmentIdRef = useRef<number | null>(null);
  const lastSummarizedContextIdRef = useRef<number>(0);
  // Privacy toggles, mirrored so the stable callbacks read the current values.
  const privacyRef = useRef({ blockConnectors: false, scrubPii: false });

  const patch = useCallback((p: Partial<MeetingState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const setProfile = useCallback((profile: WhisperProfile) => patch({ profile }), [patch]);
  const setAutoSummary = useCallback(
    (autoSummary: boolean) => patch({ autoSummary }),
    [patch],
  );

  const setBlockConnectors = useCallback(
    (blockConnectors: boolean) => {
      privacyRef.current = { ...privacyRef.current, blockConnectors };
      patch({ blockConnectors });
    },
    [patch],
  );
  const setScrubPii = useCallback(
    (scrubPii: boolean) => {
      privacyRef.current = { ...privacyRef.current, scrubPii };
      patch({ scrubPii });
    },
    [patch],
  );

  // Rename (or clear) a speaker. `identity` is the speaker's own name when known
  // (from Meet), else the channel key "me"/"them". A blank name clears the override.
  const setSpeakerName = useCallback(
    (identity: string, name: string) => {
      setState((s) => {
        const next = { ...s.speakerNames };
        const trimmed = name.trim();
        if (trimmed) next[identity] = trimmed;
        else delete next[identity];
        speakerNamesRef.current = next;
        saveSpeakerNames(next); // remember across meetings
        // Grow the roster with any newly-seen name, for quick-pick next time.
        let roster = s.roster;
        if (trimmed && !roster.includes(trimmed)) {
          roster = [...roster, trimmed];
          saveRoster(roster);
        }
        return { ...s, speakerNames: next, roster };
      });
    },
    [],
  );

  // Restore remembered speaker names once, after mount (client-only, so it
  // can't cause an SSR hydration mismatch).
  useEffect(() => {
    const saved = loadSpeakerNames();
    const roster = loadRoster();
    const p: Partial<MeetingState> = {};
    if (Object.keys(saved).length > 0) {
      speakerNamesRef.current = saved;
      p.speakerNames = saved;
    }
    if (roster.length > 0) p.roster = roster;
    if (Object.keys(p).length > 0) patch(p);
  }, [patch]);

  // Keep the interval's refs in step with render state (see the interval below).
  useEffect(() => {
    segmentCountRef.current = state.segments.length;
  }, [state.segments.length]);
  useEffect(() => {
    summarizingRef.current = state.summarizing;
  }, [state.summarizing]);

  // Ask once which connectors are configured, so the share menu offers only
  // targets that can actually deliver. On failure we leave `targets` empty —
  // the UI then says nothing is configured rather than offering dead options.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/connectors")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: { targets?: ShareTarget[]; exportTargets?: Array<"notion" | "gdrive"> } | null) => {
          if (cancelled || !data) return;
          patch({
            ...(data.targets ? { targets: data.targets } : {}),
            ...(data.exportTargets ? { exportTargets: data.exportTargets } : {}),
          });
        },
      )
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
    displayStreamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  const onServerMessage = useCallback((msg: ServerAudioMessage) => {
    if (msg.type === "ready") {
      patch({ status: "live" });
    } else if (msg.type === "segment") {
      const seg = msg.segment;
      const captionsActive = seg.origin === "meet";
      // Key interims by resolved speaker so two Meet speakers don't overwrite
      // each other's in-progress line (channel alone would collide).
      const interimKey = seg.speakerName ?? seg.speaker;
      setState((s) => {
        const captions = s.captionsActive || captionsActive;
        if (seg.interim) {
          return { ...s, captionsActive: captions, interims: { ...s.interims, [interimKey]: seg } };
        }
        // Finalize: append and clear that speaker's interim.
        const interims = { ...s.interims };
        delete interims[interimKey];
        return { ...s, captionsActive: captions, segments: [...s.segments, seg], interims };
      });
    } else if (msg.type === "context") {
      const item = msg.item;
      setState((s) => ({ ...s, context: [...s.context, item] }));
    } else if (msg.type === "error") {
      patch({ status: "error", error: msg.message });
    }
  }, [patch]);

  const start = useCallback(async () => {
    if (state.status === "live" || state.status === "connecting") return;
    // Each start mints a new sessionId, and the server numbers segments from 1
    // per session — so carrying the previous meeting's state over would collide
    // on segment id and blend two transcripts into one pane.
    lastSummarizedCountRef.current = 0;
    latestSummaryRef.current = null;
    lastSummarizedSegmentIdRef.current = null;
    lastSummarizedContextIdRef.current = 0;
    // Privacy toggles are per-meeting: each meeting starts from the defaults.
    privacyRef.current = { blockConnectors: false, scrubPii: false };
    // Speaker names are intentionally NOT reset — they persist across meetings.
    patch({
      status: "connecting",
      error: null,
      segments: [],
      interims: {},
      summary: null,
      summaryHistory: [],
      insights: [],
      grounded: [],
      insightHistory: [],
      captionsActive: false,
      context: [],
      capturingFrame: false,
      blockConnectors: false,
      scrubPii: false,
      exporting: false,
      exportDetail: null,
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
      // Keep the video track alive so "Capture slide" can grab a frame on
      // demand; we still only wire the audio into transcription.
      displayStreamRef.current = display;
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
    // Remember how much transcript this run covers, so auto-refresh can tell
    // whether anything new has been said since (and skip a redundant call).
    const requestCount = segmentCountRef.current;
    patch({ summarizing: true });
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          speakerNames: speakerNamesRef.current,
          previousSummary: latestSummaryRef.current ?? undefined,
          // Watermarks → the server sends only the delta since the last summary.
          afterSegmentId: lastSummarizedSegmentIdRef.current ?? undefined,
          afterContextId: lastSummarizedContextIdRef.current,
          scrubPii: privacyRef.current.scrubPii,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Summary failed");
      const { truncated, unchanged, lastSegmentId, lastContextId, ...summary } =
        (await res.json()) as MeetingSummary & {
          truncated?: boolean;
          unchanged?: boolean;
          lastSegmentId?: number;
          lastContextId?: number;
        };
      lastSummarizedCountRef.current = requestCount;
      latestSummaryRef.current = summary;
      if (typeof lastSegmentId === "number") lastSummarizedSegmentIdRef.current = lastSegmentId;
      if (typeof lastContextId === "number") lastSummarizedContextIdRef.current = lastContextId;
      setState((s) => ({
        ...s,
        summary,
        summarizing: false,
        // An unchanged echo (nothing new since last time) isn't a new version.
        summaryHistory: unchanged
          ? s.summaryHistory
          : [...s.summaryHistory, { at: Date.now(), summary, truncated }],
      }));
    } catch (err) {
      patch({ summarizing: false, error: (err as Error).message });
    }
  }, [patch]);

  // Auto-refresh the rolling summary while live. Fires on an interval but only
  // when new final segments have arrived since the last summary and none is
  // already in flight — so quiet stretches and slow responses don't stack calls.
  useEffect(() => {
    if (state.status !== "live" || !state.autoSummary) return;
    const id = setInterval(() => {
      if (summarizingRef.current) return;
      if (segmentCountRef.current <= lastSummarizedCountRef.current) return;
      void refreshSummary();
    }, SUMMARY_REFRESH_MS);
    return () => clearInterval(id);
  }, [state.status, state.autoSummary, refreshSummary]);

  const refreshInsights = useCallback(async () => {
    if (!sessionIdRef.current) return;
    patch({ insightsLoading: true });
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          speakerNames: speakerNamesRef.current,
          blockConnectors: privacyRef.current.blockConnectors,
          scrubPii: privacyRef.current.scrubPii,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Insights failed");
      const { insights, grounded, truncated } = (await res.json()) as {
        insights: Insight[];
        grounded?: string[];
        truncated?: boolean;
      };
      const g = grounded ?? [];
      setState((s) => ({
        ...s,
        insights,
        grounded: g,
        insightsLoading: false,
        insightHistory: [...s.insightHistory, { at: Date.now(), insights, grounded: g, truncated }],
      }));
    } catch (err) {
      patch({ insightsLoading: false, error: (err as Error).message });
    }
  }, [patch]);

  const share = useCallback(
    async (insight: Insight, target: ShareTarget, destination: string) => {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          insight,
          target,
          destination,
          blockConnectors: privacyRef.current.blockConnectors,
          scrubPii: privacyRef.current.scrubPii,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Share failed");
      return (await res.json()) as { ok: true };
    },
    [],
  );

  // Grab the current frame of the shared tab and send it to Claude to extract
  // its content (e.g. a slide) into the meeting context. Opt-in per capture —
  // this is the one path where an image (not just text) leaves the machine.
  const captureFrame = useCallback(async () => {
    const stream = displayStreamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track || !sessionIdRef.current) {
      patch({ error: "No shared video to capture — start a meeting and share the tab first." });
      return;
    }
    patch({ capturingFrame: true });
    const video = document.createElement("video");
    try {
      video.srcObject = new MediaStream([track]);
      video.muted = true;
      video.playsInline = true;
      await video.play();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const scale = Math.min(1, 1280 / Math.max(vw, vh)); // cap size → fewer image tokens
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      const g = canvas.getContext("2d");
      if (!g) throw new Error("Canvas unavailable");
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.7);
      const res = await fetch("/api/frame", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          image,
          scrubPii: privacyRef.current.scrubPii,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Frame capture failed");
      const { item } = (await res.json()) as { item: ContextItem };
      setState((s) => ({ ...s, capturingFrame: false, context: [...s.context, item] }));
    } catch (err) {
      patch({ capturingFrame: false, error: (err as Error).message });
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }, [patch]);

  // Post-meeting export. "markdown" downloads locally (no API, works even with
  // connectors held); "notion"/"gdrive" send the compiled markdown to /api/export.
  const exportMeeting = useCallback(
    async (target: ExportTarget) => {
      const title = `Meeting notes — ${new Date().toLocaleString()}`;
      const markdown = buildMeetingMarkdown({
        title,
        segments: state.segments,
        context: state.context,
        speakerNames: state.speakerNames,
        summary: state.summary,
        insights: state.insights,
      });

      if (target === "markdown") {
        const blob = new Blob([markdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `neat-meet-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.md`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      patch({ exporting: true, exportDetail: null });
      try {
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target,
            title,
            markdown,
            blockConnectors: privacyRef.current.blockConnectors,
            scrubPii: privacyRef.current.scrubPii,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Export failed");
        const { detail } = (await res.json()) as { detail?: string };
        patch({ exporting: false, exportDetail: detail ?? "saved" });
      } catch (err) {
        patch({ exporting: false, error: (err as Error).message });
      }
    },
    [state.segments, state.context, state.speakerNames, state.summary, state.insights, patch],
  );

  return {
    state,
    setProfile,
    setAutoSummary,
    setSpeakerName,
    setBlockConnectors,
    setScrubPii,
    start,
    stop,
    refreshSummary,
    refreshInsights,
    share,
    captureFrame,
    exportMeeting,
  };
}
