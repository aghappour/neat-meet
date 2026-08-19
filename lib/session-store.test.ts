import { afterEach, describe, expect, it } from "vitest";
import {
  addSlideContext,
  cappedTranscript,
  clearSession,
  contextText,
  hasContent,
  isCaptionDriven,
  recentTranscript,
  recordCaption,
  recordChat,
  recordSegment,
  setActiveSession,
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

  it("renders a segment's own speakerName by default", () => {
    recordSegment("s1", raw({ speaker: "them", speakerName: "Sarah", text: "hi" }));
    expect(transcriptText("s1")).toBe("Sarah: hi");
  });

  it("applies name overrides by channel and by speaker name", () => {
    recordSegment("s1", raw({ speaker: "me", text: "hi" }));
    recordSegment("s1", raw({ speaker: "them", speakerName: "Sarah", text: "yo" }));
    // Override the "me" channel and rename the named speaker "Sarah".
    const out = transcriptText("s1", { me: "Ahmed", Sarah: "Dr. Lee" });
    expect(out).toBe("Ahmed: hi\nDr. Lee: yo");
  });
});

describe("session-store context (chat / docs / slides)", () => {
  afterEach(() => {
    clearSession("ctx1");
  });

  it("drops chat when there is no active session", () => {
    expect(recordChat({ author: "Sam", text: "hi" })).toBeNull();
  });

  it("stores a plain chat message as a chat item", () => {
    setActiveSession("ctx1");
    const rec = recordChat({ author: "Sam", text: "quick question" });
    expect(rec?.item.kind).toBe("chat");
    expect(contextText("ctx1")).toBe("[chat] Sam: quick question");
  });

  it("treats a chat message with a link as a shared doc", () => {
    setActiveSession("ctx1");
    const rec = recordChat({ author: "Sam", text: "deck: https://docs.example/deck" });
    expect(rec?.item.kind).toBe("doc");
    expect(rec?.item.url).toBe("https://docs.example/deck");
  });

  it("stores extracted slide content as a slide item", () => {
    const item = addSlideContext("ctx1", "Q3 Roadmap — three bets");
    expect(item.kind).toBe("slide");
    expect(contextText("ctx1")).toContain("[shared slide] Q3 Roadmap — three bets");
  });

  it("context alone counts as content for summary/insights", () => {
    setActiveSession("ctx1");
    expect(hasContent("ctx1")).toBe(false);
    recordChat({ author: "Sam", text: "hello" });
    expect(hasContent("ctx1")).toBe(true);
  });
});

describe("session-store token guard", () => {
  afterEach(() => {
    clearSession("cap-t");
  });

  it("returns the full transcript untrimmed when under the cap", () => {
    recordSegment("cap-t", raw({ text: "short meeting" }));
    const { text, truncated } = cappedTranscript("cap-t", 10_000);
    expect(truncated).toBe(false);
    expect(text).toBe("Me: short meeting");
  });

  it("caps to the tail with a marker, aligned to a line boundary", () => {
    for (let i = 0; i < 60; i++) {
      recordSegment("cap-t", raw({ text: `line number ${i} with some padding text` }));
    }
    const { text, truncated } = cappedTranscript("cap-t", 300);
    expect(truncated).toBe(true);
    expect(text.startsWith("[…earlier transcript omitted to bound cost…]\n")).toBe(true);
    // The kept portion starts at a line boundary (a speaker prefix), keeps the
    // newest line, and respects the cap (marker aside).
    const body = text.split("\n").slice(1).join("\n");
    expect(body.startsWith("Me: ")).toBe(true);
    expect(body).toContain("line number 59");
    expect(body.length).toBeLessThanOrEqual(300);
  });

  it("caps context with a marker too", () => {
    setActiveSession("cap-t");
    for (let i = 0; i < 40; i++) recordChat({ author: "Sam", text: `chat message ${i}` });
    const text = contextText("cap-t", 200);
    expect(text.startsWith("[…earlier shared context omitted…]")).toBe(true);
    expect(text).toContain("chat message 39");
  });
});

describe("session-store captions", () => {
  afterEach(() => {
    clearSession("cap1");
  });

  it("drops captions when there is no active session", () => {
    expect(recordCaption({ speaker: "them", speakerName: "Sarah", text: "hi" })).toBeNull();
  });

  it("routes captions to the active session and marks it caption-driven", () => {
    setActiveSession("cap1");
    expect(isCaptionDriven("cap1")).toBe(false);
    const rec = recordCaption({ speaker: "them", speakerName: "Sarah", text: "hello" });
    expect(rec?.sessionId).toBe("cap1");
    expect(rec?.segment.origin).toBe("meet");
    expect(rec?.segment.speakerName).toBe("Sarah");
    expect(isCaptionDriven("cap1")).toBe(true);
    expect(transcriptText("cap1")).toBe("Sarah: hello");
  });
});
