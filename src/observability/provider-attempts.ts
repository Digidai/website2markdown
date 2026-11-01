import type { Env } from "../types";
import { logMetric } from "../runtime-state";
import { sanitizeErrorMessage } from "./conversion-events";
import { sendEmail } from "../helpers/email";
import { ALERT_FAILURE_RATE, ALERT_MIN_ATTEMPTS, type ProviderPathHealth } from "../../web/contract";

/**
 * Fallback paths whose outcome is tracked per call. Each name is one upstream
 * dependency, so a dead provider shows up as one row with a high failure rate.
 */
export type ProviderPath =
  | "firecrawl"
  | "jina"
  | "cf_markdown"
  | "browser"
  | "browser_use"
  | "proxy_pool"
  | "proxy"
  | "wayback"
  | "archive_today"
  | "context_dev";

export type { ProviderPathHealth };
export { ALERT_FAILURE_RATE, ALERT_MIN_ATTEMPTS };
const RETENTION_DAYS = 90;

/**
 * Runs one provider call and records whether it produced a usable result.
 * A call counts as failed when it throws or when `succeeded` rejects its value.
 * Failures caused by the caller aborting the request are not recorded, because
 * they say nothing about the provider.
 */
export async function trackProvider<T>(
  env: Env,
  path: ProviderPath,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
  succeeded: (value: T) => boolean = () => true,
): Promise<T> {
  let value: T;
  try {
    value = await run();
  } catch (error) {
    if (!signal?.aborted) await recordProviderAttempt(env, path, false, sanitizeErrorMessage(error));
    throw error;
  }
  const ok = succeeded(value);
  if (ok || !signal?.aborted) {
    await recordProviderAttempt(env, path, ok, ok ? "" : "empty or unusable result");
  }
  return value;
}

export async function recordProviderAttempt(
  env: Env,
  path: ProviderPath,
  ok: boolean,
  error = "",
): Promise<void> {
  logMetric("provider.attempt", { path, ok, ...(error ? { error } : {}) });
  if (!env.AUTH_DB) return;
  const now = new Date().toISOString();
  try {
    await env.AUTH_DB.prepare(`
      INSERT INTO provider_attempts_daily (date, path, attempts, failures, last_error, last_failure_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (date, path) DO UPDATE SET
        attempts = attempts + 1,
        failures = failures + excluded.failures,
        last_error = CASE WHEN excluded.failures > 0 THEN excluded.last_error ELSE last_error END,
        last_failure_at = CASE WHEN excluded.failures > 0 THEN excluded.last_failure_at ELSE last_failure_at END,
        updated_at = excluded.updated_at
    `).bind(now.slice(0, 10), path, ok ? 0 : 1, ok ? "" : error, ok ? "" : now, now).run();
  } catch (dbError) {
    console.error("Provider attempt write failed:", sanitizeErrorMessage(dbError));
  }
}

/** Totals per path from `sinceDate` (YYYY-MM-DD, inclusive), worst failure rate first. */
export async function loadProviderHealth(env: Env, sinceDate: string): Promise<ProviderPathHealth[]> {
  if (!env.AUTH_DB) return [];
  try {
    const result = await env.AUTH_DB.prepare(`
      SELECT path,
        SUM(attempts) AS attempts,
        SUM(failures) AS failures,
        MAX(last_failure_at) AS last_failure_at,
        (SELECT p2.last_error FROM provider_attempts_daily p2
          WHERE p2.path = p.path AND p2.date >= ? AND p2.last_failure_at != ''
          ORDER BY p2.last_failure_at DESC LIMIT 1) AS last_error
      FROM provider_attempts_daily p
      WHERE date >= ?
      GROUP BY path
    `).bind(sinceDate, sinceDate).all<{
      path: string;
      attempts: number;
      failures: number;
      last_failure_at: string | null;
      last_error: string | null;
    }>();
    return (result.results ?? [])
      .map((row) => ({
        path: row.path,
        attempts: Number(row.attempts) || 0,
        failures: Number(row.failures) || 0,
        lastError: row.last_error || "",
        lastFailureAt: row.last_failure_at || "",
      }))
      .sort((a, b) => failureRate(b) - failureRate(a) || b.attempts - a.attempts);
  } catch (error) {
    console.error("Provider health read failed:", sanitizeErrorMessage(error));
    return [];
  }
}

export function failureRate(row: Pick<ProviderPathHealth, "attempts" | "failures">): number {
  return row.attempts > 0 ? row.failures / row.attempts : 0;
}

export function unhealthyPaths(rows: ProviderPathHealth[]): ProviderPathHealth[] {
  return rows.filter((row) => row.attempts >= ALERT_MIN_ATTEMPTS && failureRate(row) >= ALERT_FAILURE_RATE);
}

/**
 * Daily check run from the cron trigger. Looks at yesterday and today (UTC),
 * and emails ADMIN_EMAIL through Cloudflare Email Sending when any path crosses the threshold.
 */
export async function checkProviderHealth(env: Env, now = new Date()): Promise<ProviderPathHealth[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const unhealthy = unhealthyPaths(await loadProviderHealth(env, since));
  if (unhealthy.length === 0) return [];

  const lines = unhealthy.map((row) =>
    `${row.path}: ${row.failures}/${row.attempts} failed (${Math.round(failureRate(row) * 100)}%), last error at ${row.lastFailureAt || "unknown"}: ${row.lastError || "none recorded"}`,
  );
  logMetric("provider.alert", { since, paths: unhealthy.map((row) => row.path) });
  console.warn("Provider paths unhealthy:", lines.join(" | "));

  if (!env.EMAIL || !env.ADMIN_EMAIL) {
    console.warn("Provider alert email skipped: configure the EMAIL binding and the ADMIN_EMAIL secret to receive it.");
    return unhealthy;
  }
  const text = [
    `These fallback paths failed at least ${Math.round(ALERT_FAILURE_RATE * 100)}% of calls since ${since} (UTC), with at least ${ALERT_MIN_ATTEMPTS} calls each:`,
    "",
    ...lines,
    "",
    "Details: https://mdget.dev/admin",
  ].join("\n");
  try {
    await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: `[mdget.dev] ${unhealthy.length} fallback path(s) failing: ${unhealthy.map((row) => row.path).join(", ")}`,
      text,
    });
  } catch (error) {
    console.error("Provider alert email failed:", sanitizeErrorMessage(error));
  }
  return unhealthy;
}

export async function cleanupProviderAttempts(env: Env, now = new Date()): Promise<void> {
  if (!env.AUTH_DB) return;
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    await env.AUTH_DB.prepare("DELETE FROM provider_attempts_daily WHERE date < ?").bind(cutoff).run();
  } catch (error) {
    console.error("Provider attempt cleanup failed:", sanitizeErrorMessage(error));
  }
}
