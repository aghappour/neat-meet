import { NextResponse } from "next/server";
import { CLAUDE_MODEL, extractJson, firstText, getClient } from "@/lib/claude";
import { hasContent, recentTranscript } from "@/lib/session-store";
import { enabledConnectors, mcpRequestFragments } from "@/lib/connectors";
import type { Insight } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You help someone in a live meeting by surfacing 3-5 sharable insights.

You may have MCP tools connected to the user's Notion, Slack, Google Drive, and Zapier. When they are present, search them for material relevant to what's being discussed and ground your insights in real content (cite the document/message and include a link when you have one). If no tools are connected, produce insights from the transcript alone and set source to "Live discussion".

Some connectors (Zapier) expose generic action tools rather than one tool per app: inspect the available actions first to resolve the exact action key and parameter schema, then execute a read action. Prefer find/search/get actions over "new item" ones — the latter only report what changed since a previous poll and will return nothing on a full account. Two or three well-chosen reads are plenty; don't exhaustively enumerate.

After any tool use, respond with ONLY a JSON array, no prose, matching exactly:
[
  { "title": "short headline", "insight": "1-2 sentences the user could say or share", "source": "e.g. Notion: Q3 Planning, or Live discussion", "url": "optional deep link" }
]

Keep insights specific and immediately useful. Prefer grounded facts over generic advice. Use [] if there is nothing worth surfacing.`;

export async function POST(req: Request) {
  let sessionId: string;
  try {
    ({ sessionId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  if (!hasContent(sessionId)) {
    return NextResponse.json({ error: "No transcript yet" }, { status: 400 });
  }

  const transcript = recentTranscript(sessionId, 4000);
  const connectors = enabledConnectors();

  try {
    const client = getClient();
    const params: Record<string, unknown> = {
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      betas: ["mcp-client-2025-11-20"],
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Recent discussion:\n\n${transcript}\n\nSurface sharable insights as instructed.`,
        },
      ],
    };
    // Attach connectors only when configured (empty mcp_servers would 400).
    if (connectors.length > 0) {
      const { mcp_servers, tools } = mcpRequestFragments(connectors);
      params.mcp_servers = mcp_servers;
      params.tools = tools;
    }

    // MCP connector fields aren't in SDK 0.68 types; use the beta endpoint untyped.
    const res = await client.beta.messages.create(params as never);
    const insights = extractJson<Insight[]>(firstText(res.content as never));
    return NextResponse.json({
      insights: Array.isArray(insights) ? insights.slice(0, 6) : [],
      grounded: connectors.map((c) => c.label),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
