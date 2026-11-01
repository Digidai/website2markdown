// 限流中间件

import type { Env } from "../types";
import {
  RATE_LIMIT_WINDOW_SECONDS,
  RATE_LIMIT_CONVERT_PER_WINDOW,
  RATE_LIMIT_STREAM_PER_WINDOW,
  RATE_LIMIT_BATCH_PER_WINDOW,
  RATE_LIMIT_ANON_CONVERT_PER_WINDOW,
  RATE_LIMIT_ANON_STREAM_PER_WINDOW,
  RATE_LIMIT_ANON_BATCH_PER_WINDOW,
  RATE_LIMIT_ANON_PER_DAY,
} from "../config";
import {
  localRateCounters,
  incrementCounter,
  logMetric,
} from "../runtime-state";
import { withExtraHeaders, errorResponse } from "../helpers/response";
import { bumpLimit } from "./rate-limit-d1";

export type RateLimitRoute = "convert" | "stream" | "batch";

export interface RateLimitDecision {
  exceeded: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  /** Set when the anonymous daily cap, not the per-minute window, was hit. */
  anonDaily?: boolean;
}

export function limitForRoute(route: RateLimitRoute, anonymous = false): number {
  if (anonymous) {
    switch (route) {
      case "batch":
        return RATE_LIMIT_ANON_BATCH_PER_WINDOW;
      case "stream":
        return RATE_LIMIT_ANON_STREAM_PER_WINDOW;
      default:
        return RATE_LIMIT_ANON_CONVERT_PER_WINDOW;
    }
  }
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
  audience: "anon" | "auth" = "auth",
): number {
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const bucket = Math.floor(nowMs / windowMs);
  const key = `rl:${audience}:${route}:${ip}:${bucket}`;
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

export interface ConsumeRateLimitOptions {
  /** Anonymous convert/stream/batch also increments the shared D1 counter. */
  anonymous?: boolean;
}

function retryAfterFromReset(resetAtIso: string, nowMs: number): number {
  const resetMs = Date.parse(resetAtIso);
  if (Number.isNaN(resetMs)) return RATE_LIMIT_WINDOW_SECONDS;
  return Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
}

export async function consumeRateLimit(
  request: Request,
  env: Env,
  route: RateLimitRoute,
  options: ConsumeRateLimitOptions = {},
): Promise<RateLimitDecision | null> {
  const ip = getClientIp(request);
  if (!ip) return null;

  const anonymous = options.anonymous === true;
  const nowMs = Date.now();
  const limit = limitForRoute(route, anonymous);
  const count = consumeLocalRateCounter(route, ip, nowMs, anonymous ? "anon" : "auth");

  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((((Math.floor(nowMs / windowMs) + 1) * windowMs) - nowMs) / 1000),
  );
  const localDecision: RateLimitDecision = {
    exceeded: count > limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
  // One hot isolate can reject without another D1 write.
  if (localDecision.exceeded || !anonymous || !env.AUTH_DB) return localDecision;

  const durable = await bumpLimit(
    env,
    `anon-rl:${route}:${ip}`,
    limit,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  let minuteDecision = localDecision;
  if (durable.blocked || durable.count !== 0 || durable.limit !== limit) {
    // bumpLimit fail-opens with count 0; otherwise the shared counter decides.
    minuteDecision = {
      exceeded: durable.blocked,
      limit: durable.limit,
      remaining: Math.min(localDecision.remaining, Math.max(0, durable.limit - durable.count)),
      retryAfterSeconds: durable.blocked
        ? retryAfterFromReset(durable.resetAt, nowMs)
        : localDecision.retryAfterSeconds,
    };
  }
  if (minuteDecision.exceeded) return minuteDecision;

  const day = new Date(nowMs).toISOString().slice(0, 10);
  const daily = await bumpLimit(env, `anon-daily:${ip}:${day}`, RATE_LIMIT_ANON_PER_DAY, 86_400);
  if (!daily.blocked) return minuteDecision;
  const nextUtcDay = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
  return {
    exceeded: true,
    limit: RATE_LIMIT_ANON_PER_DAY,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil((nextUtcDay - nowMs) / 1000)),
    anonDaily: true,
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
    anon_daily: decision.anonDaily === true,
  });
  const message = decision.anonDaily
    ? `Anonymous use is limited to ${decision.limit} requests per IP per day. ` +
      "Get a free API key (1,000 credits a month) at https://mdget.dev/portal/ " +
      "and send it as 'Authorization: Bearer <key>'. 匿名用户每个 IP 每天限 " +
      `${decision.limit} 次，请到 https://mdget.dev/portal/ 免费注册 API key（每月 1,000 次）。`
    : `Too many requests. Retry in ${decision.retryAfterSeconds} seconds.`;
  const base = errorResponse("Rate Limited", message, 429, asJson);
  return withExtraHeaders(base, rateLimitHeaders(decision));
}
