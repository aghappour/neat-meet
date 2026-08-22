import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessageStore } from "./store";
import type { IncomingMessage } from "./types";

let dir: string;
let store: MessageStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "neat-meet-msgs-"));
  store = new MessageStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function msg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: "signal",
    externalId: "1000",
    chatId: "+15550001111",
    sender: "+15550001111",
    senderName: "Alice",
    fromMe: false,
    at: 1_700_000_000_000,
    text: "hello there",
    ...overrides,
  };
}

describe("MessageStore", () => {
  it("stores a message and survives a reload from disk", () => {
    const stored = store.ingest(msg());
    expect(stored?.id).toBe("signal:1000");

    const reloaded = new MessageStore(dir);
    expect(reloaded.count()).toBe(1);
    expect(reloaded.search()[0].text).toBe("hello there");
  });

  it("dedupes by platform + external id (webhook retries, reconnect replays)", () => {
    expect(store.ingest(msg())).not.toBeNull();
    expect(store.ingest(msg())).toBeNull();
    // Same external id on the other platform is a different message.
    expect(store.ingest(msg({ platform: "whatsapp" }))).not.toBeNull();
    expect(store.count()).toBe(2);
  });

  it("persists media bytes by content hash and dedupes identical files", () => {
    const data = Buffer.from("fake-jpeg-bytes");
    const a = store.ingest(
      msg({ media: [{ contentType: "image/jpeg", filename: "sunset.jpg", data }] }),
    );
    const b = store.ingest(
      msg({ externalId: "1001", media: [{ contentType: "image/jpeg", data }] }),
    );
    expect(a?.media[0].id).toMatch(/^[0-9a-f]{24}\.jpg$/);
    expect(a?.media[0].id).toBe(b?.media[0].id);
    expect(a?.media[0].filename).toBe("sunset.jpg");
    expect(readdirSync(join(dir, "media"))).toHaveLength(1);

    const path = store.mediaPath(a!.media[0].id);
    expect(path && readFileSync(path)).toEqual(data);
  });

  it("rejects media ids that are not hash-named (no path traversal)", () => {
    expect(store.mediaPath("../messages.jsonl")).toBeNull();
    expect(store.mediaPath("..%2f..%2fetc")).toBeNull();
    expect(store.mediaPath("deadbeefdeadbeefdeadbeef.jpg")).toBeNull(); // valid shape, unknown file
  });

  it("drops empty/missing attachments without failing the message", () => {
    const stored = store.ingest(
      msg({
        media: [
          { contentType: "image/png", sourcePath: join(dir, "does-not-exist") },
          { contentType: "image/png", data: Buffer.alloc(0) },
        ],
      }),
    );
    expect(stored?.text).toBe("hello there");
    expect(stored?.media).toEqual([]);
  });

  it("searches by text, sender name, chat, platform, time, and media", () => {
    store.ingest(msg({ externalId: "1", text: "dinner on sunday?" }));
    store.ingest(
      msg({
        externalId: "2",
        platform: "whatsapp",
        chatId: "wa-group-1",
        chatName: "Family",
        senderName: "Mom",
        text: "photos from the trip",
        at: 1_700_000_100_000,
        media: [{ contentType: "image/jpeg", data: Buffer.from("img") }],
      }),
    );

    expect(store.search({ q: "dinner" })).toHaveLength(1);
    expect(store.search({ q: "mom" })).toHaveLength(1);
    expect(store.search({ chat: "family" })).toHaveLength(1);
    expect(store.search({ platform: "whatsapp" })).toHaveLength(1);
    expect(store.search({ since: 1_700_000_050_000 })).toHaveLength(1);
    expect(store.search({ until: 1_700_000_050_000 })).toHaveLength(1);
    expect(store.search({ hasMedia: true })[0].chatName).toBe("Family");
  });

  it("keeps the newest messages when a limit trims results", () => {
    for (let i = 0; i < 5; i++) {
      store.ingest(msg({ externalId: String(i), text: `m${i}`, at: 1000 + i }));
    }
    const out = store.search({ limit: 2 });
    expect(out.map((m) => m.text)).toEqual(["m3", "m4"]);
  });

  it("summarizes chats with counts and latest activity", () => {
    store.ingest(msg({ externalId: "1", text: "first", at: 1000 }));
    store.ingest(msg({ externalId: "2", text: "second", at: 2000 }));
    store.ingest(
      msg({
        externalId: "3",
        platform: "whatsapp",
        chatId: "wa-1",
        chatName: "Work",
        text: "standup moved",
        at: 3000,
        media: [{ contentType: "image/png", data: Buffer.from("x") }],
      }),
    );
    const chats = store.listChats();
    expect(chats).toHaveLength(2);
    expect(chats[0]).toMatchObject({ chatName: "Work", messageCount: 1, mediaCount: 1 });
    expect(chats[1]).toMatchObject({ chatId: "+15550001111", messageCount: 2, lastText: "second" });
  });

  it("skips a torn trailing line instead of corrupting the archive", () => {
    store.ingest(msg());
    const log = join(dir, "messages.jsonl");
    const content = readFileSync(log, "utf8");
    // Simulate a crash mid-append.
    rmSync(log);
    writeFileSync(log, content + '{"id":"signal:9999","platform":"si');
    const reloaded = new MessageStore(dir);
    expect(reloaded.count()).toBe(1);
  });
});
