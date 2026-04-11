// 健康检查端点

import type { Env } from "../types";
import { CORS_HEADERS } from "../config";
import { getBrowserCapacityStats } from "../browser";
import { getPaywallRuleStats } from "../paywall";
import { buildOperationalMetricsSnapshot } from "../observability/metrics";
import { runtimeStartedAt, runtimeCounters } from "../runtime-state";
import { errorMessage } from "../utils";
import { isAuthorizedByToken } from "../middleware/auth";

/**
 * Default /api/health handler — returns public-only info.
 * Callers who need full operational metrics should use /api/health?full=1
 * with an API_TOKEN Bearer header (see handleHealthRoute).
 */
export function handleHealth(host: string): Response {
  return handlePublicHealth(host);
}

/**
 * Router entry: decides between public and full based on ?full=1 + auth.
 */
export async function handleHealthRoute(request: Request, env: Env, host: string): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("full") === "1") {
    return handleFullHealth(request, env, host);
  }
  return handlePublicHealth(host);
}

/**
 * Public health check — minimal, no internal state.
 * Returns just { status, service, uptime_seconds } so that monitoring
 * tools can liveness-check without leaking operational capacity data.
 */
export function handlePublicHealth(host: string): Response {
  return Response.json({
    status: "ok",
    service: host,
    uptime_seconds: Math.max(0, Math.floor((Date.now() - runtimeStartedAt) / 1000)),
  }, { headers: CORS_HEADERS });
}

/**
 * Full health with browser capacity, paywall rule counts, metric counters.
 * Requires API_TOKEN (admin) to prevent attackers from probing queue depth,
 * rate limit state, browser concurrency, etc.
 */
export async function handleFullHealth(request: Request, env: Env, host: string): Promise<Response> {
  // Require admin auth for full metrics
  if (env.API_TOKEN) {
    const authorized = await isAuthorizedByToken(request, env.API_TOKEN);
    if (!authorized) {
      return handlePublicHealth(host);
    }
  }
  return buildFullHealthResponse(host);
}

function buildFullHealthResponse(host: string): Response {
  let browserStats: {
    active: number;
    queued: number;
    maxConcurrent: number;
    maxQueueLength: number;
    queueTimeoutMs: number;
  } = {
    active: 0,
    queued: 0,
    maxConcurrent: 0,
    maxQueueLength: 0,
    queueTimeoutMs: 0,
  };
  try {
    browserStats = getBrowserCapacityStats();
  } catch (error) {
    console.error("health.browser_stats_unavailable", {
      error: errorMessage(error),
    });
  }

  let paywallStats: {
    source: string;
    ruleCount?: number;
    domainCount?: number;
    updatedAt?: string;
    error?: string;
  } = {
    source: "unknown",
  };
  try {
    paywallStats = getPaywallRuleStats();
  } catch (error) {
    paywallStats = {
      source: "unavailable",
      error: errorMessage(error),
    };
    console.error("health.paywall_stats_unavailable", {
      error: errorMessage(error),
    });
  }
  return Response.json({
    status: "ok",
    service: host,
    uptime_seconds: Math.max(0, Math.floor((Date.now() - runtimeStartedAt) / 1000)),
    metrics: {
      ...runtimeCounters,
      operational: buildOperationalMetricsSnapshot(
        runtimeStartedAt,
        runtimeCounters,
        browserStats,
      ),
    },
    browser: browserStats,
    paywall: paywallStats,
  }, { headers: CORS_HEADERS });
}
