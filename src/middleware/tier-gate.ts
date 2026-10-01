/**
 * Tier gate: AuthContext → PolicyDecision
 *
 * All downstream code reads PolicyDecision to know what's allowed.
 * This is the single source of truth for resource allocation.
 */

import type { AuthContext, PolicyDecision, Tier } from "../types";

/** Base credit cost per request type. Live browser success adds BROWSER_CREDIT_SURCHARGE when this base is above 0. */
const CREDIT_COSTS: Record<string, number> = {
  convert: 1,
  stream: 1,
  batch: 1,
  extract: 3,
  deepcrawl: 2,
};

const PUBLIC_KEYLESS_ENGINES = new Set(["jina", "firecrawl"]);

/**
 * Added only when a keyed convert, stream, or batch request succeeds through
 * a live browser render. Cache hits stay at the route cost. Failures are not
 * recorded, so they do not pick up this surcharge.
 */
export const BROWSER_CREDIT_SURCHARGE = 2;

export function isPublicKeylessEngine(engine?: string): boolean {
  return !!engine && PUBLIC_KEYLESS_ENGINES.has(engine);
}

export function chargedCreditCost(
  baseCost: number,
  opts: { browserRendered: boolean; cacheHit: boolean },
): number {
  if (baseCost <= 0 || opts.cacheHit || !opts.browserRendered) return Math.max(0, baseCost);
  return baseCost + BROWSER_CREDIT_SURCHARGE;
}

/**
 * Refuse to start the browser when the account cannot pay for a successful
 * render. Static conversion stays available at the route cost. An explicit
 * force_browser request gets a quota error instead of a silent downgrade.
 */
export function browserAllowedForRequest(
  policy: PolicyDecision,
  forceBrowser: boolean,
): { allowed: boolean; error: string | null } {
  if (!policy.browserAllowed) return { allowed: false, error: null };
  const needed = policy.creditCost === 1
    ? policy.creditCost + BROWSER_CREDIT_SURCHARGE
    : policy.creditCost;
  if (needed > 0 && policy.quotaRemaining < needed) {
    if (forceBrowser) {
      return {
        allowed: false,
        error: `Browser rendering costs ${needed} credits. ${policy.quotaRemaining} credits remain this month.`,
      };
    }
    return { allowed: false, error: null };
  }
  return { allowed: true, error: null };
}

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
  if (params.engine) {
    if (policy.tier === "anonymous") {
      return isPublicKeylessEngine(params.engine)
        ? "engine selection requires an API key."
        : "engine selection requires a Pro API key.";
    }
    if (!policy.engineSelectionAllowed && !isPublicKeylessEngine(params.engine)) {
      return "engine selection requires a Pro API key.";
    }
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
