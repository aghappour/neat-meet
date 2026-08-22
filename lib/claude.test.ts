import { describe, expect, it } from "vitest";
import { extractJson, firstText } from "@/lib/claude";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses a JSON array with surrounding prose", () => {
    const text = 'Here are the insights:\n[{"title":"x"}]\nHope that helps.';
    expect(extractJson<{ title: string }[]>(text)).toEqual([{ title: "x" }]);
  });

  it("strips ```json fences", () => {
    const text = "```json\n{\"ok\": true}\n```";
    expect(extractJson<{ ok: boolean }>(text)).toEqual({ ok: true });
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("firstText", () => {
  it("returns the first text block", () => {
    const content = [
      { type: "tool_use" },
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ];
    expect(firstText(content)).toBe("hello");
  });

  it("returns empty string when there is no text block", () => {
    expect(firstText([{ type: "tool_use" }])).toBe("");
  });
});
