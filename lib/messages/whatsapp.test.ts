import { describe, expect, it } from "vitest";
import {
  normalizeBridgeMessage,
  normalizeWhatsAppWebhook,
  type WhatsAppWebhookBody,
} from "./whatsapp";

describe("normalizeWhatsAppWebhook", () => {
  it("normalizes a text message with the contact's profile name", () => {
    const body: WhatsAppWebhookBody = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "123" },
                contacts: [{ wa_id: "15550001111", profile: { name: "Alice" } }],
                messages: [
                  {
                    from: "15550001111",
                    id: "wamid.ABC",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "lunch tomorrow?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const out = normalizeWhatsAppWebhook(body);
    expect(out).toHaveLength(1);
    expect(out[0].message).toMatchObject({
      platform: "whatsapp",
      externalId: "wamid.ABC",
      chatId: "15550001111",
      senderName: "Alice",
      fromMe: false,
      at: 1_700_000_000_000,
      text: "lunch tomorrow?",
    });
    expect(out[0].pendingMedia).toEqual([]);
  });

  it("extracts image messages as pending media with the caption as text", () => {
    const body: WhatsAppWebhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "15550001111",
                    id: "wamid.IMG",
                    timestamp: "1700000001",
                    type: "image",
                    image: { id: "media-1", mime_type: "image/jpeg", caption: "the whiteboard" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const [out] = normalizeWhatsAppWebhook(body);
    expect(out.message.text).toBe("the whiteboard");
    expect(out.pendingMedia).toEqual([
      { mediaId: "media-1", contentType: "image/jpeg", filename: undefined },
    ]);
  });

  it("ignores status-only webhook deliveries and empty bodies", () => {
    expect(normalizeWhatsAppWebhook({})).toEqual([]);
    expect(
      normalizeWhatsAppWebhook({ entry: [{ changes: [{ field: "messages", value: {} }] }] }),
    ).toEqual([]);
  });
});

describe("normalizeBridgeMessage", () => {
  it("normalizes a bridge message with base64 media", () => {
    const out = normalizeBridgeMessage({
      platform: "whatsapp",
      id: "3EB0-XYZ",
      chatId: "12036304@g.us",
      chatName: "Family",
      sender: "15550002222",
      senderName: "Mom",
      at: 1_700_000_000_000,
      text: "look at this",
      media: [{ contentType: "image/png", filename: "cat.png", dataBase64: Buffer.from("img").toString("base64") }],
    });
    expect(out).toMatchObject({
      platform: "whatsapp",
      externalId: "3EB0-XYZ",
      chatName: "Family",
      senderName: "Mom",
      fromMe: false,
    });
    expect(out.media?.[0].data?.toString()).toBe("img");
  });

  it("defaults sender to 'me' for your own messages", () => {
    const out = normalizeBridgeMessage({
      platform: "signal",
      id: "x1",
      chatId: "+1555",
      fromMe: true,
      text: "sent from my phone",
    });
    expect(out.sender).toBe("me");
    expect(out.fromMe).toBe(true);
  });

  it("rejects bad shapes with a reason", () => {
    expect(() => normalizeBridgeMessage({ platform: "telegram", id: "1", chatId: "c", text: "t" }))
      .toThrow(/platform/);
    expect(() => normalizeBridgeMessage({ platform: "whatsapp", chatId: "c", text: "t" }))
      .toThrow(/id is required/);
    expect(() => normalizeBridgeMessage({ platform: "whatsapp", id: "1", text: "t" }))
      .toThrow(/chatId/);
    expect(() => normalizeBridgeMessage({ platform: "whatsapp", id: "1", chatId: "c" }))
      .toThrow(/text or media/);
  });
});
