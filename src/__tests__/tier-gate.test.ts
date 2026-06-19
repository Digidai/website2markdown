import { describe, expect, it } from "vitest";
import { buildPolicy, checkPolicy, isPublicKeylessEngine } from "../middleware/tier-gate";
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
  it("allows public keyless reader engines without a Pro key", () => {
    const policy = buildPolicy(auth("anonymous"));

    expect(isPublicKeylessEngine("jina")).toBe(true);
    expect(isPublicKeylessEngine("firecrawl")).toBe(true);
    expect(checkPolicy(policy, { engine: "jina" })).toBeNull();
    expect(checkPolicy(policy, { engine: "firecrawl" })).toBeNull();
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
