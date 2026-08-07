import type { ShareTarget } from "@/lib/types";

/** A hosted MCP server the insight engine can attach to Claude. */
export interface Connector {
  /** Stable name; also used as the MCP tool namespace. */
  name: string;
  /** Human label for prompts/UI. */
  label: string;
  /** Hosted MCP endpoint URL (from env). */
  url: string;
  /**
   * Optional bearer token for the endpoint (from env). Some hosted MCP servers
   * (e.g. Zapier) embed auth in the URL itself, so no separate token is needed —
   * a connector is enabled as long as it has a URL.
   */
  token: string;
}

interface ConnectorSpec {
  name: string;
  label: string;
  urlEnv: string;
  tokenEnv: string;
  /** Which share targets this connector can deliver. */
  shareTargets: ShareTarget[];
}

// Notion/Slack/Drive are grounded directly. Zapier is the fan-out for Gmail +
// Telegram (and anything else), so those share targets route through it.
const SPECS: ConnectorSpec[] = [
  { name: "notion", label: "Notion", urlEnv: "NOTION_MCP_URL", tokenEnv: "NOTION_MCP_TOKEN", shareTargets: ["notion"] },
  { name: "slack", label: "Slack", urlEnv: "SLACK_MCP_URL", tokenEnv: "SLACK_MCP_TOKEN", shareTargets: ["slack"] },
  { name: "gdrive", label: "Google Drive", urlEnv: "GDRIVE_MCP_URL", tokenEnv: "GDRIVE_MCP_TOKEN", shareTargets: [] },
  { name: "zapier", label: "Zapier (Gmail, Telegram)", urlEnv: "ZAPIER_MCP_URL", tokenEnv: "ZAPIER_MCP_TOKEN", shareTargets: ["gmail", "telegram"] },
];

/** Connectors that have a URL configured (token is optional). */
export function enabledConnectors(): Connector[] {
  const out: Connector[] = [];
  for (const spec of SPECS) {
    const url = process.env[spec.urlEnv];
    if (url) {
      out.push({ name: spec.name, label: spec.label, url, token: process.env[spec.tokenEnv] ?? "" });
    }
  }
  return out;
}

/** The connector that can deliver a given share target, if configured. */
export function connectorForTarget(target: ShareTarget): Connector | null {
  const spec = SPECS.find((s) => s.shareTargets.includes(target));
  if (!spec) return null;
  const url = process.env[spec.urlEnv];
  if (!url) return null;
  return { name: spec.name, label: spec.label, url, token: process.env[spec.tokenEnv] ?? "" };
}

/**
 * Build the `mcp_servers` + `mcp_toolset` request fragments for the Claude beta
 * MCP connector API from the enabled connectors.
 */
export function mcpRequestFragments(connectors: Connector[]) {
  return {
    mcp_servers: connectors.map((c) => ({
      type: "url" as const,
      name: c.name,
      url: c.url,
      // Only include a token when one is configured; URL-embedded-auth servers
      // (e.g. Zapier) don't have a separate token.
      ...(c.token ? { authorization_token: c.token } : {}),
    })),
    tools: connectors.map((c) => ({ type: "mcp_toolset" as const, mcp_server_name: c.name })),
  };
}
