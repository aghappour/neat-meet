import { NextResponse } from "next/server";
import { parseWhen } from "@/lib/messages/memory";
import { messageStore } from "@/lib/messages/store";
import { normalizeBridgeMessage, type BridgeMessage } from "@/lib/messages/whatsapp";
import type { MessagePlatform, StoredMessage } from "@/lib/messages/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Attach a fetchable URL to each media ref for UI/agent convenience. */
function withMediaUrls(m: StoredMessage) {
  return {
    ...m,
    media: m.media.map((x) => ({ ...x, url: `/api/messages/media/${x.id}` })),
  };
}

/**
 * GET /api/messages — search the local archive.
 * Query: q, platform, chat, since, until (epoch ms or ISO), hasMedia, limit.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const platform = p.get("platform");
  if (platform && platform !== "signal" && platform !== "whatsapp") {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 });
  }
  const messages = messageStore().search({
    q: p.get("q") ?? undefined,
    platform: (platform as MessagePlatform) ?? undefined,
    chat: p.get("chat") ?? undefined,
    since: parseWhen(p.get("since")),
    until: parseWhen(p.get("until")),
    hasMedia: p.get("hasMedia") === "1" || p.get("hasMedia") === "true",
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
  });
  return NextResponse.json({
    count: messages.length,
    total: messageStore().count(),
    messages: messages.map(withMediaUrls),
  });
}

/**
 * POST /api/messages — the generic bridge drop-off: any local bridge you run
 * (Baileys, whatsmeow, mautrix, a signal-cli script, ...) can push normalized
 * messages here. Disabled until MESSAGES_BRIDGE_TOKEN is set, and every request
 * must present it in `x-bridge-token` — so nothing on your network can write to
 * the archive uninvited.
 *
 * Body: { messages: BridgeMessage[] } or a single BridgeMessage.
 */
export async function POST(req: Request) {
  const token = process.env.MESSAGES_BRIDGE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Bridge ingest is disabled. Set MESSAGES_BRIDGE_TOKEN in .env to enable it." },
      { status: 403 },
    );
  }
  if (req.headers.get("x-bridge-token") !== token) {
    return NextResponse.json({ error: "Invalid bridge token" }, { status: 401 });
  }

  let body: { messages?: BridgeMessage[] } | BridgeMessage;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const list = Array.isArray((body as { messages?: BridgeMessage[] }).messages)
    ? (body as { messages: BridgeMessage[] }).messages
    : [body as BridgeMessage];

  let stored = 0;
  let duplicates = 0;
  const errors: string[] = [];
  for (const m of list) {
    try {
      const result = messageStore().ingest(normalizeBridgeMessage(m));
      if (result) stored++;
      else duplicates++;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  const status = errors.length && !stored && !duplicates ? 400 : 200;
  return NextResponse.json({ stored, duplicates, errors }, { status });
}
