import { describe, expect, it } from "vitest";
import { browserAllowedForRequest, buildPolicy, chargedCreditCost, checkPolicy, isPublicKeylessEngine } from "../middleware/tier-gate";
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
    expect(chargedCreditCost(1, { browserRendered: true, cacheHit: false })).toBe(3);
    expect(chargedCreditCost(1, { browserRendered: true, cacheHit: true })).toBe(1);
    expect(chargedCreditCost(1, { browserRendered: false, cacheHit: false })).toBe(1);
    expect(chargedCreditCost(0, { browserRendered: true, cacheHit: false })).toBe(0);
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
