/**
 * D1-backed API key authentication with LRU cache.
 *
 *   Request ──▶ parse Bearer header ──▶ LRU hit? ──▶ return
 *                                       │ miss
 *                                       ▼
 *                                  D1 query by hash ──▶ cache + return
 *                                       │ fail
 *                                       ▼
 *                                  LRU has stale? ──▶ return stale tier
 *                                       │ no
 *                                       ▼
 *                                  return anonymous
 */

import type { AuthContext, Env, Tier } from "../types";
import { TIER_QUOTAS } from "../types";

const AUTH_LRU_CAPACITY = 1024;
/**
 * Auth LRU TTL: 10 seconds (was 60s).
 *
 * Trade-off: lower TTL = faster key revocation propagation, higher D1 read
 * volume. 10s keeps D1 reads bounded (at 10 req/s sustained, that's 1 D1
 * read per key per 10s) while giving users a credible "revoke takes
 * effect in seconds" guarantee.
 *
 * Note: this is per-isolate. A revoked key could still work on a different
 * isolate that hasn't refreshed its LRU yet. Hard cross-isolate invalidation
 * would require Durable Objects; that's Phase D+.
 */
const AUTH_LRU_TTL_MS = 10_000;

interface CachedAuth {
  ctx: AuthContext;
  expiresAt: number;
}

const authLru = new Map<string, CachedAuth>();

function touchLru(hash: string, entry: CachedAuth): void {
  authLru.delete(hash);
  authLru.set(hash, entry);
  if (authLru.size > AUTH_LRU_CAPACITY) {
    const oldest = authLru.keys().next().value;
    if (oldest !== undefined) authLru.delete(oldest);
  }
}

async function hashKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseBearer(request: Request): string | null {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ") && auth.length > 7) {
    return auth.slice(7).trim();
  }
  return null;
}

const ANONYMOUS: AuthContext = {
  tier: "anonymous",
  accountId: null,
  keyId: null,
  quotaLimit: 0,
  quotaUsed: 0,
};

export async function resolveAuth(
  request: Request,
  env: Env,
): Promise<AuthContext> {
  const rawKey = parseBearer(request);
  if (!rawKey) return ANONYMOUS;
  if (!rawKey.startsWith("mk_")) return ANONYMOUS;
  if (!env.AUTH_DB) return ANONYMOUS;

  const keyHash = await hashKey(rawKey);

  // LRU cache check
  const cached = authLru.get(keyHash);
  if (cached && cached.expiresAt > Date.now()) {
    touchLru(keyHash, cached);
    return cached.ctx;
  }

  // D1 query
  try {
    const row = await env.AUTH_DB.prepare(`
      SELECT k.id AS key_id, k.account_id, k.revoked_at,
             a.tier, a.monthly_credits_used, a.monthly_credits_reset_at
      FROM api_keys k
      JOIN accounts a ON k.account_id = a.id
      WHERE k.key_hash = ?
      LIMIT 1
    `).bind(keyHash).first<{
      key_id: string;
      account_id: string;
      revoked_at: string | null;
      tier: string;
      monthly_credits_used: number;
      monthly_credits_reset_at: string;
    }>();

    if (!row) return ANONYMOUS;
    if (row.revoked_at) return ANONYMOUS;

    // Check if monthly credits need reset (new month)
    const now = new Date();
    const resetAt = new Date(row.monthly_credits_reset_at);
    const creditsUsed = now >= resetAt ? 0 : row.monthly_credits_used;

    const tier = (row.tier === "pro" ? "pro" : "free") as Tier;
    const ctx: AuthContext = {
      tier,
      accountId: row.account_id,
      keyId: row.key_id,
      quotaLimit: TIER_QUOTAS[tier],
      quotaUsed: creditsUsed,
    };

    touchLru(keyHash, { ctx, expiresAt: Date.now() + AUTH_LRU_TTL_MS });
    return ctx;
  } catch (err) {
    // D1 failure: use stale LRU if available (preserve paid tier)
    if (cached) {
      console.warn("D1 auth query failed, using stale LRU cache:", err);
      touchLru(keyHash, { ...cached, expiresAt: Date.now() + AUTH_LRU_TTL_MS });
      return cached.ctx;
    }
    console.error("D1 auth query failed, no LRU fallback:", err);
    return ANONYMOUS;
  }
}

/** For testing: clear the LRU cache */
export function clearAuthLru(): void {
  authLru.clear();
}
