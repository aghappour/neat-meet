import type { ContextItem, Insight, MeetingSummary, TranscriptSegment } from "@/lib/types";

/**
 * Compile a meeting into a single markdown document: final summary, insights,
 * shared context, and the full speaker-attributed transcript. Pure function —
 * used by the client for the .md download and sent to /api/export for
 * Notion/Drive delivery.
 */
export function buildMeetingMarkdown(input: {
  title: string;
  segments: TranscriptSegment[];
  context: ContextItem[];
  speakerNames: Record<string, string>;
  summary: MeetingSummary | null;
  insights: Insight[];
}): string {
  const { title, segments, context, speakerNames, summary, insights } = input;
  const parts: string[] = [`# ${title}`, ""];

  if (summary) {
    parts.push("## Summary", "", summary.gist, "");
    const section = (name: string, items: string[]) => {
      if (items.length === 0) return;
      parts.push(`### ${name}`, "", ...items.map((it) => `- ${it}`), "");
    };
    section("Decisions", summary.decisions);
    section("Open questions", summary.openQuestions);
    section("Action items", summary.actionItems);
  }

  if (insights.length > 0) {
    parts.push("## Insights", "");
    for (const ins of insights) {
      parts.push(`- **${ins.title}** — ${ins.insight} _(${ins.source}${ins.url ? `, ${ins.url}` : ""})_`);
    }
    parts.push("");
  }

  const docs = context.filter((c) => c.kind === "doc");
  if (docs.length > 0) {
    parts.push("## Shared documents", "");
    for (const d of docs) parts.push(`- ${d.url ? `[${d.text}](${d.url})` : d.text}`);
    parts.push("");
  }
  const slides = context.filter((c) => c.kind === "slide");
  if (slides.length > 0) {
    parts.push("## Captured slides", "");
    for (const s of slides) parts.push(`> ${s.text.replace(/\n/g, "\n> ")}`, "");
  }

  if (segments.length > 0) {
    parts.push("## Transcript", "");
    for (const seg of segments) parts.push(`**${resolveName(seg, speakerNames)}:** ${seg.text}`);
    parts.push("");
  }
  const chat = context.filter((c) => c.kind === "chat");
  if (chat.length > 0) {
    parts.push("## Chat", "");
    for (const c of chat) parts.push(`- ${c.author ?? "Someone"}: ${c.text}`);
    parts.push("");
  }

  return parts.join("\n");
}

function resolveName(seg: TranscriptSegment, names: Record<string, string>): string {
  if (seg.speakerName && names[seg.speakerName]) return names[seg.speakerName];
  if (names[seg.speaker]) return names[seg.speaker];
  if (seg.speakerName) return seg.speakerName;
  return seg.speaker === "me" ? "Me" : seg.speaker === "them" ? "Participant" : "Speaker";
}
