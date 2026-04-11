/**
 * Usage tracking and /api/usage endpoint.
 *
 * Usage is tracked in-memory and flushed to D1 via ctx.waitUntil().
 * Best-effort: Worker crash loses unflushed counts.
 */

import type { AuthContext, Env, Tier } from "../types";
import { TIER_QUOTAS } from "../types";
import { CORS_HEADERS } from "../config";

// ─── In-memory usage buffer ─────────────────────────────────

interface UsageEntry {
  credits: number;
  requests: number;
  browserCalls: number;
  cacheHits: number;
}

const usageBuffer = new Map<string, UsageEntry>();
const FLUSH_THRESHOLD = 100;
let pendingRequests = 0;

function bufferKey(keyId: string, date: string): string {
  return `${keyId}:${date}`;
}

export function recordUsage(
  auth: AuthContext,
  creditCost: number,
  browserUsed: boolean,
  cacheHit: boolean,
): void {
  if (!auth.keyId) return;

  const date = new Date().toISOString().slice(0, 10);
  const bk = bufferKey(auth.keyId, date);
  const existing = usageBuffer.get(bk);

  if (existing) {
    existing.credits += creditCost;
    existing.requests += 1;
    if (browserUsed) existing.browserCalls += 1;
    if (cacheHit) existing.cacheHits += 1;
  } else {
    usageBuffer.set(bk, {
      credits: creditCost,
      requests: 1,
      browserCalls: browserUsed ? 1 : 0,
      cacheHits: cacheHit ? 1 : 0,
    });
  }

  pendingRequests++;
}

/**
 * Flush buffered usage to D1. Called via ctx.waitUntil().
 * Uses INSERT ... ON CONFLICT UPDATE for atomic upsert.
 */
export async function flushUsage(env: Env): Promise<void> {
  if (usageBuffer.size === 0 || !env.AUTH_DB) return;

  const entries = Array.from(usageBuffer.entries());
  usageBuffer.clear();
  pendingRequests = 0;

  const stmts: D1PreparedStatement[] = [];

  for (const [key, usage] of entries) {
    const [keyId, date] = key.split(":");
    stmts.push(
      env.AUTH_DB.prepare(`
        INSERT INTO usage_daily (key_id, date, requests, credits, browser_calls, cache_hits)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (key_id, date) DO UPDATE SET
          requests = requests + excluded.requests,
          credits = credits + excluded.credits,
          browser_calls = browser_calls + excluded.browser_calls,
          cache_hits = cache_hits + excluded.cache_hits
      `).bind(keyId, date, usage.requests, usage.credits, usage.browserCalls, usage.cacheHits),
    );

    // Also update denormalized monthly_credits_used on account
    stmts.push(
      env.AUTH_DB.prepare(`
        UPDATE accounts SET monthly_credits_used = monthly_credits_used + ?,
          updated_at = ?
        WHERE id = (SELECT account_id FROM api_keys WHERE id = ?)
      `).bind(usage.credits, new Date().toISOString(), keyId),
    );
  }

  try {
    await env.AUTH_DB.batch(stmts);
  } catch (err) {
    console.error("Usage flush to D1 failed:", err);
  }
}

export function shouldFlush(): boolean {
  return pendingRequests >= FLUSH_THRESHOLD || usageBuffer.size > 50;
}

// ─── GET /api/usage endpoint ────────────────────────────────

/**
 * Return usage data for an account.
 *
 * Accepts EITHER a Bearer API key (for SDK/CLI usage) OR a portal session
 * cookie (for Dashboard). Callers must resolve the accountId before calling.
 */
export async function handleUsageForAccount(
  env: Env,
  accountId: string,
): Promise<Response> {
  if (!env.AUTH_DB) {
    return Response.json(
      { error: "Service Unavailable", message: "Usage tracking is not configured" },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    const account = await env.AUTH_DB.prepare(
      `SELECT tier, monthly_credits_used, monthly_credits_reset_at FROM accounts WHERE id = ?`
    ).bind(accountId).first<{
      tier: string;
      monthly_credits_used: number;
      monthly_credits_reset_at: string;
    }>();

    if (!account) {
      return Response.json(
        { error: "Not Found", message: "Account not found" },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    const dailyRows = await env.AUTH_DB.prepare(`
      SELECT date, requests, credits, browser_calls, cache_hits
      FROM usage_daily
      WHERE key_id IN (SELECT id FROM api_keys WHERE account_id = ?)
        AND date >= ?
      ORDER BY date ASC
    `).bind(accountId, monthStart).all<{
      date: string;
      requests: number;
      credits: number;
      browser_calls: number;
      cache_hits: number;
    }>();

    // Derive quota from the authoritative tier in D1, not from stale AuthContext
    const tier = (account.tier === "pro" ? "pro" : account.tier === "enterprise" ? "pro" : "free") as Tier;
    const quota = TIER_QUOTAS[tier];
    const used = account.monthly_credits_used ?? 0;

    return Response.json({
      tier: account.tier,
      quota,
      used,
      remaining: Math.max(0, quota - used),
      period: {
        start: monthStart,
        reset_at: account.monthly_credits_reset_at,
      },
      daily: dailyRows.results || [],
    }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Usage query failed:", err);
    return Response.json(
      { error: "Internal Error", message: "Failed to retrieve usage data" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/** Bearer-auth entry point (API key users) */
export async function handleUsage(
  auth: AuthContext,
  env: Env,
): Promise<Response> {
  if (!auth.accountId) {
    return Response.json(
      { error: "Unauthorized", message: "Valid API key required for /api/usage" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  return handleUsageForAccount(env, auth.accountId);
}
