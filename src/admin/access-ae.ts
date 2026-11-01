import type { Env } from "../types";

/**
 * Reads the `access_events` Analytics Engine dataset written by recordAccess.
 *
 * Column layout (append only, never reorder):
 *   index1  client_ip
 *   blob1 surface, blob2 method, blob3 path, blob4 country, blob5 colo,
 *   blob6 ua_family, blob7 referrer_host, blob8 route_name, blob9 auth_present,
 *   blob10 cache_status, blob11 format, blob12 query_redacted, blob13 request_id,
 *   blob14 client_ip, blob15 user_agent, blob16 as_org, blob17 city
 *   double1 status, double2 duration_ms, double3 asn (0 = unknown)
 *
 * The dataset is sampled under load, so counts are SUM(_sample_interval).
 */
export const AE_COUNT = "SUM(_sample_interval)";

export function aeCountIf(condition: string): string {
  return `SUM(IF(${condition}, _sample_interval, 0))`;
}

/** ISO timestamp to an Analytics Engine DateTime literal (UTC). */
export function aeTime(iso: string): string {
  return `toDateTime('${iso.slice(0, 19).replace("T", " ")}')`;
}

/**
 * String literal for the SQL API, which has no bound parameters and rejects
 * quotes and backslashes inside literals, so those characters are dropped.
 */
export function aeText(value: string): string {
  return `'${value.replace(/['\\]/g, "")}'`;
}

/** Analytics Engine DateTime ("2026-11-01 15:13:36") to ISO. */
export function aeIso(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}.000Z` : value;
}

export async function queryAccessEvents<T>(env: Env, sql: string): Promise<T[]> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) {
    throw new Error("CF_ACCOUNT_ID 或 CF_ANALYTICS_TOKEN 未配置");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
      body: `${sql} FORMAT JSON`,
    },
  );
  if (!response.ok) {
    throw new Error(`Analytics Engine ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const body = await response.json() as { data?: T[] };
  return body.data ?? [];
}
