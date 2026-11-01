import type { Env } from "../types";
import type {
  AccessRow,
  AdminQuery,
  AdminReport,
  ConversionDetail,
  ConversionRow,
  DayRow,
  DaySplit,
  PairRow,
} from "../../web/contract";
import { ACCESS_SURFACE_SQL, ACCESS_SURFACES, classifyAccessPath } from "./classify";
import { loadProviderHealth } from "../observability/provider-attempts";

export type { AdminQuery, AdminReport, ConversionDetail, ConversionRow };

const PAGE_SIZE = 40;
const LIST_EXCERPT = 700;
const DAY_CHOICES = [1, 7, 14, 30, 90] as const;
const VIEWS = ["all", "failures", "access", "conversions", "pages", "api"] as const;
const OUTCOMES = ["success", "convert_error", "unexpected_error"] as const;
const ROUTES = ["convert", "stream"] as const;
const SURFACES = ACCESS_SURFACES;
const SURFACE_SQL = `(CASE WHEN COALESCE(surface, '') != '' THEN surface ELSE ${ACCESS_SURFACE_SQL} END)`;

const FAIL_SQL = "(outcome != 'success' OR status_code >= 400)";
const DEGRADED_SQL = "(COALESCE(output_chars, -1) = 0 OR COALESCE(fallbacks, '') != '' OR duration_ms >= 30000 OR COALESCE(paywall, 0) = 1)";
const ANOMALY_SQL = `(outcome = 'success' AND status_code < 400 AND ${DEGRADED_SQL})`;
const PROBLEM_SQL = `(${FAIL_SQL} OR ${ANOMALY_SQL})`;
const CLEAN_SQL = `(outcome = 'success' AND status_code < 400 AND NOT ${DEGRADED_SQL})`;

type SqlBind = string | number | null;

interface CountRow { n: number | null }
interface AccessTotals {
  pages_today: number | null;
  pages_window: number | null;
  api_today: number | null;
  api_window: number | null;
  account_window: number | null;
  probe_window: number | null;
  asset_window: number | null;
  page_errors: number | null;
  api_errors: number | null;
}
interface ConversionTotals {
  today_n: number | null;
  window_n: number | null;
  useful_today: number | null;
  useful_window: number | null;
  success_n: number | null;
  fail_n: number | null;
  anomaly_n: number | null;
  anon_n: number | null;
  signed_n: number | null;
  credits_n: number | null;
}
interface LedgerTotals { requests: number | null; credits: number | null }
interface AggregateTotals { n: number | null }


export function parseAdminQuery(url: URL): AdminQuery {
  const daysRaw = Number(url.searchParams.get("days"));
  const viewRaw = url.searchParams.get("view") || "all";
  const outcomeRaw = url.searchParams.get("outcome") || "";
  const routeRaw = url.searchParams.get("route") || "";
  const surfaceRaw = url.searchParams.get("surface") || url.searchParams.get("kind") || "";
  const platformRaw = (url.searchParams.get("platform") || "").trim().toLowerCase();
  const statusRaw = url.searchParams.get("status");
  const statusNum = statusRaw == null || statusRaw === "" ? Number.NaN : Number(statusRaw);
  return {
    days: (DAY_CHOICES as readonly number[]).includes(daysRaw) ? daysRaw : 14,
    view: (VIEWS as readonly string[]).includes(viewRaw) ? viewRaw as AdminQuery["view"] : "all",
    outcome: (OUTCOMES as readonly string[]).includes(outcomeRaw) ? outcomeRaw : "",
    route: (ROUTES as readonly string[]).includes(routeRaw) ? routeRaw : "",
    surface: (SURFACES as readonly string[]).includes(surfaceRaw) ? surfaceRaw : "",
    platform: /^[a-z0-9_+.-]{1,40}$/.test(platformRaw) ? platformRaw : "",
    status: Number.isInteger(statusNum) && statusNum >= 100 && statusNum <= 599 ? statusNum : null,
    q: (url.searchParams.get("q") || "").replace(/[\0\r\n]/g, "").trim().slice(0, 80),
    page: clampPage(url.searchParams.get("page")),
    apage: clampPage(url.searchParams.get("apage")),
  };
}

