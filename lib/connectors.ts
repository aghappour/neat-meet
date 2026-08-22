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
  // Label stays generic: Zapier is also the fallback for targets whose own
  // connector isn't configured, so naming specific apps here understates it.
  { name: "zapier", label: "Zapier", urlEnv: "ZAPIER_MCP_URL", tokenEnv: "ZAPIER_MCP_TOKEN", shareTargets: ["gmail", "telegram"] },
];

/** Every share target the app knows how to deliver, in UI order. */
export const SHARE_TARGETS: ShareTarget[] = ["slack", "notion", "gmail", "telegram", "signal"];

/** Resolve a spec against the environment, or null when it has no URL. */
function fromSpec(spec: ConnectorSpec): Connector | null {
  const url = process.env[spec.urlEnv];
  if (!url) return null;
  return { name: spec.name, label: spec.label, url, token: process.env[spec.tokenEnv] ?? "" };
}

/** Connectors that have a URL configured (token is optional). */
export function enabledConnectors(): Connector[] {
  return SPECS.map(fromSpec).filter((c): c is Connector => c !== null);
}

/**
 * The connector that can deliver a given share target.
 *
 * Prefers the target's dedicated connector, then falls back to Zapier. Zapier
 * fans out to whichever apps are enabled on the account, so a Zapier-only setup
 * can usually deliver Slack or Notion even with no dedicated connector for
 * them — without the fallback those sends are rejected outright despite being
 * perfectly deliverable.
 */
export function connectorForTarget(target: ShareTarget): Connector | null {
  // Signal is delivered by the LOCAL signal-cli bridge (lib/signal.ts), never
  // by an MCP connector — and it must not fall through to Zapier.
  if (target === "signal") return null;
  const spec = SPECS.find((s) => s.shareTargets.includes(target));
  const direct = spec ? fromSpec(spec) : null;
  if (direct) return direct;

  const zapier = SPECS.find((s) => s.name === "zapier");
  // Nothing to fall back to when the target already routes through Zapier.
  if (!zapier || spec === zapier) return null;
  return fromSpec(zapier);
}

/**
 * Share targets a connector can actually deliver right now.
 *
 * Lets the UI offer only what will work instead of surfacing every target and
 * letting the send fail with a 400 after the user has picked one.
 */
export function deliverableTargets(): ShareTarget[] {
  return SHARE_TARGETS.filter((t) => connectorForTarget(t) !== null);
}

/**
 * The connector that can create documents for a post-meeting export target.
 * Notion → the Notion connector; Drive → the Drive connector; either falls
 * back to Zapier when the dedicated connector isn't configured.
 */
export function connectorForExport(target: "notion" | "gdrive"): Connector | null {
  const spec = SPECS.find((s) => s.name === target);
  const direct = spec ? fromSpec(spec) : null;
  if (direct) return direct;
  const zapier = SPECS.find((s) => s.name === "zapier");
  return zapier ? fromSpec(zapier) : null;
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
