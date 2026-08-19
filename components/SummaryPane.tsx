"use client";

import { useState } from "react";
import type { SummaryVersion } from "@/lib/types";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-200">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export function SummaryPane({
  history,
  loading,
  onRefresh,
  disabled,
  auto,
  onToggleAuto,
}: {
  history: SummaryVersion[];
  loading: boolean;
  onRefresh: () => void;
  disabled: boolean;
  auto: boolean;
  onToggleAuto: (next: boolean) => void;
}) {
  // idx === -1 means "follow the latest"; otherwise a pinned history position.
  const [idx, setIdx] = useState(-1);
  const total = history.length;
  const pos = idx === -1 ? total - 1 : Math.min(idx, total - 1);
  const current = total > 0 ? history[pos] : null;

  const goPrev = () => setIdx(Math.max(0, pos - 1));
  const goNext = () => setIdx(pos + 1 >= total - 1 ? -1 : pos + 1);
  const following = idx === -1 || pos === total - 1;

  return (
    <section className="flex h-full flex-col rounded-xl border border-edge bg-panel">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <span className="text-sm font-semibold text-slate-200">Rolling summary</span>
        <div className="flex items-center gap-2">
          <label
            className="flex cursor-pointer items-center gap-1 text-xs text-muted"
            title="Re-summarize automatically as the conversation grows"
          >
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => onToggleAuto(e.target.checked)}
              className="h-3 w-3 accent-accent"
            />
            Auto
          </label>
          <button
            onClick={onRefresh}
            disabled={disabled || loading}
            className="rounded-md border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge disabled:opacity-40"
          >
            {loading ? "Summarizing…" : "Refresh"}
          </button>
        </div>
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

      <div className="thin-scroll flex-1 space-y-4 overflow-y-auto p-4">
        {!current && !loading && (
          <p className="text-sm text-muted">
            {auto
              ? "Summarizing automatically as the conversation grows — gist, decisions, open questions, and action items. Or hit Refresh anytime."
              : "Refresh to summarize the conversation so far — gist, decisions, open questions, and action items."}
          </p>
        )}
        {current && (
          <>
            <p className="text-sm text-slate-100">{current.summary.gist}</p>
            <List title="Decisions" items={current.summary.decisions} />
            <List title="Open questions" items={current.summary.openQuestions} />
            <List title="Action items" items={current.summary.actionItems} />
          </>
        )}
      </div>
    </section>
  );
}
