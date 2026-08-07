import { NextResponse } from "next/server";
import { CLAUDE_MODEL, extractJson, firstText, getClient } from "@/lib/claude";
import { connectorForTarget, mcpRequestFragments } from "@/lib/connectors";
import type { Insight, ShareTarget } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TARGETS: ShareTarget[] = ["slack", "notion", "gmail", "telegram"];

// Delivering through the same MCP connector layer keeps write access consistent
// with grounding — Claude calls the connector's tool to perform the send.
const SYSTEM_PROMPT = `You deliver a short insight to a destination on the user's behalf using the connected MCP tools. Perform exactly one send to the requested destination and nothing else. Do not summarize or editorialize — send the provided text.

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
  if (!VALID_TARGETS.includes(target)) {
    return NextResponse.json({ error: `Unknown target: ${target}` }, { status: 400 });
  }

  const connector = connectorForTarget(target);
  if (!connector) {
    const hint =
      target === "gmail" || target === "telegram"
        ? "Configure ZAPIER_MCP_URL/ZAPIER_MCP_TOKEN and enable the Gmail/Telegram Zapier action."
        : `Configure the ${target} MCP connector in .env.`;
    return NextResponse.json(
      { error: `No connector configured for ${target}. ${hint}` },
      { status: 400 },
    );
  }

  const text = `${insight.title}\n\n${insight.insight}${insight.url ? `\n\n${insight.url}` : ""}`;
  const instruction = `Send this insight to ${target} destination "${destination}":\n\n${text}`;

  try {
    const client = getClient();
    const { mcp_servers, tools } = mcpRequestFragments([connector]);
    const params: Record<string, unknown> = {
      model: CLAUDE_MODEL,
      max_tokens: 800,
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
