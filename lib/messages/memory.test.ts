import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMessageContext, formatMessageLine, parseWhen } from "./memory";
import { MessageStore, messageStore } from "./store";

const g = globalThis as typeof globalThis & { __neatMeetMessages?: MessageStore };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "neat-meet-mem-"));
  g.__neatMeetMessages = new MessageStore(dir);
});

afterEach(() => {
  g.__neatMeetMessages = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function seed(n: number, text: (i: number) => string): void {
  for (let i = 0; i < n; i++) {
    messageStore().ingest({
      platform: "signal",
      externalId: String(i),
      chatId: "+15550001111",
      chatName: "Alice",
      sender: "+15550001111",
      senderName: "Alice",
      fromMe: false,
      at: 1_700_000_000_000 + i * 60_000,
      text: text(i),
    });
  }
}

describe("buildMessageContext", () => {
  it("returns a prompt-ready block with platform, time, chat, and sender", () => {
    seed(1, () => "see you at 6");
    const ctx = buildMessageContext();
    expect(ctx.count).toBe(1);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toBe("[signal] 2023-11-14 22:13 · Alice · Alice: see you at 6");
  });

  it("is empty (not a header) when nothing matches", () => {
    expect(buildMessageContext({ q: "nope" })).toEqual({ text: "", count: 0, truncated: false });
  });

  it("drops oldest lines to honor the character budget and marks the trim", () => {
    seed(20, (i) => `message number ${i} with some padding text`);
    const ctx = buildMessageContext({ maxChars: 400 });
    expect(ctx.truncated).toBe(true);
    expect(ctx.count).toBeLessThan(20);
    expect(ctx.text.startsWith("[…older messages omitted to bound cost…]")).toBe(true);
    expect(ctx.text).toContain("message number 19"); // newest survives
    expect(ctx.text).not.toContain("message number 0");
  });

  it("scrubs PII locally when asked", () => {
    seed(1, () => "reach me at alice@example.com");
    const ctx = buildMessageContext({ scrub: true });
    expect(ctx.text).not.toContain("alice@example.com");
  });

  it("labels your own messages as Me and inlines media markers", () => {
    messageStore().ingest({
      platform: "whatsapp",
      externalId: "w1",
      chatId: "grp",
      chatName: "Family",
      sender: "me",
      fromMe: true,
      at: 1_700_000_000_000,
      text: "here it is",
      media: [{ contentType: "image/jpeg", filename: "doc.jpg", data: Buffer.from("x") }],
    });
    const line = formatMessageLine(messageStore().search()[0]);
    expect(line).toContain("· Me: here it is");
    expect(line).toContain("[media: doc.jpg (image/jpeg)]");
  });
});

describe("parseWhen", () => {
  it("accepts epoch ms, ISO dates, and rejects junk", () => {
    expect(parseWhen("1700000000000")).toBe(1_700_000_000_000);
    expect(parseWhen("2023-11-14T22:13:20Z")).toBe(1_700_000_000_000);
    expect(parseWhen("not a date")).toBeUndefined();
    expect(parseWhen(null)).toBeUndefined();
  });
});
