"use client";

import type { MeetingSummary } from "@/lib/types";

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
  summary,
  loading,
  onRefresh,
  disabled,
}: {
  summary: MeetingSummary | null;
  loading: boolean;
  onRefresh: () => void;
  disabled: boolean;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-edge bg-panel">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <span className="text-sm font-semibold text-slate-200">Rolling summary</span>
        <button
          onClick={onRefresh}
          disabled={disabled || loading}
          className="rounded-md border border-edge px-2 py-1 text-xs text-slate-300 hover:bg-edge disabled:opacity-40"
        >
          {loading ? "Summarizing…" : "Refresh"}
        </button>
      </header>
      <div className="thin-scroll flex-1 space-y-4 overflow-y-auto p-4">
        {!summary && !loading && (
          <p className="text-sm text-muted">
            Refresh to summarize the conversation so far — gist, decisions, open questions, and
            action items.
          </p>
        )}
        {summary && (
          <>
            <p className="text-sm text-slate-100">{summary.gist}</p>
            <List title="Decisions" items={summary.decisions} />
            <List title="Open questions" items={summary.openQuestions} />
            <List title="Action items" items={summary.actionItems} />
          </>
        )}
      </div>
    </section>
  );
}
