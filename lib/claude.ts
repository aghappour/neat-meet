import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Lazily construct the Anthropic client (reads ANTHROPIC_API_KEY from env). */
export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!client) client = new Anthropic();
  return client;
}

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

/** Extract the first well-formed JSON value from a model response. */
export function extractJson<T>(text: string): T {
  // Strip ```json fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  // Find the outermost { } or [ ].
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model response");
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  const slice = candidate.slice(start, end + 1);
  return JSON.parse(slice) as T;
}

/** First text block of a Messages API response. */
export function firstText(content: Array<{ type: string; text?: string }>): string {
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") return block.text;
  }
  return "";
}
