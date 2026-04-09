// 限流中间件

import type { Env } from "../types";
import {
  RATE_LIMIT_WINDOW_SECONDS,
  RATE_LIMIT_CONVERT_PER_WINDOW,
  RATE_LIMIT_STREAM_PER_WINDOW,
  RATE_LIMIT_BATCH_PER_WINDOW,
} from "../config";
import {
  localRateCounters,
  incrementCounter,
  logMetric,
} from "../runtime-state";
import { withExtraHeaders, errorResponse } from "../helpers/response";

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
  _env: Env,
  route: RateLimitRoute,
): Promise<RateLimitDecision | null> {
  const ip = getClientIp(request);
  if (!ip) return null;

  const nowMs = Date.now();
  const limit = limitForRoute(route);
  const count = consumeLocalRateCounter(route, ip, nowMs);

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
