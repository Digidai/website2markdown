/**
 * Persist the monthly credit window.
 *
 * The read path used to treat a passed reset date as zero credits without
 * writing that reset. The portal kept showing the cumulative counter, so the
 * gate and the account page disagreed and a free account could keep spending.
 *
 * When the window has passed, the stored counter becomes this UTC month's
 * usage_daily sum and the reset moves to the next UTC month boundary.
 * A conditional update leaves a newer window alone if another request rolled
 * first. A failed write keeps the stored counter, which blocks further use
 * instead of opening another unlimited month.
 */

import type { Env } from "../types";

export function utcQuotaWindow(now = new Date()): { monthStart: string; nextResetAt: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const nextResetAt = new Date(Date.UTC(year, month + 1, 1)).toISOString();
  return { monthStart, nextResetAt };
}

export function quotaWindowExpired(resetAtIso: string, now = new Date()): boolean {
  const resetAt = Date.parse(resetAtIso);
  if (Number.isNaN(resetAt)) return false;
  return now.getTime() >= resetAt;
}

export async function ensureMonthlyQuota(
  env: Env,
  accountId: string,
  storedUsed: number,
  resetAtIso: string,
  now = new Date(),
): Promise<{ used: number; resetAt: string }> {
  if (!env.AUTH_DB || !quotaWindowExpired(resetAtIso, now)) {
    return { used: storedUsed, resetAt: resetAtIso };
  }

  const { monthStart, nextResetAt } = utcQuotaWindow(now);
  const nowIso = now.toISOString();
  try {
    await env.AUTH_DB.prepare(`
      UPDATE accounts
      SET monthly_credits_used = (
            SELECT COALESCE(SUM(credits), 0)
            FROM usage_daily
            WHERE key_id IN (SELECT id FROM api_keys WHERE account_id = ?)
              AND date >= ?
          ),
          monthly_credits_reset_at = ?,
          updated_at = ?
      WHERE id = ?
        AND monthly_credits_reset_at <= ?
    `).bind(accountId, monthStart, nextResetAt, nowIso, accountId, nowIso).run();

    const fresh = await env.AUTH_DB.prepare(
      `SELECT monthly_credits_used, monthly_credits_reset_at FROM accounts WHERE id = ?`
    ).bind(accountId).first<{
      monthly_credits_used: number;
      monthly_credits_reset_at: string;
    }>();

    if (!fresh) return { used: storedUsed, resetAt: resetAtIso };
    return {
      used: fresh.monthly_credits_used ?? 0,
      resetAt: fresh.monthly_credits_reset_at || resetAtIso,
    };
  } catch (err) {
    console.warn("Monthly quota roll failed:", err);
    return { used: storedUsed, resetAt: resetAtIso };
  }
}
