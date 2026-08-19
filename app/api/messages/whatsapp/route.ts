import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { messageStore } from "@/lib/messages/store";
import {
  fetchWhatsAppMedia,
  normalizeWhatsAppWebhook,
  whatsappWebhookConfigured,
  type WhatsAppWebhookBody,
} from "@/lib/messages/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/messages/whatsapp — Meta's webhook verification handshake. Configure
 * this URL as the callback in your Meta app's WhatsApp settings with the same
 * verify token as WHATSAPP_VERIFY_TOKEN in .env.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "WhatsApp webhook is disabled. Set WHATSAPP_VERIFY_TOKEN in .env." },
      { status: 403 },
    );
  }
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

/** Constant-time check of Meta's X-Hub-Signature-256 header (when a secret is set). */
function signatureValid(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // signature checking is optional but recommended
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice("sha256=".length);
  return (
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"))
  );
}

/**
 * POST /api/messages/whatsapp — Cloud API message webhook. Normalizes each
 * message, downloads referenced media from the Graph API (needs
 * WHATSAPP_ACCESS_TOKEN), and archives everything. Responds 200 even for
 * payloads we don't archive (statuses etc.) so Meta doesn't retry forever.
 */
export async function POST(req: Request) {
  if (!whatsappWebhookConfigured()) {
    return NextResponse.json(
      { error: "WhatsApp webhook is disabled. Set WHATSAPP_VERIFY_TOKEN in .env." },
      { status: 403 },
    );
  }
  const raw = await req.text();
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let stored = 0;
  for (const { message, pendingMedia } of normalizeWhatsAppWebhook(body)) {
    const media = [];
    for (const m of pendingMedia) {
      const fetched = await fetchWhatsAppMedia(m.mediaId, m.contentType, m.filename);
      if (fetched) media.push(fetched);
    }
    if (messageStore().ingest({ ...message, media })) stored++;
  }
  return NextResponse.json({ ok: true, stored });
}
