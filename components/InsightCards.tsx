"use client";

import { useState } from "react";
import type { Insight, ShareTarget } from "@/lib/types";

const SHARE_TARGETS: { value: ShareTarget; label: string }[] = [
  { value: "slack", label: "Slack" },
  { value: "notion", label: "Notion" },
  { value: "gmail", label: "Gmail" },
  { value: "telegram", label: "Telegram" },
];

function ShareRow({
  insight,
  onShare,
}: {
  insight: Insight;
  onShare: (target: ShareTarget, destination: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<ShareTarget>("slack");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onShare(target, destination);
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value as ShareTarget)}
        className="rounded-md border border-edge bg-ink px-2 py-1 text-xs"
      >
        {SHARE_TARGETS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder="channel / page / recipient"
        className="flex-1 rounded-md border border-edge bg-ink px-2 py-1 text-xs placeholder:text-muted"
      />
      <button
        onClick={submit}
        disabled={busy || !destination}
        className="rounded-md bg-accent/20 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/30 disabled:opacity-40"
      >
        {busy ? "Sharing…" : done ? "Shared ✓" : "Share"}
      </button>
      {err && <span className="w-full text-xs text-red-400">{err}</span>}
    </div>
  );
}

export function InsightCards({
  insights,
  loading,
  onRefresh,
  onShare,
  disabled,
}: {
  insights: Insight[];
  loading: boolean;
  onRefresh: () => void;
  onShare: (insight: Insight, target: ShareTarget, destination: string) => Promise<void>;
  disabled: boolean;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-edge bg-panel">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <span className="text-sm font-semibold text-slate-200">Insights to share</span>
        <button
          onClick={onRefresh}
          disabled={disabled || loading}
          className="rounded-md border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge disabled:opacity-40"
        >
          {loading ? "Thinking…" : "Generate"}
        </button>
      </header>
      <div className="thin-scroll flex-1 space-y-3 overflow-y-auto p-4">
        {insights.length === 0 && !loading && (
          <p className="text-sm text-muted">
            Generate insights grounded in your Notion, Slack, and Drive — talking points, relevant
            docs, and facts you can drop into the meeting.
          </p>
        )}
        {insights.map((insight, i) => (
          <article key={i} className="rounded-lg border border-edge bg-ink/60 p-3">
            <h3 className="text-sm font-semibold text-slate-100">{insight.title}</h3>
            <p className="mt-1 text-sm text-slate-300">{insight.insight}</p>
            <p className="mt-1 text-xs text-muted">
              {insight.url ? (
                <a href={insight.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                  {insight.source} ↗
                </a>
              ) : (
                insight.source
              )}
            </p>
            <ShareRow insight={insight} onShare={(t, d) => onShare(insight, t, d)} />
          </article>
        ))}
      </div>
    </section>
  );
}
