import { NextResponse } from "next/server";
import {
  CONTEXT_MAX_CHARS,
  SUMMARY_MODEL,
  TRANSCRIPT_MAX_CHARS,
  effortConfig,
  extractJson,
  firstText,
  getClient,
} from "@/lib/claude";
import {
  cappedTranscript,
  contextSince,
  contextText,
  hasContent,
  lastSegmentId,
  transcriptSince,
  type SpeakerNames,
} from "@/lib/session-store";
import { scrubPii, scrubPiiDeep } from "@/lib/redact";
import type { MeetingSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stable prefix → prompt-cacheable across repeated summary calls in a meeting.
const SYSTEM_PROMPT = `You summarize a live meeting transcript for a participant who is in the meeting right now and glancing at a side panel.

Respond with ONLY a JSON object, no prose, matching exactly:
{
  "gist": "1-3 sentences on what the conversation is about right now",
  "decisions": ["decisions that have been made"],
  "openQuestions": ["questions raised but not resolved"],
  "actionItems": ["concrete follow-ups, with the owner if stated"]
}

Rules: be concise and factual; include only what the transcript supports; use [] for any empty list; do not invent owners or dates.`;

export async function POST(req: Request) {
  let sessionId: string;
  let speakerNames: SpeakerNames | undefined;
  let previousSummary: MeetingSummary | undefined;
  let afterSegmentId: number | undefined;
  let afterContextId: number | undefined;
  let scrub: boolean | undefined;
  try {
    ({
      sessionId,
      speakerNames,
      previousSummary,
      afterSegmentId,
      afterContextId,
      scrubPii: scrub,
    } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  if (!hasContent(sessionId)) {
    return NextResponse.json({ error: "No transcript yet" }, { status: 400 });
  }

  // Delta mode (cost optimization): when the client has a previous summary and a
  // watermark, send only the NEW lines since then plus that summary — a few
  // hundred tokens per call instead of the whole meeting.
  const delta =
    previousSummary && typeof previousSummary === "object" && typeof afterSegmentId === "number";

  let transcript: string;
  let truncated = false;
  let newLastSegmentId: number;
  let context: string;
  let newLastContextId = typeof afterContextId === "number" ? afterContextId : 0;

  if (delta) {
    const seg = transcriptSince(sessionId, afterSegmentId as number, speakerNames);
    const ctx = contextSince(sessionId, newLastContextId);
    transcript = seg.text;
    newLastSegmentId = seg.lastId;
    context = ctx.text;
    newLastContextId = ctx.lastId;
    // Nothing new at all → echo the previous summary without an API call.
    // `unchanged` lets the client skip recording a duplicate history version.
    if (!transcript && !context) {
      return NextResponse.json({
        ...(previousSummary as MeetingSummary),
        truncated: false,
        unchanged: true,
        lastSegmentId: newLastSegmentId,
        lastContextId: newLastContextId,
      });
    }
  } else {
    // First summary (or client without a watermark): capped full transcript.
    const capped = cappedTranscript(sessionId, TRANSCRIPT_MAX_CHARS, speakerNames);
    transcript = capped.text;
    truncated = capped.truncated;
    newLastSegmentId = lastSegmentId(sessionId);
    context = contextText(sessionId, CONTEXT_MAX_CHARS);
    newLastContextId = contextSince(sessionId, 0).lastId;
  }

  // Optional PII scrub (local regex) of everything that leaves for Claude —
  // the transcript, the shared context, and the folded-in prior summary.
  if (scrub) {
    transcript = scrubPii(transcript);
    context = scrubPii(context);
    if (previousSummary) previousSummary = scrubPiiDeep(previousSummary);
  }

  const prior = delta
    ? `Summary so far (JSON) — extend it, don't restart from scratch:\n${JSON.stringify(previousSummary)}\n\n`
    : "";

  try {
    const client = getClient();
    // SDK 0.68 doesn't type effort/output_config; pass through untyped.
    const params = {
      model: SUMMARY_MODEL,
      max_tokens: 1000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      ...effortConfig(SUMMARY_MODEL),
      messages: [
        {
          role: "user",
          content:
            prior +
            (transcript
              ? `${delta ? "New transcript since that summary" : truncated ? "Recent transcript" : "Transcript so far"}:\n\n${transcript}\n`
              : "") +
            (context
              ? `\n${delta ? "Newly shared" : "Shared"} in the meeting (chat / docs / slides):\n${context}\n`
              : "") +
            `\n${delta ? "Produce the UPDATED cumulative summary covering the whole meeting." : "Summarize as instructed."}`,
        },
      ],
    };
    const res = await client.messages.create(params as never);
    const summary = extractJson<MeetingSummary>(firstText(res.content as never));
    // Normalize to guard against missing arrays; `truncated` lets the UI note the trim.
    return NextResponse.json({
      gist: summary.gist ?? "",
      decisions: summary.decisions ?? [],
      openQuestions: summary.openQuestions ?? [],
      actionItems: summary.actionItems ?? [],
      truncated,
      lastSegmentId: newLastSegmentId,
      lastContextId: newLastContextId,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
