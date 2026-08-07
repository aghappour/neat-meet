"use client";

import { useMeeting } from "@/lib/client/useMeeting";
import { TranscriptPane } from "@/components/TranscriptPane";
import { SummaryPane } from "@/components/SummaryPane";
import { InsightCards } from "@/components/InsightCards";
import type { WhisperProfile } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  live: "Live",
  error: "Error",
};

export default function Page() {
  const { state, setProfile, start, stop, refreshSummary, refreshInsights, share } = useMeeting();
  const live = state.status === "live";
  const notStarted = state.status === "idle" || state.status === "error";

  return (
    <main className="mx-auto flex h-screen max-w-7xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">neat-meet</h1>
          <p className="text-xs text-muted">
            Live transcript · rolling summary · shareable insights
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full border border-edge px-3 py-1 text-xs ${
              live ? "text-emerald-300" : state.status === "error" ? "text-red-400" : "text-muted"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                live ? "animate-pulse bg-emerald-400" : "bg-slate-500"
              }`}
            />
            {STATUS_LABEL[state.status]}
          </span>

          <label className="flex items-center gap-1 text-xs text-muted">
            Whisper
            <select
              value={state.profile}
              onChange={(e) => setProfile(e.target.value as WhisperProfile)}
              disabled={!notStarted}
              className="rounded-md border border-edge bg-ink px-2 py-1 text-xs text-slate-200 disabled:opacity-40"
            >
              <option value="modest">Modest — CPU</option>
              <option value="capable">Capable — CUDA GPU</option>
            </select>
          </label>

          {notStarted ? (
            <button
              onClick={start}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-ink hover:brightness-110"
            >
              Start meeting
            </button>
          ) : (
            <button
              onClick={stop}
              className="rounded-md bg-red-500/80 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500"
            >
              Stop
            </button>
          )}
        </div>
      </header>

      {state.error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-h-0 lg:col-span-1">
          <TranscriptPane segments={state.segments} interims={state.interims} />
        </div>
        <div className="min-h-0 lg:col-span-1">
          <SummaryPane
            summary={state.summary}
            loading={state.summarizing}
            onRefresh={refreshSummary}
            disabled={state.segments.length === 0}
          />
        </div>
        <div className="min-h-0 lg:col-span-1">
          <InsightCards
            insights={state.insights}
            loading={state.insightsLoading}
            onRefresh={refreshInsights}
            onShare={async (insight, target, destination) => {
              await share(insight, target, destination);
            }}
            disabled={state.segments.length === 0}
          />
        </div>
      </div>
    </main>
  );
}