export function safeAdminBack(raw: string | null): string {
  if (!raw || raw.length > 800 || raw.startsWith("//")) return "/admin";
  if (!raw.startsWith("/admin") || raw.startsWith("/admin/conversion")) return "/admin";
  if (raw.includes("\\") || /[\r\n]/.test(raw)) return "/admin";
  const path = raw.split("?")[0];
  if (path !== "/admin" && path !== "/admin/") return "/admin";
  return raw;
}

export async function loadAdminReport(env: Env, query: AdminQuery): Promise<AdminReport> {
  if (!env.AUTH_DB) return emptyReport("统计库没有连接。", query);
  const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString();
  const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const day = since.slice(0, 10);
  const conversion = conversionWhere(query, since, true);
  const conversionAll = conversionWhere(query, since, false);
  const access = accessWhere(query, since);
  const pageAccess = accessWhere(query, since, "page");
  const apiAccess = accessWhere(query, since, "api");
  const showConversions = query.view !== "access" && query.view !== "pages" && query.view !== "api";
  const showAccess = query.view !== "conversions";
  try {
    const [
      accessTotals, conversionTotals, ledgerWindow, ledgerAll, aggregateTotals, accounts, keys,
      conversionDays, pageDays, apiDays, pagePaths, apiPaths, countries, outcomes, platforms, errorCodes, authTiers,
      topIps, conversionTotal, conversions, accessTotal, accesses, failurePreview,
    ] = await Promise.all([
      first<AccessTotals>(env, `
        SELECT
          SUM(CASE WHEN ${SURFACE_SQL} = 'page' AND created_at >= ? THEN 1 ELSE 0 END) AS pages_today,
          SUM(CASE WHEN ${SURFACE_SQL} = 'page' THEN 1 ELSE 0 END) AS pages_window,
          SUM(CASE WHEN ${SURFACE_SQL} = 'api' AND created_at >= ? THEN 1 ELSE 0 END) AS api_today,
          SUM(CASE WHEN ${SURFACE_SQL} = 'api' THEN 1 ELSE 0 END) AS api_window,
          SUM(CASE WHEN ${SURFACE_SQL} = 'account' THEN 1 ELSE 0 END) AS account_window,
          SUM(CASE WHEN ${SURFACE_SQL} = 'probe' THEN 1 ELSE 0 END) AS probe_window,
          SUM(CASE WHEN ${SURFACE_SQL} = 'asset' THEN 1 ELSE 0 END) AS asset_window,
          SUM(CASE WHEN ${SURFACE_SQL} = 'page' AND status >= 400 THEN 1 ELSE 0 END) AS page_errors,
          SUM(CASE WHEN ${SURFACE_SQL} = 'api' AND status >= 400 THEN 1 ELSE 0 END) AS api_errors
        FROM access_events WHERE created_at >= ?
      `, [today, today, since]),
      first<ConversionTotals>(env, `
        SELECT
          SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today_n,
          SUM(CASE WHEN created_at >= ? AND outcome = 'success' AND status_code < 400 AND output_chars >= 800 AND paywall = 0 THEN 1 ELSE 0 END) AS useful_today,
          COUNT(*) AS window_n,
          SUM(CASE WHEN outcome = 'success' AND status_code < 400 AND output_chars >= 800 AND paywall = 0 THEN 1 ELSE 0 END) AS useful_window,
          SUM(CASE WHEN outcome = 'success' AND status_code < 400 THEN 1 ELSE 0 END) AS success_n,
          SUM(CASE WHEN ${FAIL_SQL} THEN 1 ELSE 0 END) AS fail_n,
          SUM(CASE WHEN ${ANOMALY_SQL} THEN 1 ELSE 0 END) AS anomaly_n,
          SUM(CASE WHEN auth_tier = 'anonymous' OR auth_tier = '' THEN 1 ELSE 0 END) AS anon_n,
          SUM(CASE WHEN auth_tier != 'anonymous' AND auth_tier != '' THEN 1 ELSE 0 END) AS signed_n,
          SUM(COALESCE(credit_cost, 0)) AS credits_n
        FROM conversion_log WHERE created_at >= ?
      `, [today, today, since]),
      first<LedgerTotals>(env, `
        SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(credits), 0) AS credits
        FROM usage_daily WHERE date >= ?
      `, [day]),
      first<LedgerTotals>(env, `
        SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(credits), 0) AS credits
        FROM usage_daily
      `),
      first<AggregateTotals>(env, `
        SELECT COALESCE(SUM(request_count), 0) AS n
        FROM conversion_events_daily WHERE date >= ?
      `, [day]),
      count(env, "SELECT COUNT(*) AS n FROM accounts"),
      count(env, "SELECT COUNT(*) AS n FROM api_keys WHERE revoked_at IS NULL"),
      all<DaySplit>(env, `
        SELECT substr(created_at, 1, 10) AS day,
          SUM(CASE WHEN ${CLEAN_SQL} THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN ${ANOMALY_SQL} THEN 1 ELSE 0 END) AS warn,
          SUM(CASE WHEN ${FAIL_SQL} THEN 1 ELSE 0 END) AS bad
        FROM conversion_log WHERE ${conversion.clause}
        GROUP BY day ORDER BY day
      `, conversion.binds),
      all<DayRow>(env, `
        SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
        FROM access_events WHERE ${pageAccess.clause}
        GROUP BY day ORDER BY day
      `, pageAccess.binds),
      all<DayRow>(env, `
        SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
        FROM access_events WHERE ${apiAccess.clause}
        GROUP BY day ORDER BY day
      `, apiAccess.binds),
      all<PairRow>(env, `
        SELECT path AS label, COUNT(*) AS n FROM access_events
        WHERE ${pageAccess.clause} GROUP BY path ORDER BY n DESC LIMIT 12
      `, pageAccess.binds),
      all<PairRow>(env, `
        SELECT path AS label, COUNT(*) AS n FROM access_events
        WHERE ${apiAccess.clause} GROUP BY path ORDER BY n DESC LIMIT 12
      `, apiAccess.binds),
      all<PairRow>(env, `
        SELECT country AS label, COUNT(*) AS n FROM access_events
        WHERE ${pageAccess.clause} AND country != '' GROUP BY country ORDER BY n DESC LIMIT 12
      `, pageAccess.binds),
      all<PairRow>(env, `
        SELECT outcome AS label, COUNT(*) AS n FROM conversion_log
        WHERE ${conversion.clause} GROUP BY outcome ORDER BY n DESC
      `, conversion.binds),
      all<PairRow>(env, `
        SELECT platform AS label, COUNT(*) AS n FROM conversion_log
        WHERE ${conversion.clause} AND platform != ''
        GROUP BY platform ORDER BY n DESC LIMIT 12
      `, conversion.binds),
      all<PairRow>(env, `
        SELECT error_code AS label, COUNT(*) AS n FROM conversion_log
        WHERE ${conversion.clause} AND ${FAIL_SQL} AND error_code != ''
        GROUP BY error_code ORDER BY n DESC LIMIT 12
      `, conversion.binds),
      all<PairRow>(env, `
        SELECT auth_tier AS label, COUNT(*) AS n FROM conversion_log
        WHERE ${conversion.clause} GROUP BY auth_tier ORDER BY n DESC
      `, conversion.binds),
      all<PairRow>(env, `
        SELECT client_ip || CASE WHEN MAX(as_org) != '' THEN ' · ' || MAX(as_org) ELSE '' END AS label, COUNT(*) AS n
        FROM conversion_log
        WHERE ${conversion.clause} AND client_ip != ''
        GROUP BY client_ip ORDER BY n DESC LIMIT 12
      `, conversion.binds),
      showConversions
        ? count(env, `SELECT COUNT(*) AS n FROM conversion_log WHERE ${conversion.clause}`, conversion.binds)
        : Promise.resolve(0),
      showConversions
        ? all<ConversionRow>(env, `
            ${conversionColumns(LIST_EXCERPT)}
            WHERE ${conversion.clause}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
          `, [...conversion.binds, PAGE_SIZE, (query.page - 1) * PAGE_SIZE])
        : Promise.resolve([]),
      showAccess
        ? count(env, `SELECT COUNT(*) AS n FROM access_events WHERE ${access.clause}`, access.binds)
        : Promise.resolve(0),
      showAccess
        ? all<AccessRow>(env, `
            SELECT created_at, kind, method, path, status, country, ua_family, referrer_host,
                   ${SURFACE_SQL} AS surface, route_name, duration_ms, auth_present, query_redacted, format,
                   client_ip, user_agent, asn, as_org, city
            FROM access_events WHERE ${access.clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
          `, [...access.binds, PAGE_SIZE, (query.apage - 1) * PAGE_SIZE])
        : Promise.resolve([]),
      query.view === "failures"
        ? Promise.resolve([])
        : all<ConversionRow>(env, `
            ${conversionColumns(LIST_EXCERPT)}
            WHERE ${conversionAll.clause} AND ${PROBLEM_SQL}
            ORDER BY created_at DESC, id DESC
            LIMIT 8
          `, conversionAll.binds),
    ]);
    const conversionsWindow = num(conversionTotals?.window_n);
    const success = num(conversionTotals?.success_n);
    return {
      error: "",
      query,
      pagesToday: num(accessTotals?.pages_today),
      pagesWindow: num(accessTotals?.pages_window),
      pageErrors: num(accessTotals?.page_errors),
      apiToday: num(accessTotals?.api_today),
      apiWindow: num(accessTotals?.api_window),
      apiErrors: num(accessTotals?.api_errors),
      accountWindow: num(accessTotals?.account_window),
      probeWindow: num(accessTotals?.probe_window),
      assetWindow: num(accessTotals?.asset_window),
      conversionsToday: num(conversionTotals?.today_n),
      conversionsWindow,
      usefulToday: num(conversionTotals?.useful_today),
      usefulWindow: num(conversionTotals?.useful_window),
      successRate: conversionsWindow === 0 ? 0 : Math.round((success / conversionsWindow) * 1000) / 10,
      failures: num(conversionTotals?.fail_n),
      anomalies: num(conversionTotals?.anomaly_n),
      anonUsage: num(conversionTotals?.anon_n),
      signedUsage: num(conversionTotals?.signed_n),
      creditSum: num(conversionTotals?.credits_n),
      ledgerRequests: num(ledgerWindow?.requests),
      ledgerCredits: num(ledgerWindow?.credits),
      ledgerRequestsAll: num(ledgerAll?.requests),
      ledgerCreditsAll: num(ledgerAll?.credits),
      aggregateRequests: num(aggregateTotals?.n),
      accounts,
      keys,
      conversionDays: conversionDays.map((row) => ({
        day: row.day,
        ok: num(row.ok),
        warn: num(row.warn),
        bad: num(row.bad),
      })),
      pageDays: pageDays.map((row) => ({ day: row.day, n: num(row.n) })),
      apiDays: apiDays.map((row) => ({ day: row.day, n: num(row.n) })),
      pagePaths: normalizePairs(pagePaths),
      apiPaths: normalizePairs(apiPaths),
      authTiers: normalizePairs(authTiers),
      topIps: normalizePairs(topIps),
      countries: normalizePairs(countries),
      outcomes: normalizePairs(outcomes),
      platforms: normalizePairs(platforms),
      errorCodes: normalizePairs(errorCodes),
      conversions: conversions.map(mapConversion),
      conversionTotal,
      accesses: accesses.map(mapAccess),
      accessTotal,
      failurePreview: failurePreview.map(mapConversion),
      providerHealth: await loadProviderHealth(env, day),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "query failed";
    return emptyReport(message.includes("no such table") || message.includes("no such column")
      ? "统计表还没有迁移。在仓库执行 wrangler d1 migrations apply AUTH_DB --remote。"
      : "读取统计失败。", query);
  }
}

export async function loadConversionDetail(env: Env, id: string): Promise<ConversionDetail> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { error: "记录不存在。", row: null };
  }
  if (!env.AUTH_DB) return { error: "统计库没有连接。", row: null };
  try {
    const row = await first<ConversionRow>(env, `
      ${conversionColumns(0)}
      WHERE id = ?
    `, [id]);
    if (!row) return { error: "记录不存在。", row: null };
    return { error: "", row: mapConversion(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "query failed";
    return {
      error: message.includes("no such column") || message.includes("no such table")
        ? "统计表还没有迁移。在仓库执行 wrangler d1 migrations apply AUTH_DB --remote。"
        : "读取记录失败。",
      row: null,
    };
  }
}

function conversionColumns(excerptChars: number): string {
  const excerpt = excerptChars > 0 ? `substr(output_excerpt, 1, ${excerptChars})` : "output_excerpt";
  return `
    SELECT id, created_at, route, target_url, target_host, platform, outcome, status_code,
           method_used, cache_status, duration_ms, format, country, auth_tier, error_code,
           ${excerpt} AS output_excerpt, output_chars, error_message, fallbacks,
           paywall, browser_rendered, request_id, engine_requested, credit_cost,
           selector_present, force_browser, no_cache, quota_bucket, account_hash, key_hash,
           ua_family, colo, content_type, duration_bucket, output_size_bucket, selector_bucket,
           has_account, has_key, client_ip, user_agent, asn, as_org, city, account_id, key_id
    FROM conversion_log
  `;
}


function emptyReport(error: string, query: AdminQuery): AdminReport {
  return {
    error,
    query,
    pagesToday: 0,
    pagesWindow: 0,
    pageErrors: 0,
    apiToday: 0,
    apiWindow: 0,
    apiErrors: 0,
    accountWindow: 0,
    probeWindow: 0,
    assetWindow: 0,
    conversionsToday: 0,
    conversionsWindow: 0,
    usefulToday: 0,
    usefulWindow: 0,
    successRate: 0,
    failures: 0,
    anomalies: 0,
    anonUsage: 0,
    signedUsage: 0,
    creditSum: 0,
    ledgerRequests: 0,
    ledgerCredits: 0,
    ledgerRequestsAll: 0,
    ledgerCreditsAll: 0,
    aggregateRequests: 0,
    accounts: 0,
    keys: 0,
    conversionDays: [],
    pageDays: [],
    apiDays: [],
    pagePaths: [],
    apiPaths: [],
    authTiers: [],
    topIps: [],
    countries: [],
    outcomes: [],
    platforms: [],
    errorCodes: [],
    conversions: [],
    conversionTotal: 0,
    accesses: [],
    accessTotal: 0,
    failurePreview: [],
    providerHealth: [],
  };
}

function conversionWhere(query: AdminQuery, since: string, includeView: boolean): { clause: string; binds: SqlBind[] } {
  const parts = ["created_at >= ?"];
  const binds: SqlBind[] = [since];
  if (includeView && query.view === "failures") parts.push(PROBLEM_SQL);
  if (query.outcome) {
    parts.push("outcome = ?");
    binds.push(query.outcome);
  }
  if (query.route) {
    parts.push("route = ?");
    binds.push(query.route);
  }
  if (query.platform) {
    parts.push("platform = ?");
    binds.push(query.platform);
  }
  if (query.status != null) {
    parts.push("status_code = ?");
    binds.push(query.status);
  }
  if (query.q) {
    const like = likeContains(query.q);
    parts.push("(target_url LIKE ? ESCAPE '\\' OR target_host LIKE ? ESCAPE '\\' OR error_code LIKE ? ESCAPE '\\' OR error_message LIKE ? ESCAPE '\\' OR platform LIKE ? ESCAPE '\\' OR client_ip LIKE ? ESCAPE '\\' OR user_agent LIKE ? ESCAPE '\\' OR as_org LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like, like, like, like, like);
  }
  return { clause: parts.join(" AND "), binds };
}

function accessWhere(query: AdminQuery, since: string, surfaceLock = ""): { clause: string; binds: SqlBind[] } {
  const parts = ["created_at >= ?"];
  const binds: SqlBind[] = [since];
  if (query.view === "failures") parts.push("status >= 400");
  if (query.view === "pages") {
    parts.push(`${SURFACE_SQL} = 'page'`);
  }
  if (query.view === "api") {
    parts.push(`${SURFACE_SQL} = 'api'`);
  }
  const surface = surfaceLock || query.surface;
  if (surface) {
    parts.push(`${SURFACE_SQL} = ?`);
    binds.push(surface);
  }
  if (query.status != null) {
    parts.push("status = ?");
    binds.push(query.status);
  }
  if (query.q) {
    const like = likeContains(query.q);
    parts.push("(path LIKE ? ESCAPE '\\' OR referrer_host LIKE ? ESCAPE '\\' OR client_ip LIKE ? ESCAPE '\\' OR user_agent LIKE ? ESCAPE '\\' OR as_org LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like, like);
  }
  return { clause: parts.join(" AND "), binds };
}

function likeContains(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${escaped}%`;
}

function mapConversion(row: ConversionRow): ConversionRow {
  return {
    ...row,
    target_url: row.target_url || "",
    target_host: row.target_host || "",
    platform: row.platform || "",
    outcome: row.outcome || "",
    method_used: row.method_used || "",
    cache_status: row.cache_status || "",
    format: row.format || "",
    country: row.country || "",
    auth_tier: row.auth_tier || "",
    error_code: row.error_code || "",
    output_excerpt: row.output_excerpt || "",
    error_message: row.error_message || "",
    fallbacks: row.fallbacks || "",
    status_code: num(row.status_code),
    duration_ms: num(row.duration_ms),
    output_chars: row.output_chars == null || row.output_chars === undefined ? null : num(row.output_chars),
    paywall: num(row.paywall),
    browser_rendered: num(row.browser_rendered),
    request_id: row.request_id || "",
    engine_requested: row.engine_requested || "",
    credit_cost: nullableNum(row.credit_cost),
    selector_present: nullableNum(row.selector_present),
    force_browser: nullableNum(row.force_browser),
    no_cache: nullableNum(row.no_cache),
    quota_bucket: row.quota_bucket || "",
    account_hash: row.account_hash || "",
    key_hash: row.key_hash || "",
    ua_family: row.ua_family || "",
    colo: row.colo || "",
    content_type: row.content_type || "",
    duration_bucket: row.duration_bucket || "",
    output_size_bucket: row.output_size_bucket || "",
    selector_bucket: row.selector_bucket || "",
    has_account: nullableNum(row.has_account),
    has_key: nullableNum(row.has_key),
    client_ip: row.client_ip || "",
    user_agent: row.user_agent || "",
    asn: nullableNum(row.asn),
    as_org: row.as_org || "",
    city: row.city || "",
    account_id: row.account_id || "",
    key_id: row.key_id || "",
  };
}

function nullableNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  return num(value);
}


function mapAccess(row: AccessRow): AccessRow {
  const classified = classifyAccessPath(row.path || "/");
  const duration = row.duration_ms == null || row.duration_ms === undefined ? null : num(row.duration_ms);
  return {
    ...row,
    status: num(row.status),
    path: row.path || "",
    country: row.country || "",
    ua_family: row.ua_family || "",
    referrer_host: row.referrer_host || "",
    surface: row.surface || classified.surface,
    route_name: row.route_name || classified.route,
    duration_ms: duration,
    auth_present: row.auth_present || "",
    query_redacted: row.query_redacted || "",
    format: row.format || "",
    client_ip: row.client_ip || "",
    user_agent: row.user_agent || "",
    asn: nullableNum(row.asn),
    as_org: row.as_org || "",
    city: row.city || "",
  };
}

function normalizePairs(rows: PairRow[]): PairRow[] {
  return rows.map((row) => ({ label: row.label || "", n: num(row.n) }));
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clampPage(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, 500);
}

async function count(env: Env, sql: string, binds: SqlBind[] = []): Promise<number> {
  const row = await first<CountRow>(env, sql, binds);
  return num(row?.n);
}

async function first<T>(env: Env, sql: string, binds: SqlBind[] = []): Promise<T | null> {
  const stmt = env.AUTH_DB!.prepare(sql);
  const row = binds.length ? await stmt.bind(...binds).first<T>() : await stmt.first<T>();
  return row ?? null;
}

async function all<T>(env: Env, sql: string, binds: SqlBind[] = []): Promise<T[]> {
  const stmt = env.AUTH_DB!.prepare(sql);
  const result = binds.length ? await stmt.bind(...binds).all<T>() : await stmt.all<T>();
  return result.results || [];
}
