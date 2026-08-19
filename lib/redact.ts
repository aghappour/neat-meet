/**
 * Local, regex-based PII scrubbing — applied server-side to text BEFORE it is
 * sent to Claude (and to connectors), when the per-meeting "Scrub PII" toggle
 * is on. Purely local: the scrubber itself never calls any API.
 *
 * Deliberately conservative: it targets high-confidence formats (emails, card
 * numbers, SSNs, IPs, phone numbers) rather than trying to catch every name or
 * address — false positives that mangle the transcript are worse than missing
 * an ambiguous case. Note: captured slide FRAMES are images and cannot be
 * scrubbed — only the text extracted from them is (documented in the UI).
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 13–16 digits in groups of 4 (spaces/dashes optional) — run before PHONE so
// card numbers aren't half-eaten as phone numbers.
const CARD = /\b(?:\d{4}[ -]?){3}\d{1,4}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Candidate phone runs; the replacer only redacts when 10+ digits are present,
// so years, ids, and short numbers pass through untouched.
const PHONE = /\+?\d[\d .()/-]{7,}\d/g;

export function scrubPii(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL, "[email]")
    .replace(CARD, "[card]")
    .replace(SSN, "[ssn]")
    .replace(IPV4, "[ip]")
    .replace(PHONE, (m) => ((m.match(/\d/g)?.length ?? 0) >= 10 ? "[phone]" : m));
}

/** Scrub every string value in a JSON-serializable object (e.g. a prior summary). */
export function scrubPiiDeep<T>(value: T): T {
  if (typeof value === "string") return scrubPii(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubPiiDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubPiiDeep(v);
    return out as T;
  }
  return value;
}
