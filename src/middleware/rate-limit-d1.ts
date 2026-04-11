/**
 * Global, atomic rate limiting backed by D1.
 *
 * Cache API is per-colo and non-atomic. For operations where global
 * consistency matters (notably magic-link email quota), we need D1
 * INSERT ... ON CONFLICT UPDATE with RETURNING to get an atomic counter.
 *
 *   bumpLimit(env, "magic-link:ip:1.2.3.4", 10, 3600)
 *     → { count: 7, limit: 10, blocked: false, resetAt: "2026-04-11T..." }
 *
 * Falls back to allow-through (blocked: false) if D1 is unavailable —
 * we prefer availability over denial when the counter store is down.
 */

import type { Env } from "../types";

export interface RateLimitResult {
  count: number;
  limit: number;
  blocked: boolean;
  resetAt: string;
}

/**
 * Increment a rate limit counter and return whether the request is blocked.
 * Uses D1 atomic upsert: the counter resets when the row's expires_at passes.
 *
 * The query is a single round-trip — RETURNING gives us the post-write
 * counter value without a follow-up SELECT.
 */
export async function bumpLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  const nowIso = now.toISOString();
  const resetIso = resetAt.toISOString();

  if (!env.AUTH_DB) {
    // No D1 → can't enforce; fail open to preserve availability.
    return { count: 0, limit, blocked: false, resetAt: resetIso };
  }

  try {
    const row = await env.AUTH_DB.prepare(`
      INSERT INTO rate_limits (key, count, expires_at)
      VALUES (?1, 1, ?2)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.expires_at <= ?3 THEN 1
          ELSE rate_limits.count + 1
        END,
        expires_at = CASE
          WHEN rate_limits.expires_at <= ?3 THEN excluded.expires_at
          ELSE rate_limits.expires_at
        END
      RETURNING count, expires_at
    `).bind(key, resetIso, nowIso).first<{
      count: number;
      expires_at: string;
    }>();

    if (!row) {
      return { count: 0, limit, blocked: false, resetAt: resetIso };
    }

    return {
      count: row.count,
      limit,
      blocked: row.count > limit,
      resetAt: row.expires_at,
    };
  } catch (err) {
    // Fail open on D1 errors — don't break the user flow because
    // the counter backend is down. Log so ops can investigate.
    console.warn("D1 rate limit error (failing open):", err);
    return { count: 0, limit, blocked: false, resetAt: resetIso };
  }
}

/** Read the current counter without incrementing it (useful for probing). */
export async function peekLimit(
  env: Env,
  key: string,
): Promise<{ count: number; expires_at: string } | null> {
  if (!env.AUTH_DB) return null;
  try {
    const row = await env.AUTH_DB.prepare(
      `SELECT count, expires_at FROM rate_limits WHERE key = ? LIMIT 1`
    ).bind(key).first<{ count: number; expires_at: string }>();
    if (!row) return null;
    if (new Date(row.expires_at) <= new Date()) return null;
    return row;
  } catch {
    return null;
  }
}
