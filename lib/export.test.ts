import { describe, expect, it } from "vitest";
import { buildMeetingMarkdown } from "@/lib/export";
import type { ContextItem, TranscriptSegment } from "@/lib/types";

const seg = (over: Partial<TranscriptSegment>): TranscriptSegment => ({
  id: 1,
  speaker: "me",
  text: "hello",
  interim: false,
  startMs: 0,
  at: 1000,
  ...over,
});

describe("buildMeetingMarkdown", () => {
  it("compiles title, summary, insights, docs, transcript, and chat", () => {
    const md = buildMeetingMarkdown({
      title: "Weekly sync",
      segments: [
        seg({ id: 1, text: "hi team" }),
        seg({ id: 2, speaker: "them", speakerName: "Sarah", text: "hi back" }),
      ],
      context: [
        { id: 1, kind: "chat", at: 1, author: "Mia", text: "running late" },
        { id: 2, kind: "doc", at: 2, author: "Sam", text: "the deck", url: "https://x.co/d" },
        { id: 3, kind: "slide", at: 3, text: "Q3 roadmap\nthree bets" },
      ] satisfies ContextItem[],
      speakerNames: { me: "Ahmed" },
      summary: {
        gist: "We synced.",
        decisions: ["ship it"],
        openQuestions: [],
        actionItems: ["Sarah to draft"],
      },
      insights: [{ title: "Deck", insight: "Reuse Q2 numbers", source: "Notion: Q2" }],
    });

    expect(md).toContain("# Weekly sync");
    expect(md).toContain("## Summary");
    expect(md).toContain("- ship it");
    expect(md).toContain("### Action items");
    expect(md).toContain("**Deck** — Reuse Q2 numbers");
    expect(md).toContain("[the deck](https://x.co/d)");
    expect(md).toContain("> Q3 roadmap\n> three bets");
    expect(md).toContain("**Ahmed:** hi team");
    expect(md).toContain("**Sarah:** hi back");
    expect(md).toContain("- Mia: running late");
    // Empty summary sections are omitted entirely.
    expect(md).not.toContain("Open questions");
  });

  it("omits sections with no content", () => {
    const md = buildMeetingMarkdown({
      title: "T",
      segments: [seg({})],
      context: [],
      speakerNames: {},
      summary: null,
      insights: [],
    });
    expect(md).not.toContain("## Summary");
    expect(md).not.toContain("## Insights");
    expect(md).toContain("## Transcript");
  });
});
