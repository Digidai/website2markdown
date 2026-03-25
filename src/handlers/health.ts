// 健康检查端点

import { CORS_HEADERS } from "../config";
import { getBrowserCapacityStats } from "../browser";
import { getPaywallRuleStats } from "../paywall";
import { buildOperationalMetricsSnapshot } from "../observability/metrics";
import { runtimeStartedAt, runtimeCounters } from "../runtime-state";
import { errorMessage } from "../utils";

export function handleHealth(host: string): Response {
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
