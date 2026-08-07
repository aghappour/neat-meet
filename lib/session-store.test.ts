import { afterEach, describe, expect, it } from "vitest";
import {
  clearSession,
  hasContent,
  recentTranscript,
  recordSegment,
  transcriptText,
} from "@/lib/session-store";
import type { RawSegment } from "@/lib/transcription/provider";

const raw = (over: Partial<RawSegment> = {}): RawSegment => ({
  speaker: "me",
  text: "hello",
  interim: false,
  startMs: 0,
  at: Date.now(),
  ...over,
});

describe("session-store", () => {
  afterEach(() => {
    clearSession("s1");
  });

  it("assigns monotonic ids", () => {
    const a = recordSegment("s1", raw({ text: "one" }));
    const b = recordSegment("s1", raw({ text: "two" }));
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it("stores finalized segments but not interim ones", () => {
    recordSegment("s1", raw({ text: "final one" }));
    recordSegment("s1", raw({ text: "typing", interim: true }));
    recordSegment("s1", raw({ text: "final two" }));
    expect(transcriptText("s1")).toBe("Me: final one\nMe: final two");
  });

  it("labels speakers", () => {
    recordSegment("s1", raw({ speaker: "me", text: "hi" }));
    recordSegment("s1", raw({ speaker: "them", text: "hello back" }));
    expect(transcriptText("s1")).toBe("Me: hi\nParticipant: hello back");
  });

  it("hasContent reflects stored finals only", () => {
    expect(hasContent("s1")).toBe(false);
    recordSegment("s1", raw({ interim: true }));
    expect(hasContent("s1")).toBe(false);
    recordSegment("s1", raw());
    expect(hasContent("s1")).toBe(true);
  });

  it("recentTranscript truncates to the trailing window", () => {
    for (let i = 0; i < 50; i++) {
      recordSegment("s1", raw({ text: `line ${i} with some length` }));
    }
    const windowed = recentTranscript("s1", 100);
    expect(windowed.length).toBeLessThanOrEqual(100);
    // It should be the tail, so the last line is present.
    expect(windowed).toContain("line 49");
  });

  it("clearSession removes all state", () => {
    recordSegment("s1", raw());
    expect(hasContent("s1")).toBe(true);
    clearSession("s1");
    expect(hasContent("s1")).toBe(false);
    expect(transcriptText("s1")).toBe("");
  });
});
