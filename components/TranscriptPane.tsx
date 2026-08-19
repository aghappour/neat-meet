"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptSegment } from "@/lib/types";

type Names = Record<string, string>;

/** The key an override is stored under: the Meet name if known, else the channel. */
function identityOf(seg: TranscriptSegment): string {
  return seg.speakerName ?? seg.speaker;
}

/** Resolve a segment's display name: user override → Meet name → channel default. */
function resolveName(seg: TranscriptSegment, names: Names): string {
  if (seg.speakerName && names[seg.speakerName]) return names[seg.speakerName];
  if (names[seg.speaker]) return names[seg.speaker];
  if (seg.speakerName) return seg.speakerName;
  return seg.speaker === "me" ? "You" : seg.speaker === "them" ? "Participant" : "Speaker";
}

// Distinct colors so multiple named participants are visually separable.
const OTHER_COLORS = ["text-emerald-300", "text-sky-300", "text-violet-300", "text-amber-300"];
function colorFor(seg: TranscriptSegment): string {
  if (seg.speaker === "me") return "text-accent";
  const key = identityOf(seg);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return OTHER_COLORS[h % OTHER_COLORS.length];
}

function SpeakerChip({
  identity,
  name,
  color,
  roster,
  onRename,
}: {
  identity: string;
  name: string;
  color: string;
  roster: string[];
  onRename: (identity: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (editing) {
    const commit = () => {
      onRename(identity, draft);
      setEditing(false);
    };
    return (
      <>
        <input
          autoFocus
          list="neatmeet-roster"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder={name}
          className="w-28 rounded-full border border-edge bg-ink px-2 py-0.5 text-xs text-slate-100"
        />
        <datalist id="neatmeet-roster">
          {roster.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </>
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      title="Rename speaker"
      className="rounded-full border border-edge px-2 py-0.5 text-xs hover:bg-edge"
    >
      <span className={`font-semibold ${color}`}>{name}</span>
      <span className="ml-1 text-muted">✎</span>
    </button>
  );
}

export function TranscriptPane({
  segments,
  interims,
  speakerNames,
  roster,
  onRename,
  captionsActive,
}: {
  segments: TranscriptSegment[];
  interims: Record<string, TranscriptSegment | undefined>;
  speakerNames: Names;
  roster: string[];
  onRename: (identity: string, name: string) => void;
  captionsActive: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const interimList = Object.values(interims).filter(Boolean) as TranscriptSegment[];

  // One chip per distinct speaker seen so far, with a representative segment.
  const speakers = useMemo(() => {
    const map = new Map<string, TranscriptSegment>();
    for (const seg of segments) if (!map.has(identityOf(seg))) map.set(identityOf(seg), seg);
    for (const seg of interimList) if (!map.has(identityOf(seg))) map.set(identityOf(seg), seg);
    return Array.from(map.entries());
  }, [segments, interimList]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length, interimList.length]);

  return (
    <section className="flex h-full flex-col rounded-xl border border-edge bg-panel">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <span className="text-sm font-semibold text-slate-200">Live transcript</span>
        {captionsActive && (
          <span
            title="Speaker names imported from Google Meet captions"
            className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-xs text-emerald-300"
          >
            Meet captions
          </span>
        )}
      </header>

      {speakers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
          <span className="text-xs text-muted">Speakers:</span>
          {speakers.map(([identity, seg]) => (
            <SpeakerChip
              key={identity}
              identity={identity}
              name={resolveName(seg, speakerNames)}
              color={colorFor(seg)}
              roster={roster}
              onRename={onRename}
            />
          ))}
        </div>
      )}

      <div className="thin-scroll flex-1 space-y-3 overflow-y-auto p-4 text-sm leading-relaxed">
        {segments.length === 0 && interimList.length === 0 && (
          <p className="text-muted">
            Nothing yet. Start a meeting and speak — the far end is captured from the shared tab,
            your voice from the mic.
          </p>
        )}
        {segments.map((seg) => (
          <p key={seg.id}>
            <span className={`font-semibold ${colorFor(seg)}`}>{resolveName(seg, speakerNames)}:</span>{" "}
            <span className="text-slate-100">{seg.text}</span>
          </p>
        ))}
        {interimList.map((seg) => (
          <p key={`interim-${identityOf(seg)}`} className="opacity-60">
            <span className={`font-semibold ${colorFor(seg)}`}>{resolveName(seg, speakerNames)}:</span>{" "}
            <span className="italic text-slate-300">{seg.text}…</span>
          </p>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
