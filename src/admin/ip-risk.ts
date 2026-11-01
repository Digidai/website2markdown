import type { IpRiskLevel, SuspiciousIp } from "../../web/contract";
import type { Env } from "../types";
import { AE_COUNT, aeCountIf, aeTime, queryAccessEvents } from "./access-ae";

/**
 * Rule-based risk score for anonymous caller IPs over a recent window.
 * Observe-only: the admin lists these, nothing enforces them yet.
 */

export interface IpActivity {
  ip: string;
  asn: number | null;
  asOrg: string;
  country: string;
  uaFamily: string;
  /** API and probe requests in the access_events Analytics Engine dataset. */
  requests: number;
  /** Requests answered 401 or 429 (blocked targets, rate limits). */
  blocked: number;
  /** Requests answered 400 (malformed targets). */
  malformed: number;
  probes: number;
  /** Distinct UTC hours with any request. */
  activeHours: number;
  /** Anonymous conversions in conversion_log. */
  conversions: number;
  failures: number;
  hosts: number;
  topHost: string;
  topHostCount: number;
}

export interface IpRisk {
  score: number;
  level: IpRiskLevel;
  reasons: string[];
}

const SCRIPT_UA = new Set(["bot", "curl", "python", "node", "unknown", "postman", ""]);
const DATACENTER_ORG =
  /\b(cloud|hosting|host|server|datacenter|data center|amazon|aws|google|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|alibaba|tencent|oracle|vultr|contabo|leaseweb|choopa|m247|scaleway)\b/i;

export const SUSPICIOUS_SCORE = 3;
export const ABUSE_SCORE = 6;

export function scoreIp(a: IpActivity): IpRisk {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (a.requests >= 300) add(3, `请求很多（${a.requests} 次）`);
  else if (a.requests >= 100) add(2, `请求较多（${a.requests} 次）`);
  else if (a.requests >= 50) add(1, `请求偏多（${a.requests} 次）`);

  if (a.activeHours >= 12) add(2, `全天不停（${a.activeHours} 个小时有请求）`);

  if (a.conversions >= 20 && a.failures / a.conversions >= 0.5) {
    add(2, `失败率高（${Math.round((a.failures / a.conversions) * 100)}%）`);
  }

  if (a.conversions >= 50 && a.topHostCount / a.conversions >= 0.8) {
    add(1, `盯着一个站抓（${a.topHost}）`);
  } else if (a.hosts >= 100) {
    add(1, `大范围抓取（${a.hosts} 个站）`);
  }

  if (a.blocked >= 20) add(2, `频繁被拦（${a.blocked} 次 401/429）`);
  if (a.malformed >= 10) add(1, `大量无效链接（${a.malformed} 次 400）`);
  if (a.probes >= 5) add(3, `扫描敏感路径（${a.probes} 次）`);

  if (SCRIPT_UA.has(a.uaFamily)) add(1, `脚本客户端（${a.uaFamily || "无 UA"}）`);
  if (DATACENTER_ORG.test(a.asOrg)) add(1, "机房 IP");

  const level: IpRiskLevel = score >= ABUSE_SCORE ? "abuse" : score >= SUSPICIOUS_SCORE ? "suspicious" : "normal";
  return { score, level, reasons };
}

interface AccessAgg {
  ip: string;
  requests: number;
  blocked: number;
  malformed: number;
  probes: number;
  active_hours: number;
  ua_family: string | null;
  as_org: string | null;
  asn: number | null;
  country: string | null;
}

interface ConversionAgg {
  ip: string;
  conversions: number;
  failures: number;
  hosts: number;
  top_count: number;
  top_host: string | null;
}

/** Anonymous IPs with at least this many requests in the window are scored. */
const MIN_REQUESTS = 20;
const MAX_IPS = 200;

export async function loadSuspiciousIps(env: Env, since: string, limit = 50): Promise<SuspiciousIp[]> {
  const db = env.AUTH_DB;
  if (!db) return [];
  const [access, conversions] = await Promise.all([
    queryAccessEvents<AccessAgg>(env, `
      SELECT blob14 AS ip, ${AE_COUNT} AS requests,
        ${aeCountIf("(double1 = 401 OR double1 = 429)")} AS blocked,
        ${aeCountIf("double1 = 400")} AS malformed,
        ${aeCountIf("blob1 = 'probe'")} AS probes,
        COUNT(DISTINCT toHour(timestamp)) AS active_hours,
        argMax(blob6, timestamp) AS ua_family, argMax(blob16, timestamp) AS as_org,
        max(double3) AS asn, argMax(blob4, timestamp) AS country
      FROM access_events
      WHERE timestamp >= ${aeTime(since)} AND blob14 != '' AND blob1 IN ('api', 'probe')
        AND blob9 NOT IN ('bearer', 'both')
      GROUP BY ip HAVING ${AE_COUNT} >= ${MIN_REQUESTS}
      ORDER BY requests DESC LIMIT ${MAX_IPS}
    `),
    db.prepare(`
      SELECT ip, SUM(n) AS conversions, SUM(f) AS failures, COUNT(*) AS hosts,
        -- SQLite takes a bare column from the row that MAX() picked.
        MAX(n) AS top_count, target_host AS top_host
      FROM (
        SELECT client_ip AS ip, target_host, COUNT(*) AS n,
          SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END) AS f
        FROM conversion_log
        WHERE created_at >= ? AND client_ip != '' AND (auth_tier = 'anonymous' OR auth_tier = '')
        GROUP BY client_ip, target_host
      )
      GROUP BY ip
    `).bind(since).all<ConversionAgg>(),
  ]);
  const byIp = new Map((conversions.results ?? []).map((row) => [row.ip, row]));
  const scored: SuspiciousIp[] = [];
  for (const row of access) {
    const conv = byIp.get(row.ip);
    const activity: IpActivity = {
      ip: row.ip,
      asn: Number(row.asn) ? Number(row.asn) : null,
      asOrg: row.as_org || "",
      country: row.country || "",
      uaFamily: row.ua_family || "",
      requests: Number(row.requests) || 0,
      blocked: Number(row.blocked) || 0,
      malformed: Number(row.malformed) || 0,
      probes: Number(row.probes) || 0,
      activeHours: Number(row.active_hours) || 0,
      conversions: Number(conv?.conversions) || 0,
      failures: Number(conv?.failures) || 0,
      hosts: Number(conv?.hosts) || 0,
      topHost: conv?.top_host || "",
      topHostCount: Number(conv?.top_count) || 0,
    };
    const risk = scoreIp(activity);
    if (risk.level === "normal") continue;
    scored.push({
      ip: activity.ip,
      asn: activity.asn,
      as_org: activity.asOrg,
      country: activity.country,
      ua_family: activity.uaFamily,
      requests: activity.requests,
      conversions: activity.conversions,
      failures: activity.failures,
      hosts: activity.hosts,
      top_host: activity.topHost,
      score: risk.score,
      level: risk.level,
      reasons: risk.reasons,
    });
  }
  return scored.sort((a, b) => b.score - a.score || b.requests - a.requests).slice(0, limit);
}
