import { NextResponse } from "next/server";
import { CLAUDE_MODEL, extractJson, firstText, getClient } from "@/lib/claude";
import { connectorForExport, mcpRequestFragments } from "@/lib/connectors";
import { scrubPii } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One well-specified write: create a document with the provided content, verbatim.
const SYSTEM_PROMPT = `You save meeting notes on the user's behalf using the connected MCP tools. Create ONE new document/page with the exact title and markdown content provided — do not rewrite, summarize, or add commentary. If the connector exposes generic actions (Zapier), inspect the available actions first to resolve the right "create page/document/file" action, then execute it once.

After acting, respond with ONLY: { "ok": true, "detail": "where it was saved (include a link if you have one)" } on success, or { "ok": false, "detail": "why it failed" }.`;

export async function POST(req: Request) {
  let body: {
    target?: "notion" | "gdrive";
    title?: string;
    markdown?: string;
    blockConnectors?: boolean;
    scrubPii?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Per-meeting privacy hold applies to exports too.
  if (body.blockConnectors) {
    return NextResponse.json(
      { error: 'Export is disabled for this meeting ("Hold connectors" is on). Use the .md download instead.' },
      { status: 403 },
    );
  }

  const { target, title, markdown } = body;
  if (!target || !title || !markdown) {
    return NextResponse.json({ error: "target, title, and markdown are required" }, { status: 400 });
  }
  if (target !== "notion" && target !== "gdrive") {
    return NextResponse.json({ error: `Unknown export target: ${target}` }, { status: 400 });
  }

  const connector = connectorForExport(target);
  if (!connector) {
    const env = target === "notion" ? "NOTION_MCP_URL" : "GDRIVE_MCP_URL";
    return NextResponse.json(
      { error: `No connector configured for ${target}. Set ${env} (or ZAPIER_MCP_URL) in .env.` },
      { status: 400 },
    );
  }

  const content = body.scrubPii ? scrubPii(markdown) : markdown;
  const where = target === "notion" ? "a new Notion page" : "a new Google Drive document";

  try {
    const client = getClient();
    const { mcp_servers, tools } = mcpRequestFragments([connector]);
    const params: Record<string, unknown> = {
      model: CLAUDE_MODEL,
      // Creating a document can take an inspect + a write with a large body.
      max_tokens: 6000,
      betas: ["mcp-client-2025-11-20"],
      system: SYSTEM_PROMPT,
      mcp_servers,
      tools,
      messages: [
        {
          role: "user",
          content: `Create ${where} titled "${title}" with exactly this markdown content:\n\n${content}`,
        },
      ],
    };
    const res = await client.beta.messages.create(params as never);
    const result = extractJson<{ ok: boolean; detail?: string }>(firstText(res.content as never));
    if (!result.ok) {
      return NextResponse.json(
        { error: result.detail ?? "The connector could not save the export" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, detail: result.detail ?? "saved" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
