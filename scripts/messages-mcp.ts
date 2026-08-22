/**
 * MCP server over the local message archive — the "memory" surface for agents.
 *
 * Runs on stdio and reads the same on-disk store the app writes
 * (MESSAGES_DIR, default ./data/messages), so any MCP-capable agent — Claude
 * Code, Claude Desktop, your own SDK agents — can search your Signal + WhatsApp
 * history, pull token-bounded context blocks, and view archived images. It
 * only READS the archive; ingestion stays with the app/daemon.
 *
 * Register it, e.g. for Claude Code:
 *   claude mcp add messages -- npx tsx scripts/messages-mcp.ts
 * or in any MCP client config:
 *   { "command": "npx", "args": ["tsx", "scripts/messages-mcp.ts"], "cwd": "<repo>" }
 */
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildMessageContext, parseWhen } from "../lib/messages/memory";
import { messageStore } from "../lib/messages/store";

const server = new McpServer({ name: "neat-meet-messages", version: "0.1.0" });

const filterShape = {
  q: z.string().optional().describe("Case-insensitive substring over text, names, and chat ids"),
  platform: z.enum(["signal", "whatsapp"]).optional(),
  chat: z.string().optional().describe("Exact chat id, or chat name (case-insensitive)"),
  since: z.string().optional().describe("Epoch ms or ISO date — only messages at/after this time"),
  until: z.string().optional().describe("Epoch ms or ISO date — only messages at/before this time"),
  limit: z.number().int().positive().optional().describe("Max results, newest kept (default 100)"),
};

function filters(args: {
  q?: string;
  platform?: "signal" | "whatsapp";
  chat?: string;
  since?: string;
  until?: string;
  limit?: number;
}) {
  return { ...args, since: parseWhen(args.since), until: parseWhen(args.until) };
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

server.registerTool(
  "search_messages",
  {
    title: "Search archived messages",
    description:
      "Search the local Signal + WhatsApp message archive. Returns matching messages as JSON " +
      "(sender, chat, time, text, media refs). Use get_message_context instead when you want a " +
      "compact prompt-ready block.",
    inputSchema: {
      ...filterShape,
      hasMedia: z.boolean().optional().describe("Only messages with attachments"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ hasMedia, ...args }) => {
    const messages = messageStore().search({ ...filters(args), hasMedia });
    return text(JSON.stringify({ count: messages.length, messages }, null, 2));
  },
);

server.registerTool(
  "get_message_context",
  {
    title: "Get prompt-ready message context",
    description:
      "Build a compact, token-bounded text block of archived messages (newest kept when the " +
      "budget trims) — designed to be pasted into an agent prompt as conversational memory. " +
      "Optionally scrub PII locally first.",
    inputSchema: {
      ...filterShape,
      maxChars: z.number().int().positive().optional().describe("Character budget (default 8000; ~4 chars/token)"),
      scrub: z.boolean().optional().describe("Redact emails/phones/SSNs/cards/IPs before returning"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ maxChars, scrub, ...args }) => {
    const ctx = buildMessageContext({ ...filters(args), maxChars, scrub });
    if (!ctx.text) return text("(no archived messages matched)");
    return text(ctx.text);
  },
);

server.registerTool(
  "list_chats",
  {
    title: "List conversations",
    description:
      "List every conversation in the archive with message/media counts and latest activity, " +
      "most recently active first. Useful to discover chat ids/names for filtering.",
    annotations: { readOnlyHint: true },
  },
  async () => text(JSON.stringify(messageStore().listChats(), null, 2)),
);

const VIEWABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

server.registerTool(
  "get_media",
  {
    title: "Get archived media",
    description:
      "Fetch an archived attachment by media id (from search_messages results). Images are " +
      "returned inline for viewing; other types return the local file path.",
    inputSchema: { id: z.string().describe("Media id, e.g. 'a1b2....jpg'") },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => {
    const path = messageStore().mediaPath(id);
    if (!path) return text(`No archived media with id ${id}`);
    const ext = id.split(".").pop() ?? "";
    const mime =
      { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[ext] ?? "";
    const data = readFileSync(path);
    if (VIEWABLE.has(mime) && data.length <= MAX_INLINE_BYTES) {
      return { content: [{ type: "image" as const, data: data.toString("base64"), mimeType: mime }] };
    }
    return text(`Stored at ${path} (${data.length} bytes)`);
  },
);

// No top-level await: the repo compiles scripts as CJS (no "type": "module").
void server.connect(new StdioServerTransport()).then(() => {
  console.error(
    `[messages-mcp] serving archive at ${process.env.MESSAGES_DIR ?? "./data/messages"} (${messageStore().count()} messages)`,
  );
});
