import { afterEach, describe, expect, it } from "vitest";
import { normalizeSignalEnvelope, signalEventsUrl, type SignalEnvelope } from "./signal-ingest";

afterEach(() => {
  delete process.env.SIGNAL_ATTACHMENTS_DIR;
});

describe("normalizeSignalEnvelope", () => {
  it("normalizes a direct incoming message", () => {
    const envelope: SignalEnvelope = {
      source: "+15550001111",
      sourceNumber: "+15550001111",
      sourceName: "Alice",
      timestamp: 1_700_000_000_000,
      dataMessage: { timestamp: 1_700_000_000_000, message: "see you at 6" },
    };
    expect(normalizeSignalEnvelope(envelope)).toMatchObject({
      platform: "signal",
      externalId: "+15550001111-1700000000000",
      chatId: "+15550001111",
      chatName: "Alice",
      sender: "+15550001111",
      senderName: "Alice",
      fromMe: false,
      at: 1_700_000_000_000,
      text: "see you at 6",
    });
  });

  it("normalizes a group message with attachments to archive-copyable paths", () => {
    process.env.SIGNAL_ATTACHMENTS_DIR = "/sig/attachments";
    const envelope: SignalEnvelope = {
      sourceNumber: "+15550002222",
      sourceName: "Bob",
      timestamp: 1_700_000_001_000,
      dataMessage: {
        message: "photos!",
        groupInfo: { groupId: "grp==", groupName: "Hiking" },
        attachments: [
          { contentType: "image/jpeg", filename: "trail.jpg", id: "att-1" },
          { contentType: "image/png", file: "/sig/attachments/att-2" },
        ],
      },
    };
    const out = normalizeSignalEnvelope(envelope);
    expect(out).toMatchObject({ chatId: "grp==", chatName: "Hiking" });
    expect(out?.media).toEqual([
      { contentType: "image/jpeg", filename: "trail.jpg", sourcePath: "/sig/attachments/att-1" },
      { contentType: "image/png", filename: undefined, sourcePath: "/sig/attachments/att-2" },
    ]);
  });

  it("normalizes your own sent messages from the device sync", () => {
    const envelope: SignalEnvelope = {
      source: "+19998887777", // your own account
      timestamp: 1_700_000_002_000,
      syncMessage: {
        sentMessage: {
          destinationNumber: "+15550001111",
          timestamp: 1_700_000_002_000,
          message: "on my way",
        },
      },
    };
    expect(normalizeSignalEnvelope(envelope)).toMatchObject({
      externalId: "me-1700000002000",
      chatId: "+15550001111",
      sender: "me",
      fromMe: true,
      text: "on my way",
    });
  });

  it("ignores receipts / typing / empty envelopes", () => {
    expect(normalizeSignalEnvelope({ source: "+1555", timestamp: 1 })).toBeNull();
    expect(
      normalizeSignalEnvelope({ source: "+1555", dataMessage: { message: null, attachments: [] } }),
    ).toBeNull();
  });

  it("keeps an attachment-only message (image with no caption)", () => {
    const out = normalizeSignalEnvelope({
      sourceNumber: "+1555",
      timestamp: 5,
      dataMessage: { attachments: [{ contentType: "image/jpeg", id: "a" }] },
    });
    expect(out?.text).toBe("");
    expect(out?.media).toHaveLength(1);
  });
});

describe("signalEventsUrl", () => {
  it("derives the SSE endpoint from the configured JSON-RPC URL", () => {
    expect(signalEventsUrl("http://127.0.0.1:8686/api/v1/rpc")).toBe(
      "http://127.0.0.1:8686/api/v1/events",
    );
  });

  it("adds the account for multi-account daemons", () => {
    expect(signalEventsUrl("http://127.0.0.1:8686/api/v1/rpc", "+1999")).toBe(
      "http://127.0.0.1:8686/api/v1/events?account=%2B1999",
    );
  });
});
