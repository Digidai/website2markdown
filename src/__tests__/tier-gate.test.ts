import { describe, expect, it } from "vitest";
import { browserAllowedForRequest, buildPolicy, chargedCreditCost, checkPolicy, EMPTY_RESULT_MAX_CHARS, isPublicKeylessEngine } from "../middleware/tier-gate";
import { markdownBodyChars } from "../helpers/format";
import type { AuthContext } from "../types";

function auth(tier: AuthContext["tier"]): AuthContext {
  return {
    tier,
    accountId: null,
    keyId: null,
    quotaLimit: tier === "pro" ? 50_000 : tier === "free" ? 1_000 : 0,
    quotaUsed: 0,
  };
}

describe("tier gate engine policy", () => {
  it("requires an API key before anonymous callers select a public engine", () => {
    const policy = buildPolicy(auth("anonymous"));

    expect(isPublicKeylessEngine("jina")).toBe(true);
    expect(isPublicKeylessEngine("firecrawl")).toBe(true);
    expect(checkPolicy(policy, { engine: "jina" })).toBe(
      "engine selection requires an API key.",
    );
    expect(checkPolicy(policy, { engine: "firecrawl" })).toBe(
      "engine selection requires an API key.",
    );
  });

  it("still lets a free key select jina and firecrawl", () => {
    const policy = buildPolicy(auth("free"));

    expect(checkPolicy(policy, { engine: "jina" })).toBeNull();
    expect(checkPolicy(policy, { engine: "firecrawl" })).toBeNull();
    expect(checkPolicy(policy, { engine: "cf" })).toBe(
      "engine selection requires a Pro API key.",
    );
  });

  it("keeps account-backed engines restricted to Pro", () => {
    const policy = buildPolicy(auth("anonymous"));

    expect(isPublicKeylessEngine("cf")).toBe(false);
    expect(checkPolicy(policy, { engine: "cf" })).toBe(
      "engine selection requires a Pro API key.",
    );
  });

  it("does not loosen browser or no-cache restrictions", () => {
    const policy = buildPolicy(auth("anonymous"));

    expect(checkPolicy(policy, { forceBrowser: true, engine: "firecrawl" })).toBe(
      "force_browser requires an API key.",
    );
    expect(checkPolicy(policy, { noCache: true, engine: "jina" })).toBe(
      "no_cache requires a Pro API key.",
    );
  });
});

describe("browser credit surcharge", () => {
  it("charges 3 for a live browser success and keeps cache hits at the route cost", () => {
    const full = { bodyChars: 220 };
    expect(chargedCreditCost(1, { browserRendered: true, cacheHit: false, ...full })).toBe(3);
    expect(chargedCreditCost(1, { browserRendered: true, cacheHit: true, ...full })).toBe(1);
    expect(chargedCreditCost(1, { browserRendered: false, cacheHit: false, ...full })).toBe(1);
    expect(chargedCreditCost(0, { browserRendered: true, cacheHit: false, ...full })).toBe(0);
  });

  it("does not charge for a nearly empty body, and charges an unmeasured one as usual", () => {
    const charge = (bodyChars: number | undefined) =>
      chargedCreditCost(1, { browserRendered: true, cacheHit: false, bodyChars });
    expect(charge(markdownBodyChars("# 会计信息\n\n暂无数据"))).toBe(0);
    expect(charge(undefined)).toBe(3);

    // The title line is removed once; body text that repeats it still counts.
    expect(markdownBodyChars(`# Test title\n\n${"x".repeat(95)}`)).toBe(95);
    expect(markdownBodyChars(`Ten chars!\n==========\n\n${"x".repeat(95)}`)).toBe(95);
    expect(markdownBodyChars(`# Hello world\n\nHello world ${"x".repeat(90)}`)).toBe(100);
    // Image and link URLs are not body, even with parentheses inside them.
    const images = `# Gallery\n\n${`![](https://cdn.example.com/${"sig".repeat(300)})\n`.repeat(3)}`;
    expect(markdownBodyChars(images)).toBe(6);
    expect(markdownBodyChars(`![](https://cdn.example.com/(original)/${"f".repeat(150)}.png)`)).toBe(2);
    expect(markdownBodyChars(`[a](https://e.com/a\\)b)${"y".repeat(5)}`)).toBe(7);
    // Everything else counts as written, code included.
    const code = `handlers[key]("${"z".repeat(200)}")`;
    expect(markdownBodyChars("```js\n" + code + "\n```")).toBe(code.length + 8);
    expect(markdownBodyChars("`" + code + "`")).toBe(code.length + 2);
    expect(markdownBodyChars("A-B ".repeat(40))).toBe(120);
    expect(charge(markdownBodyChars("x".repeat(EMPTY_RESULT_MAX_CHARS)))).toBe(3);

    // Untrusted input is scanned in linear time.
    const started = Date.now();
    for (const hostile of ["](".repeat(500_000), "[".repeat(1_000_000), " ".repeat(1_000_000) + "#", " ".repeat(1_000_000) + "x\n=".repeat(10)]) {
      markdownBodyChars(hostile, Infinity);
    }
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("refuses force_browser when the account cannot pay for a render", () => {
    const policy = buildPolicy({ ...auth("free"), quotaUsed: 998 });

    expect(browserAllowedForRequest(policy, true)).toEqual({
      allowed: false,
      error: "Browser rendering costs 3 credits. 2 credits remain this month.",
    });
    expect(browserAllowedForRequest(policy, false)).toEqual({
      allowed: false,
      error: null,
    });
  });

  it("keeps a static convert available when the browser surcharge is unaffordable", () => {
    const affordable = buildPolicy({ ...auth("free"), quotaUsed: 997 });
    expect(browserAllowedForRequest(affordable, false).allowed).toBe(true);
  });
});
