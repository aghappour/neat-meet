import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  CONTEXT_MAX_CHARS,
  TRANSCRIPT_MAX_CHARS,
  extractJson,
  firstText,
  getClient,
} from "@/lib/claude";
import { cappedTranscript, contextText, hasContent, type SpeakerNames } from "@/lib/session-store";
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
  try {
    ({ sessionId, speakerNames, previousSummary } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  if (!hasContent(sessionId)) {
    return NextResponse.json({ error: "No transcript yet" }, { status: 400 });
  }

  // Token guard: cap the transcript to bound cost on long meetings. Cumulativeness
  // survives because we fold in the previous summary — so older verbatim lines can
  // drop off without losing the earlier meeting.
  const { text: transcript, truncated } = cappedTranscript(
    sessionId,
    TRANSCRIPT_MAX_CHARS,
    speakerNames,
  );
  const context = contextText(sessionId, CONTEXT_MAX_CHARS);
  const prior =
    previousSummary && typeof previousSummary === "object"
      ? `Summary so far (JSON) — extend it, don't restart from scratch:\n${JSON.stringify(previousSummary)}\n\n`
      : "";

  try {
    const client = getClient();
    // SDK 0.68 doesn't type effort/output_config; pass through untyped.
    const params = {
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content:
            prior +
            `${truncated ? "Recent transcript" : "Transcript so far"}:\n\n${transcript}\n` +
            (context ? `\nShared in the meeting (chat / docs / slides):\n${context}\n` : "") +
            `\n${prior ? "Produce the UPDATED cumulative summary covering the whole meeting." : "Summarize as instructed."}`,
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
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
