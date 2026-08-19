import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/**
 * Lazily construct the Anthropic client.
 *
 * No key check of our own — that would reject a perfectly good CLI login. The
 * SDK resolves ANTHROPIC_API_KEY, then ANTHROPIC_AUTH_TOKEN. It does NOT read
 * the `ant auth login` OAuth profile at the pinned version (0.68): a zero-arg
 * client fails with "Could not resolve authentication method" even when
 * `ant auth status` reports an active profile. `npm run dev:auth` bridges that
 * gap by exporting the CLI session into ANTHROPIC_AUTH_TOKEN.
 */
export function getClient(): Anthropic {
  if (client) return client;
  try {
    client = new Anthropic();
    return client;
  } catch {
    throw new Error(
      "No Anthropic credentials found. Either set ANTHROPIC_API_KEY in .env, or run " +
        "`ant auth login` and start the app with `npm run dev:auth`, which exports the CLI " +
        "session into ANTHROPIC_AUTH_TOKEN (the SDK does not read the OAuth profile itself).",
    );
  }
}

/** Model for insights (drives MCP connector tool use — keep a capable tier). */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

/**
 * Model for the mechanical hot paths — rolling summary and slide extraction.
 * Defaults to Haiku 4.5 ($1/$5 per MTok vs Sonnet 5's $3/$15): these tasks are
 * routine condensation/OCR-shaped work where the cheap tier holds up. Set
 * SUMMARY_MODEL=claude-sonnet-5 in .env if you'd rather trade cost for polish.
 */
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "claude-haiku-4-5";

/**
 * `output_config.effort` is rejected (400) by Haiku-tier models — include it
 * only for models that support it. Spread the result into request params.
 */
export function effortConfig(model: string): Record<string, unknown> {
  return model.includes("haiku") ? {} : { output_config: { effort: "low" } };
}

// Token guard: cap how much transcript / context is sent per call so cost stays
// bounded on long meetings. Roughly 4 chars ≈ 1 token, so 24k chars ≈ ~6k tokens.
// The summary additionally folds in the previous summary, so trimming old
// verbatim lines doesn't lose the earlier meeting — see app/api/summary/route.ts.
export const TRANSCRIPT_MAX_CHARS = Number(process.env.TRANSCRIPT_MAX_CHARS || 24000);
export const CONTEXT_MAX_CHARS = Number(process.env.CONTEXT_MAX_CHARS || 4000);

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
