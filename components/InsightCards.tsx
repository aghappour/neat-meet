"use client";

import { useState } from "react";
import type { Insight, InsightsVersion, ShareTarget } from "@/lib/types";

const TARGET_LABELS: Record<ShareTarget, string> = {
  slack: "Slack",
  notion: "Notion",
  gmail: "Gmail",
  telegram: "Telegram",
};

function ShareRow({
  targets,
  onShare,
}: {
  /** Only targets a configured connector can deliver. */
  targets: ShareTarget[];
  onShare: (target: ShareTarget, destination: string) => Promise<void>;
}) {
  // Track the pick rather than seeding state from `targets`, which arrives
  // asynchronously — seeding would strand the selection on a stale value.
  const [picked, setPicked] = useState<ShareTarget | null>(null);
  const target = picked && targets.includes(picked) ? picked : targets[0];
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!target) return;
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

  if (!target) {
    return (
      <p className="mt-2 text-xs text-muted">
        No share destination configured — set a connector URL in <code>.env</code> to enable
        sharing.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={target}
        onChange={(e) => setPicked(e.target.value as ShareTarget)}
        className="rounded-md border border-edge bg-ink px-2 py-1 text-xs"
      >
        {targets.map((t) => (
          <option key={t} value={t}>
            {TARGET_LABELS[t]}
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
  history,
  loading,
  onRefresh,
  onShare,
  disabled,
  targets,
}: {
  history: InsightsVersion[];
  loading: boolean;
  onRefresh: () => void;
  onShare: (insight: Insight, target: ShareTarget, destination: string) => Promise<void>;
  disabled: boolean;
  /** Share targets a configured connector can deliver. */
  targets: ShareTarget[];
}) {
  // idx === -1 follows the latest generation; otherwise a pinned position.
  const [idx, setIdx] = useState(-1);
  const total = history.length;
  const pos = idx === -1 ? total - 1 : Math.min(idx, total - 1);
  const current = total > 0 ? history[pos] : null;
  const insights = current?.insights ?? [];
  const grounded = current?.grounded ?? [];
  const goPrev = () => setIdx(Math.max(0, pos - 1));
  const goNext = () => setIdx(pos + 1 >= total - 1 ? -1 : pos + 1);
  const following = idx === -1 || pos === total - 1;

  return (
    <section className="flex h-full flex-col rounded-xl border border-edge bg-panel">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-200">Insights to share</span>
          {insights.length > 0 && (
            <span className="text-xs text-muted">
              {grounded.length > 0 ? `grounded in ${grounded.join(", ")}` : "from transcript only"}
            </span>
          )}
          {current?.truncated && (
            <span
              title="Transcript was capped to limit cost on this run."
              className="rounded-full border border-edge px-2 py-0.5 text-[10px] text-muted"
            >
              condensed
            </span>
          )}
        </span>
        <button
          onClick={onRefresh}
          disabled={disabled || loading}
          className="rounded-md border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge disabled:opacity-40"
        >
          {loading ? "Thinking…" : "Generate"}
        </button>
      </header>
      {total > 1 && (
        <div className="flex items-center justify-between border-b border-edge px-4 py-1.5 text-xs text-muted">
          <div className="flex items-center gap-2">
            <button onClick={goPrev} disabled={pos === 0} className="disabled:opacity-30">
              ◀
            </button>
            <span>
              {pos + 1} / {total}
              {following && <span className="ml-1 text-emerald-300">· latest</span>}
            </span>
            <button onClick={goNext} disabled={following} className="disabled:opacity-30">
              ▶
            </button>
          </div>
          {current && <span>{new Date(current.at).toLocaleTimeString()}</span>}
        </div>
      )}
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
            <ShareRow targets={targets} onShare={(t, d) => onShare(insight, t, d)} />
          </article>
        ))}
      </div>
    </section>
  );
}
