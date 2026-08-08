import { NextResponse } from "next/server";
import { CLAUDE_MODEL, extractJson, firstText, getClient } from "@/lib/claude";
import { SHARE_TARGETS, connectorForTarget, mcpRequestFragments } from "@/lib/connectors";
import { directTargets, sendViaZapier } from "@/lib/zapier";
import type { Insight, ShareTarget } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delivering through the same MCP connector layer keeps write access consistent
// with grounding — Claude calls the connector's tool to perform the send.
const SYSTEM_PROMPT = `You deliver a short insight to a destination on the user's behalf using the connected MCP tools. Perform exactly one send to the requested destination and nothing else. Do not summarize or editorialize — send the provided text.

Some connectors (Zapier) expose generic action tools rather than one tool per app: you first inspect the available actions to resolve the exact action key and its parameter schema, then execute that action. Do not guess an action key — resolve it first, then send once.

After acting, respond with ONLY: { "ok": true, "detail": "what you did" } on success, or { "ok": false, "detail": "why it failed" } if you could not.`;

export async function POST(req: Request) {
  let body: { insight?: Insight; target?: ShareTarget; destination?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { insight, target, destination } = body;

  if (!insight || !target || !destination) {
    return NextResponse.json(
      { error: "insight, target, and destination are required" },
      { status: 400 },
    );
  }
  if (!SHARE_TARGETS.includes(target)) {
    return NextResponse.json({ error: `Unknown target: ${target}` }, { status: 400 });
  }

  const connector = connectorForTarget(target);
  if (!connector) {
    // Reaching here means neither the dedicated connector nor the Zapier
    // fallback is configured, so name both routes.
    const hint =
      target === "gmail" || target === "telegram"
        ? `Set ZAPIER_MCP_URL in .env and enable the ${target} action on your Zapier MCP server.`
        : `Set ${target.toUpperCase()}_MCP_URL in .env, or set ZAPIER_MCP_URL and enable the ${target} action on your Zapier MCP server.`;
    return NextResponse.json(
      { error: `No connector configured for ${target}. ${hint}` },
      { status: 400 },
    );
  }

  const body_text = `${insight.insight}${insight.url ? `\n\n${insight.url}` : ""}`;

  // Fast path. This send is fully specified — this text, this target, this
  // destination — so there is no decision a model needs to make. Going direct
  // skips the Anthropic API entirely, which means sharing keeps working with no
  // API credits, no added latency, and no chance of the model picking the wrong
  // action. Anything Zapier can't deliver directly falls through to Claude.
  if (connector.name === "zapier" && directTargets().includes(target)) {
    try {
      const { detail } = await sendViaZapier(target, destination, insight.title, body_text);
      return NextResponse.json({ ok: true, detail });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
  }

  const text = `${insight.title}\n\n${body_text}`;
  const instruction = `Send this insight to ${target} destination "${destination}":\n\n${text}`;

  try {
    const client = getClient();
    const { mcp_servers, tools } = mcpRequestFragments([connector]);
    const params: Record<string, unknown> = {
      model: CLAUDE_MODEL,
      // Generic-action connectors need an inspect call before the send, so the
      // budget has to cover several tool-use turns plus the JSON verdict.
      max_tokens: 4000,
      betas: ["mcp-client-2025-11-20"],
      system: SYSTEM_PROMPT,
      mcp_servers,
      tools,
      messages: [{ role: "user", content: instruction }],
    };
    const res = await client.beta.messages.create(params as never);
    const result = extractJson<{ ok: boolean; detail?: string }>(firstText(res.content as never));
    if (!result.ok) {
      return NextResponse.json(
        { error: result.detail ?? "The connector could not deliver the message" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, detail: result.detail ?? "sent" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
