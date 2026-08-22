/**
 * Direct Zapier MCP client.
 *
 * Sharing an insight is a fully-specified job — this text, to this target, at
 * this destination — so routing it through a model costs an API call, adds
 * latency, and introduces a failure mode (the model picking the wrong action)
 * for no decision that actually needs making. This module talks JSON-RPC to the
 * Zapier MCP endpoint directly, which means sharing works with no Anthropic
 * credits at all.
 *
 * Insight *generation* still goes through Claude — that one is genuine synthesis.
 */
import type { ShareTarget } from "@/lib/types";

const PROTOCOL_VERSION = "2025-06-18";

/** Zapier exposes generic action tools; these are the two we drive. */
const INSPECT = "inspect_zapier_actions";
const EXECUTE = "execute_zapier_write_action";

interface Endpoint {
  url: string;
  token: string;
}

function endpoint(): Endpoint | null {
  const url = process.env.ZAPIER_MCP_URL;
  if (!url) return null;
  return { url, token: process.env.ZAPIER_MCP_TOKEN ?? "" };
}

export function zapierConfigured(): boolean {
  return endpoint() !== null;
}

/**
 * Pull the first JSON-RPC message out of a response body. The transport is
 * "streamable HTTP", so the body is either bare JSON or SSE frames.
 */
function parseRpcBody(body: string): Record<string, unknown> {
  for (const raw of body.split("\n")) {
    const line = raw.startsWith("data:") ? raw.slice(5).trim() : raw.trim();
    if (line.startsWith("{")) return JSON.parse(line) as Record<string, unknown>;
  }
  throw new Error("Zapier MCP returned no JSON-RPC message");
}

/** One MCP session. `initialize` issues the session id later calls must echo. */
class ZapierSession {
  private constructor(
    private readonly ep: Endpoint,
    private readonly sessionId: string | null,
  ) {}

  private static headers(ep: Endpoint, sessionId?: string | null): HeadersInit {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(ep.token ? { authorization: `Bearer ${ep.token}` } : {}),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    };
  }

  static async open(): Promise<ZapierSession> {
    const ep = endpoint();
    if (!ep) throw new Error("ZAPIER_MCP_URL is not set");
    const res = await fetch(ep.url, {
      method: "POST",
      headers: ZapierSession.headers(ep),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "neat-meet", version: "0.1.0" },
        },
      }),
    });
    if (!res.ok) {
      const detail = res.status === 401 ? " (check ZAPIER_MCP_TOKEN)" : "";
      throw new Error(`Zapier MCP handshake failed: HTTP ${res.status}${detail}`);
    }
    return new ZapierSession(ep, res.headers.get("mcp-session-id"));
  }

  /** Call a tool and return its parsed JSON payload. */
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.ep.url, {
      method: "POST",
      headers: ZapierSession.headers(this.ep, this.sessionId),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    if (!res.ok) throw new Error(`Zapier MCP ${name} failed: HTTP ${res.status}`);
    const msg = parseRpcBody(await res.text());
    if (msg.error) {
      const e = msg.error as { message?: string };
      throw new Error(`Zapier MCP ${name}: ${e.message ?? "unknown error"}`);
    }
    const result = msg.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
    const text = result?.content?.[0]?.text;
    if (typeof text !== "string") return null;
    if (result?.isError) throw new Error(`Zapier MCP ${name}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

/**
 * How each share target maps onto a Zapier write action.
 *
 * `destParam` is the field the user's "destination" fills. When it's a dynamic
 * enum (a Slack channel, a Notion parent page) the human-readable destination
 * has to be resolved to Zapier's internal value first.
 */
interface SendSpec {
  selectedApi: string;
  action: string;
  toolName: string;
  destParam: string;
  destIsEnum: boolean;
  build(dest: string, title: string, body: string): Record<string, unknown>;
}

const SEND_SPECS: Partial<Record<ShareTarget, SendSpec>> = {
  slack: {
    selectedApi: "SlackCLIAPI",
    action: "channel_message",
    toolName: "slack_send_channel_message",
    destParam: "channel",
    destIsEnum: true,
    build: (dest, title, body) => ({ channel: dest, text: `*${title}*\n${body}`, as_bot: true }),
  },
  gmail: {
    selectedApi: "GoogleMailV2CLIAPI",
    action: "message",
    toolName: "gmail_send_email",
    destParam: "to",
    destIsEnum: false,
    build: (dest, title, body) => ({ to: dest, subject: title, body, body_type: "plain" }),
  },
  notion: {
    selectedApi: "NotionCLIAPI",
    action: "create_page",
    toolName: "notion_create_page",
    destParam: "parent_page",
    destIsEnum: true,
    build: (dest, title, body) => ({ parent_page: dest, title, content: body }),
  },
};

/** Share targets this module can deliver directly, without a model in the loop. */
export function directTargets(): ShareTarget[] {
  return zapierConfigured() ? (Object.keys(SEND_SPECS) as ShareTarget[]) : [];
}

/**
 * Turn a human destination ("#general", "Team Notes") into the value Zapier's
 * dynamic enum expects. Exact label matches win; otherwise a unique
 * case-insensitive match is accepted, and anything ambiguous is reported with
 * the candidates so the user can disambiguate rather than us guessing.
 */
async function resolveEnum(
  session: ZapierSession,
  spec: SendSpec,
  dest: string,
): Promise<string> {
  const needle = dest.replace(/^[#@]/, "").trim();
  const raw = (await session.call(INSPECT, {
    tool_name: spec.toolName,
    enum_property: spec.destParam,
    enum_search: needle,
  })) as unknown;

  const values = collectEnumValues(raw);
  if (values.length === 0) {
    throw new Error(`No ${spec.destParam} matching "${dest}" — check the name and try again.`);
  }
  const exact = values.filter((v) => v.label.replace(/^[#@]/, "").toLowerCase() === needle.toLowerCase());
  const pool = exact.length > 0 ? exact : values;
  if (pool.length > 1) {
    const names = pool.slice(0, 5).map((v) => v.label).join(", ");
    throw new Error(`"${dest}" matches several destinations (${names}) — be more specific.`);
  }
  return pool[0].value;
}

/** Dig `{value,label}` pairs out of the inspect response without assuming its shape. */
function collectEnumValues(raw: unknown): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.value === "string" && typeof obj.label === "string") {
      out.push({ value: obj.value, label: obj.label });
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(raw);
  return out;
}

/** Deliver an insight through Zapier with no model in the loop. */
export async function sendViaZapier(
  target: ShareTarget,
  destination: string,
  title: string,
  body: string,
): Promise<{ detail: string }> {
  const spec = SEND_SPECS[target];
  if (!spec) {
    throw new Error(`Zapier direct send does not support ${target} yet.`);
  }
  const session = await ZapierSession.open();
  const destValue = spec.destIsEnum
    ? await resolveEnum(session, spec, destination)
    : destination;

  const params = { ...spec.build(destValue, title, body), [spec.destParam]: destValue };
  await session.call(EXECUTE, {
    selected_api: spec.selectedApi,
    action: spec.action,
    tool_name: spec.toolName,
    params,
  });
  return { detail: `Sent to ${destination} via Zapier (${target}).` };
}
