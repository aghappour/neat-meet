import { describe, expect, it } from "vitest";
import { scrubPii, scrubPiiDeep } from "@/lib/redact";

describe("scrubPii", () => {
  it("redacts email addresses", () => {
    expect(scrubPii("mail me at jane.doe+x@example.co.uk please")).toBe(
      "mail me at [email] please",
    );
  });

  it("redacts phone numbers (10+ digits, various formats)", () => {
    expect(scrubPii("call +1 (415) 555-0132 tomorrow")).toBe("call [phone] tomorrow");
    expect(scrubPii("call 415.555.0132 tomorrow")).toBe("call [phone] tomorrow");
  });

  it("leaves short numbers, years, and ids alone", () => {
    const s = "in 2026 we shipped v2, room 4021, budget 50000";
    expect(scrubPii(s)).toBe(s);
  });

  it("redacts credit-card-shaped numbers", () => {
    expect(scrubPii("card 4111 1111 1111 1111 expires soon")).toBe("card [card] expires soon");
  });

  it("redacts SSNs", () => {
    expect(scrubPii("ssn is 123-45-6789 ok")).toBe("ssn is [ssn] ok");
  });

  it("redacts IPv4 addresses", () => {
    expect(scrubPii("server at 192.168.1.100 is down")).toBe("server at [ip] is down");
  });

  it("preserves ordinary meeting text", () => {
    const s = "Sarah: let's move the launch to March 3 and loop in the design team";
    expect(scrubPii(s)).toBe(s);
  });

  it("scrubPiiDeep scrubs nested summary objects", () => {
    const out = scrubPiiDeep({
      gist: "contact bob@x.com",
      decisions: ["call 415-555-0132 x100"],
      openQuestions: [],
      actionItems: [],
    });
    expect(out.gist).toBe("contact [email]");
    expect(out.decisions[0]).toContain("[phone]");
  });
});
