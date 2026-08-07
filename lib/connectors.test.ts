import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectorForTarget, enabledConnectors, mcpRequestFragments } from "@/lib/connectors";

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

describe("connectors", () => {
  beforeEach(() => {
    for (const k of CONNECTOR_ENV) delete process.env[k];
  });
  afterEach(() => {
    for (const k of CONNECTOR_ENV) delete process.env[k];
  });

  it("skips connectors with no URL", () => {
    expect(enabledConnectors()).toEqual([]);
  });

  it("enables a connector with a URL even when the token is blank (Option A)", () => {
    process.env.ZAPIER_MCP_URL = "https://mcp.zapier.com/abc";
    const enabled = enabledConnectors();
    expect(enabled.map((c) => c.name)).toEqual(["zapier"]);
    expect(enabled[0].token).toBe("");
  });

  it("omits authorization_token from the request when no token is set", () => {
    process.env.ZAPIER_MCP_URL = "https://mcp.zapier.com/abc";
    const { mcp_servers } = mcpRequestFragments(enabledConnectors());
    expect(mcp_servers[0]).not.toHaveProperty("authorization_token");
  });

  it("includes authorization_token when a token is set", () => {
    process.env.NOTION_MCP_URL = "https://mcp.notion.com/mcp";
    process.env.NOTION_MCP_TOKEN = "secret";
    const { mcp_servers, tools } = mcpRequestFragments(enabledConnectors());
    expect(mcp_servers[0]).toMatchObject({
      name: "notion",
      url: "https://mcp.notion.com/mcp",
      authorization_token: "secret",
    });
    expect(tools[0]).toEqual({ type: "mcp_toolset", mcp_server_name: "notion" });
  });

  it("routes Gmail/Telegram share targets to the Zapier connector", () => {
    process.env.ZAPIER_MCP_URL = "https://mcp.zapier.com/abc";
    expect(connectorForTarget("gmail")?.name).toBe("zapier");
    expect(connectorForTarget("telegram")?.name).toBe("zapier");
  });

  it("returns null for a target whose connector is not configured", () => {
    expect(connectorForTarget("slack")).toBeNull();
  });
});
