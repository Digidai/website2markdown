/**
 * Tier gate: AuthContext → PolicyDecision
 *
 * All downstream code reads PolicyDecision to know what's allowed.
 * This is the single source of truth for resource allocation.
 */

import type { AuthContext, PolicyDecision, Tier } from "../types";

/** Fixed credit cost per request type (not per actual conversion path) */
const CREDIT_COSTS: Record<string, number> = {
  convert: 1,
  stream: 1,
  batch: 1,
  extract: 3,
  deepcrawl: 2,
};

export function buildPolicy(
  auth: AuthContext,
  route: string = "convert",
): PolicyDecision {
  const cost = CREDIT_COSTS[route] ?? 1;
  const remaining = Math.max(0, auth.quotaLimit - auth.quotaUsed);

  if (auth.tier === "anonymous") {
    return {
      tier: "anonymous",
      browserAllowed: false,
      proxyAllowed: false,
      engineSelectionAllowed: false,
      noCacheAllowed: false,
      quotaRemaining: 0,
      creditCost: 0,
    };
  }

  if (auth.tier === "free") {
    return {
      tier: "free",
      browserAllowed: true,
      proxyAllowed: false,
      engineSelectionAllowed: false,
      noCacheAllowed: false,
      quotaRemaining: remaining,
      creditCost: cost,
    };
  }

  // pro
  return {
    tier: "pro",
    browserAllowed: true,
    proxyAllowed: true,
    engineSelectionAllowed: true,
    noCacheAllowed: true,
    quotaRemaining: remaining,
    creditCost: cost,
  };
}

/**
 * Check if a request's parameters are allowed by the policy.
 * Returns null if OK, or an error message string if blocked.
 */
export function checkPolicy(
  policy: PolicyDecision,
  params: {
    forceBrowser?: boolean;
    noCache?: boolean;
    engine?: string;
  },
): string | null {
  if (params.forceBrowser && !policy.browserAllowed) {
    return "force_browser requires an API key.";
  }
  if (params.noCache && !policy.noCacheAllowed) {
    return "no_cache requires a Pro API key.";
  }
  if (params.engine && !policy.engineSelectionAllowed) {
    return "engine selection requires a Pro API key.";
  }
  // Quota check (skip for anonymous — they have separate restrictions)
  if (policy.tier !== "anonymous" && policy.quotaRemaining <= 0) {
    return null; // Quota exceeded handled separately (graceful degradation)
  }
  return null;
}

/** Build rate limit headers for the response */
export function policyHeaders(
  policy: PolicyDecision,
  auth: AuthContext,
): Record<string, string> {
  if (policy.tier === "anonymous") return {};
  return {
    "X-RateLimit-Limit": String(auth.quotaLimit),
    "X-RateLimit-Remaining": String(policy.quotaRemaining),
    "X-Request-Cost": String(policy.creditCost),
  };
}
