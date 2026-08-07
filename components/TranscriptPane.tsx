"use client";

import { useEffect, useRef } from "react";
import type { TranscriptSegment } from "@/lib/types";

function speakerLabel(speaker: TranscriptSegment["speaker"]) {
  return speaker === "me" ? "You" : speaker === "them" ? "Participant" : "Speaker";
}

function speakerColor(speaker: TranscriptSegment["speaker"]) {
  return speaker === "me" ? "text-accent" : "text-emerald-300";
}

export function TranscriptPane({
  segments,
  interims,
}: {
  segments: TranscriptSegment[];
  interims: Record<string, TranscriptSegment | undefined>;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const interimList = Object.values(interims).filter(Boolean) as TranscriptSegment[];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length, interimList.length]);

  return (
    <section className="flex h-full flex-col rounded-xl border border-edge bg-panel">
      <header className="border-b border-edge px-4 py-3 text-sm font-semibold text-slate-200">
        Live transcript
      </header>
      <div className="thin-scroll flex-1 space-y-3 overflow-y-auto p-4 text-sm leading-relaxed">
        {segments.length === 0 && interimList.length === 0 && (
          <p className="text-muted">
            Nothing yet. Start a meeting and speak — the far end is captured from the shared tab,
            your voice from the mic.
          </p>
        )}
        {segments.map((seg) => (
          <p key={seg.id}>
            <span className={`font-semibold ${speakerColor(seg.speaker)}`}>
              {speakerLabel(seg.speaker)}:
            </span>{" "}
            <span className="text-slate-100">{seg.text}</span>
          </p>
        ))}
        {interimList.map((seg) => (
          <p key={`interim-${seg.speaker}`} className="opacity-60">
            <span className={`font-semibold ${speakerColor(seg.speaker)}`}>
              {speakerLabel(seg.speaker)}:
            </span>{" "}
            <span className="italic text-slate-300">{seg.text}…</span>
          </p>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
