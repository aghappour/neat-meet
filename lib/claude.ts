import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/**
 * Lazily construct the Anthropic client. Credentials are resolved by the SDK in
 * order: ANTHROPIC_API_KEY → ANTHROPIC_AUTH_TOKEN → an `ant auth login` OAuth
 * profile. So you can either set a key in .env, or run `ant auth login` (the
 * Anthropic CLI) and manage no raw key at all.
 */
export function getClient(): Anthropic {
  if (client) return client;
  try {
    // Zero-arg constructor performs the full credential resolution above.
    client = new Anthropic();
    return client;
  } catch {
    throw new Error(
      "No Anthropic credentials found. Either set ANTHROPIC_API_KEY in .env, or run " +
        "`ant auth login` (Anthropic CLI) so credentials resolve automatically. If you used " +
        '`ant auth login` and still see this, run `eval "$(ant auth print-credentials --env)"` ' +
        "in the shell before starting the app.",
    );
  }
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
