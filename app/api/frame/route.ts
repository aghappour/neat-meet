import { NextResponse } from "next/server";
import { CLAUDE_MODEL, firstText, getClient } from "@/lib/claude";
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
  try {
    ({ sessionId, image } = await req.json());
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
      model: CLAUDE_MODEL,
      max_tokens: 700,
      output_config: { effort: "low" },
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
    const text = firstText(res.content as never).trim();
    if (!text) return NextResponse.json({ error: "No content extracted from frame" }, { status: 502 });
    const item = addSlideContext(sessionId, text);
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
