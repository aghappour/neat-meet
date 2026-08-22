// Privacy invariants for neat-meet, kept honest by tests.
//
// The product promises: audio never leaves the machine (only transcript text is
// sent onward), nothing is shared to a service you didn't configure, and a
// meeting's data is ephemeral and isolated. These tests pin the parts of that
// promise that live in code we control.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectorForTarget, enabledConnectors, mcpRequestFragments } from "@/lib/connectors";
import {
  clearSession,
  hasContent,
  recordSegment,
  transcriptText,
} from "@/lib/session-store";
import type { RawSegment } from "@/lib/transcription/provider";

const CONNECTOR_ENV = [
  "NOTION_MCP_URL",
  "NOTION_MCP_TOKEN",
  "SLACK_MCP_URL",
  "SLACK_MCP_TOKEN",
  "GDRIVE_MCP_URL",
  "GDRIVE_MCP_TOKEN",
  "ZAPIER_MCP_URL",
  "ZAPIER_MCP_TOKEN",
];

const raw = (over: Partial<RawSegment> = {}): RawSegment => ({
  speaker: "me",
  text: "hello",
  interim: false,
  startMs: 0,
  at: 1_000,
  ...over,
});

describe("privacy: connectors are strictly opt-in", () => {
  beforeEach(() => {
    for (const k of CONNECTOR_ENV) delete process.env[k];
  });
  afterEach(() => {
    for (const k of CONNECTOR_ENV) delete process.env[k];
  });

  it("attaches no connector when none is configured", () => {
    expect(enabledConnectors()).toEqual([]);
    const { mcp_servers, tools } = mcpRequestFragments(enabledConnectors());
    expect(mcp_servers).toEqual([]);
    expect(tools).toEqual([]);
  });

  it("offers no share target when nothing is configured", () => {
    for (const t of ["slack", "notion", "gmail", "telegram"] as const) {
      expect(connectorForTarget(t)).toBeNull();
    }
  });

  it("never sends an auth token that wasn't set", () => {
    process.env.NOTION_MCP_URL = "https://mcp.notion.com/mcp"; // URL only, no token
    const { mcp_servers } = mcpRequestFragments(enabledConnectors());
    expect(mcp_servers[0]).not.toHaveProperty("authorization_token");
  });

  it("only attaches the connectors that are actually configured", () => {
    process.env.SLACK_MCP_URL = "https://mcp.slack.example/mcp";
    const names = enabledConnectors().map((c) => c.name);
    expect(names).toEqual(["slack"]);
  });
});

describe("privacy: the transcript store holds only text, ephemerally", () => {
  afterEach(() => {
    clearSession("p-a");
    clearSession("p-b");
  });

  it("retains only text metadata — never audio bytes", () => {
    const seg = recordSegment("p-a", raw({ text: "spoken words" }));
    // No stored value is a Buffer / typed array (i.e. no captured audio).
    for (const v of Object.values(seg)) {
      expect(Buffer.isBuffer(v)).toBe(false);
      expect(ArrayBuffer.isView(v)).toBe(false);
    }
    // The stored shape is exactly the text-segment fields, nothing smuggled in.
    expect(Object.keys(seg).sort()).toEqual(["at", "id", "interim", "speaker", "startMs", "text"]);
  });

  it("does not retain interim (unfinalized) speech", () => {
    recordSegment("p-a", raw({ text: "half a th", interim: true }));
    expect(hasContent("p-a")).toBe(false);
    expect(transcriptText("p-a")).toBe("");
  });

  it("keeps sessions isolated from one another", () => {
    recordSegment("p-a", raw({ text: "secret from meeting A" }));
    recordSegment("p-b", raw({ text: "meeting B only" }));
    expect(transcriptText("p-a")).not.toContain("meeting B only");
    expect(transcriptText("p-b")).not.toContain("secret from meeting A");
  });

  it("leaves no residue after a session is cleared", () => {
    recordSegment("p-a", raw({ text: "transient" }));
    expect(hasContent("p-a")).toBe(true);
    clearSession("p-a");
    expect(hasContent("p-a")).toBe(false);
    expect(transcriptText("p-a")).toBe("");
  });
});
