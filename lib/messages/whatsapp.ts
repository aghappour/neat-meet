/**
 * WhatsApp message ingestion. Two supported paths:
 *
 * 1. OFFICIAL — WhatsApp Business Cloud API webhooks. Meta POSTs message events
 *    to /api/messages/whatsapp; media is referenced by id and downloaded from
 *    the Graph API with your access token. Requires a (free) Meta developer app
 *    and a WhatsApp Business number. This is the only Meta-sanctioned API, but
 *    it only sees traffic on the *business* number.
 *
 * 2. BRIDGE — a generic authenticated endpoint (/api/messages) that accepts
 *    already-normalized messages from any local bridge you run against your
 *    personal account (Baileys, whatsmeow, mautrix-whatsapp, ...). Unofficial
 *    bridges violate WhatsApp's ToS and risk account bans — that tradeoff is
 *    yours to make, so the app doesn't embed one; it just gives you a local,
 *    token-protected drop-off (see docs/MESSAGES.md for a Baileys recipe).
 *
 * This module is the pure/normalization + Graph-download layer; the routes live
 * under app/api/messages/.
 */
import type { IncomingMedia, IncomingMessage } from "./types";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export function whatsappWebhookConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_VERIFY_TOKEN);
}

/** Cloud API webhook payload — only the fields we read. */
export interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<WhatsAppMessage>;
      };
    }>;
  }>;
}

interface WhatsAppMediaRef {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

interface WhatsAppMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WhatsAppMediaRef;
  video?: WhatsAppMediaRef;
  audio?: WhatsAppMediaRef;
  document?: WhatsAppMediaRef;
  sticker?: WhatsAppMediaRef;
}

/** A message plus the media ids that still need a Graph API download. */
export interface NormalizedWhatsApp {
  message: IncomingMessage;
  pendingMedia: Array<{ mediaId: string; contentType: string; filename?: string }>;
}

/**
 * Flatten a Cloud API webhook body into normalized messages. Statuses (sent /
 * delivered / read receipts) and unknown change kinds produce nothing. Pure —
 * media bytes are fetched separately so this can be tested without a network.
 */
export function normalizeWhatsAppWebhook(body: WhatsAppWebhookBody): NormalizedWhatsApp[] {
  const out: NormalizedWhatsApp[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;
      const names = new Map(
        (value.contacts ?? [])
          .filter((c) => c.wa_id && c.profile?.name)
          .map((c) => [c.wa_id!, c.profile!.name!]),
      );
      for (const m of value.messages) {
        if (!m.id || !m.from) continue;
        const mediaRef = m.image ?? m.video ?? m.audio ?? m.document ?? m.sticker;
        const caption = mediaRef?.caption;
        const text = m.text?.body ?? caption ?? "";
        if (!text && !mediaRef) continue; // reactions, locations, unsupported types
        out.push({
          message: {
            platform: "whatsapp",
            externalId: m.id,
            chatId: m.from,
            chatName: names.get(m.from),
            sender: m.from,
            senderName: names.get(m.from),
            fromMe: false,
            at: m.timestamp ? Number(m.timestamp) * 1000 : Date.now(),
            text,
            media: [],
          },
          pendingMedia: mediaRef?.id
            ? [
                {
                  mediaId: mediaRef.id,
                  contentType: mediaRef.mime_type ?? "application/octet-stream",
                  filename: mediaRef.filename,
                },
              ]
            : [],
        });
      }
    }
  }
  return out;
}

/**
 * Download one media object from the Graph API (two hops: resolve the id to a
 * short-lived URL, then fetch the bytes — both need the access token).
 */
export async function fetchWhatsAppMedia(
  mediaId: string,
  contentType: string,
  filename?: string,
): Promise<IncomingMedia | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;
  const auth = { authorization: `Bearer ${token}` };
  try {
    const meta = await fetch(`${GRAPH_BASE}/${encodeURIComponent(mediaId)}`, { headers: auth });
    if (!meta.ok) throw new Error(`media lookup HTTP ${meta.status}`);
    const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
    if (!url) throw new Error("media lookup returned no URL");
    const file = await fetch(url, { headers: auth });
    if (!file.ok) throw new Error(`media download HTTP ${file.status}`);
    return {
      contentType: mime_type ?? contentType,
      filename,
      data: Buffer.from(await file.arrayBuffer()),
    };
  } catch (err) {
    console.warn(`[messages] whatsapp: media ${mediaId} not archived (${(err as Error).message})`);
    return null;
  }
}

/** Shape accepted by the generic bridge endpoint (POST /api/messages). */
export interface BridgeMessage {
  platform?: string;
  id?: string;
  chatId?: string;
  chatName?: string;
  sender?: string;
  senderName?: string;
  fromMe?: boolean;
  /** Epoch ms. */
  at?: number;
  text?: string;
  media?: Array<{ contentType?: string; filename?: string; dataBase64?: string }>;
}

/** Validate + normalize one bridge-submitted message. Throws on a bad shape. */
export function normalizeBridgeMessage(m: BridgeMessage): IncomingMessage {
  if (m.platform !== "whatsapp" && m.platform !== "signal") {
    throw new Error(`platform must be "whatsapp" or "signal", got ${JSON.stringify(m.platform)}`);
  }
  if (!m.id) throw new Error("id is required (the platform's message id, used for dedupe)");
  if (!m.chatId) throw new Error("chatId is required");
  if (!m.text && !m.media?.length) throw new Error("a message needs text or media");
  return {
    platform: m.platform,
    externalId: m.id,
    chatId: m.chatId,
    chatName: m.chatName,
    sender: m.sender ?? (m.fromMe ? "me" : m.chatId),
    senderName: m.senderName,
    fromMe: m.fromMe ?? false,
    at: m.at ?? Date.now(),
    text: m.text ?? "",
    media: (m.media ?? [])
      .filter((x) => x.dataBase64)
      .map((x) => ({
        contentType: x.contentType ?? "application/octet-stream",
        filename: x.filename,
        data: Buffer.from(x.dataBase64!, "base64"),
      })),
  };
}
