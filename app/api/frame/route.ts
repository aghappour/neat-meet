import { NextResponse } from "next/server";
import { SUMMARY_MODEL, effortConfig, firstText, getClient } from "@/lib/claude";
import { scrubPii } from "@/lib/redact";
import { addSlideContext } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Privacy note: unlike the transcript path (text only), this sends ONE captured
// image to Claude — and only when the user explicitly clicks "Capture slide".
const PROMPT = `This is a single frame from a screen shared in a live meeting — usually a slide or a shared document/app.
Extract the on-screen content as concise text a meeting participant could use: the title, bullet points, and any key figures, labels, or numbers. If it isn't a slide, briefly say what's shown.
Respond with plain text only — no preamble, no markdown headers.`;

/** Parse a `data:<mime>;base64,<data>` URL into its media type and payload. */
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { mediaType: m[1].toLowerCase(), data: m[2] };
}

export async function POST(req: Request) {
  let sessionId: string;
  let image: string;
  let scrub: boolean | undefined;
  try {
    ({ sessionId, image, scrubPii: scrub } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  const parsed = typeof image === "string" ? parseDataUrl(image) : null;
  if (!parsed) {
    return NextResponse.json({ error: "image must be a base64 data URL" }, { status: 400 });
  }

  try {
    const client = getClient();
    const params = {
      model: SUMMARY_MODEL,
      max_tokens: 700,
      ...effortConfig(SUMMARY_MODEL),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    };
    const res = await client.messages.create(params as never);
    let text = firstText(res.content as never).trim();
    if (!text) return NextResponse.json({ error: "No content extracted from frame" }, { status: 502 });
    // Scrub the EXTRACTED text before storing. Note: the frame image itself was
    // already sent (this endpoint is opt-in per click); scrubbing an image
    // isn't possible — documented in the README's privacy section.
    if (scrub) text = scrubPii(text);
    const item = addSlideContext(sessionId, text);
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
