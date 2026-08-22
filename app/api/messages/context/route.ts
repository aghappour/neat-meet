import { NextResponse } from "next/server";
import { buildMessageContext, parseWhen } from "@/lib/messages/memory";
import type { MessagePlatform } from "@/lib/messages/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/messages/context — a prompt-ready, token-bounded block of archived
 * messages for agents. Same filters as /api/messages plus maxChars and scrub=1
 * (local PII redaction before the text leaves the archive).
 *
 * Returns { context, count, truncated }; `context` is "" when nothing matched,
 * so callers can append it to a prompt unconditionally.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const platform = p.get("platform");
  if (platform && platform !== "signal" && platform !== "whatsapp") {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 });
  }
  const ctx = buildMessageContext({
    q: p.get("q") ?? undefined,
    platform: (platform as MessagePlatform) ?? undefined,
    chat: p.get("chat") ?? undefined,
    since: parseWhen(p.get("since")),
    until: parseWhen(p.get("until")),
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    maxChars: p.get("maxChars") ? Number(p.get("maxChars")) : undefined,
    scrub: p.get("scrub") === "1" || p.get("scrub") === "true",
  });
  return NextResponse.json({ context: ctx.text, count: ctx.count, truncated: ctx.truncated });
}
