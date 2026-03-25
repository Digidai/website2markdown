// 限流中间件

import type { Env } from "../types";
import {
  RATE_LIMIT_WINDOW_SECONDS,
  RATE_LIMIT_CONVERT_PER_WINDOW,
  RATE_LIMIT_STREAM_PER_WINDOW,
  RATE_LIMIT_BATCH_PER_WINDOW,
  RATE_LIMIT_DEGRADED_FACTOR,
} from "../config";
import {
  localRateCounters,
  degradedRateLimitLogs,
  incrementCounter,
  logMetric,
} from "../runtime-state";
import { withExtraHeaders, errorResponse } from "../helpers/response";

const RATE_LIMIT_DEGRADED_LOG_THROTTLE_MS = 60_000;

export type RateLimitRoute = "convert" | "stream" | "batch";

export interface RateLimitDecision {
  exceeded: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function limitForRoute(route: RateLimitRoute): number {
  switch (route) {
    case "batch":
      return RATE_LIMIT_BATCH_PER_WINDOW;
    case "stream":
      return RATE_LIMIT_STREAM_PER_WINDOW;
    default:
      return RATE_LIMIT_CONVERT_PER_WINDOW;
  }
}

export function consumeLocalRateCounter(
  route: RateLimitRoute,
  ip: string,
  nowMs: number,
): number {
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const bucket = Math.floor(nowMs / windowMs);
  const key = `rl:${route}:${ip}:${bucket}`;
  const existing = localRateCounters.get(key);
  const expiresAt = (bucket + 1) * windowMs + 5_000;
  const nextCount = (existing?.count || 0) + 1;
  localRateCounters.set(key, { count: nextCount, expiresAt });

  if (localRateCounters.size > 2000) {
    for (const [counterKey, entry] of localRateCounters) {
      if (entry.expiresAt <= nowMs) {
        localRateCounters.delete(counterKey);
      }
    }
  }
  return nextCount;
}

export function shouldLogRateLimitDegraded(route: RateLimitRoute, ip: string, nowMs: number): boolean {
  const key = `${route}:${ip}`;
  const lastLoggedAt = degradedRateLimitLogs.get(key);
  if (lastLoggedAt !== undefined && nowMs - lastLoggedAt < RATE_LIMIT_DEGRADED_LOG_THROTTLE_MS) {
    return false;
  }

  degradedRateLimitLogs.set(key, nowMs);
  if (degradedRateLimitLogs.size > 2000) {
    const staleBefore = nowMs - RATE_LIMIT_DEGRADED_LOG_THROTTLE_MS;
    for (const [entryKey, loggedAt] of degradedRateLimitLogs) {
      if (loggedAt < staleBefore) {
        degradedRateLimitLogs.delete(entryKey);
      }
    }
  }
  return true;
}

export async function consumeDistributedRateCounter(
  env: Env,
  route: RateLimitRoute,
  ip: string,
  nowMs: number,
): Promise<number | null> {
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const bucket = Math.floor(nowMs / windowMs);
  const key = `rl:v1:${route}:${ip}:${bucket}`;
  try {
    const raw = await env.CACHE_KV.get(key, "text");
    const current = Math.max(0, parseInt(raw || "0", 10) || 0);
    const next = current + 1;
    await env.CACHE_KV.put(key, String(next), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 5,
    });
    return next;
  } catch {
    return null;
  }
}

function getClientIp(request: Request): string | null {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim() || null;
  }
  return null;
}

export async function consumeRateLimit(
  request: Request,
  env: Env,
  route: RateLimitRoute,
): Promise<RateLimitDecision | null> {
  const ip = getClientIp(request);
  if (!ip) return null;

  const nowMs = Date.now();
  const baseLimit = limitForRoute(route);
  const localCount = consumeLocalRateCounter(route, ip, nowMs);
  const distributedCount = await consumeDistributedRateCounter(env, route, ip, nowMs);
  const distributedUnavailable = distributedCount === null;
  const limit = distributedUnavailable
    ? Math.max(1, Math.floor(baseLimit * RATE_LIMIT_DEGRADED_FACTOR))
    : baseLimit;
  const count = distributedUnavailable
    ? localCount
    : Math.max(localCount, distributedCount);

  if (distributedUnavailable && shouldLogRateLimitDegraded(route, ip, nowMs)) {
    logMetric("rate_limit.degraded_mode", {
      route,
      ip,
      local_count: localCount,
      limit,
      base_limit: baseLimit,
    });
  }

  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((((Math.floor(nowMs / windowMs) + 1) * windowMs) - nowMs) / 1000),
  );
  return {
    exceeded: count > limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "Retry-After": String(decision.retryAfterSeconds),
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(decision.retryAfterSeconds),
  };
}

export function rateLimitedResponse(
  route: RateLimitRoute,
  decision: RateLimitDecision,
  asJson: boolean,
): Response {
  incrementCounter("rateLimited");
  logMetric("rate_limit.blocked", {
    route,
    limit: decision.limit,
    retry_after_s: decision.retryAfterSeconds,
  });
  const message = `Too many requests. Retry in ${decision.retryAfterSeconds} seconds.`;
  const base = errorResponse("Rate Limited", message, 429, asJson);
  return withExtraHeaders(base, rateLimitHeaders(decision));
}
