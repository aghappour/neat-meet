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
  const {
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
  } = useMeeting();
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

        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 rounded-full border border-edge px-3 py-1">
            <label
              className="flex cursor-pointer items-center gap-1 text-xs text-muted"
              title="Privacy hold: attach no connectors to insights and disable sharing/export for this meeting"
            >
              <input
                type="checkbox"
                checked={state.blockConnectors}
                onChange={(e) => setBlockConnectors(e.target.checked)}
                className="h-3 w-3 accent-accent"
              />
              Hold connectors
            </label>
            <label
              className="flex cursor-pointer items-center gap-1 text-xs text-muted"
              title="Scrub emails, phone numbers, SSNs, card numbers, and IPs from text before it leaves for Claude (captured slide images can't be scrubbed)"
            >
              <input
                type="checkbox"
                checked={state.scrubPii}
                onChange={(e) => setScrubPii(e.target.checked)}
                className="h-3 w-3 accent-accent"
              />
              Scrub PII
            </label>
          </span>

          {state.segments.length > 0 && (
            <span className="flex items-center gap-1">
              <button
                onClick={() => exportMeeting("markdown")}
                title="Download transcript + summary + insights as a markdown file (local, always available)"
                className="rounded-md border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge"
              >
                ⬇ .md
              </button>
              {state.exportTargets.includes("notion") && (
                <button
                  onClick={() => exportMeeting("notion")}
                  disabled={state.exporting || state.blockConnectors}
                  title={state.blockConnectors ? "Disabled while connectors are held" : "Save to a new Notion page"}
                  className="rounded-md border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge disabled:opacity-40"
                >
                  → Notion
                </button>
              )}
              {state.exportTargets.includes("gdrive") && (
                <button
                  onClick={() => exportMeeting("gdrive")}
                  disabled={state.exporting || state.blockConnectors}
                  title={state.blockConnectors ? "Disabled while connectors are held" : "Save to a new Google Drive document"}
                  className="rounded-md border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge disabled:opacity-40"
                >
                  → Drive
                </button>
              )}
              {state.exporting && <span className="text-xs text-muted">saving…</span>}
              {state.exportDetail && !state.exporting && (
                <span className="max-w-48 truncate text-xs text-emerald-300" title={state.exportDetail}>
                  ✓ {state.exportDetail}
                </span>
              )}
            </span>
          )}

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

          {live && (
            <button
              onClick={captureFrame}
              disabled={state.capturingFrame}
              title="Send the current shared frame (e.g. a slide) to Claude to add its content to the meeting context"
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-slate-200 hover:bg-edge disabled:opacity-40"
            >
              {state.capturingFrame ? "Capturing…" : "📷 Capture slide"}
            </button>
          )}

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
          <TranscriptPane
            segments={state.segments}
            interims={state.interims}
            context={state.context}
            speakerNames={state.speakerNames}
            roster={state.roster}
            onRename={setSpeakerName}
            captionsActive={state.captionsActive}
          />
        </div>
        <div className="min-h-0 lg:col-span-1">
          <SummaryPane
            history={state.summaryHistory}
            loading={state.summarizing}
            onRefresh={refreshSummary}
            disabled={state.segments.length === 0}
            auto={state.autoSummary}
            onToggleAuto={setAutoSummary}
          />
        </div>
        <div className="min-h-0 lg:col-span-1">
          <InsightCards
            history={state.insightHistory}
            loading={state.insightsLoading}
            targets={state.targets}
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
