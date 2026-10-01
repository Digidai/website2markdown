import type { Env } from "../types";
import { FONT_READING, PROSE_CSS } from "../templates/theme";
import { ACCESS_SURFACE_SQL, ACCESS_SURFACES, classifyAccessPath } from "./classify";

const PAGE_SIZE = 40;
const LIST_EXCERPT = 700;
const DAY_CHOICES = [1, 7, 14, 30, 90] as const;
const VIEWS = ["all", "failures", "access", "conversions", "pages", "api"] as const;
const OUTCOMES = ["success", "convert_error", "unexpected_error"] as const;
const ROUTES = ["convert", "stream"] as const;
const SURFACES = ACCESS_SURFACES;
const SURFACE_SQL = `(CASE WHEN COALESCE(surface, '') != '' THEN surface ELSE ${ACCESS_SURFACE_SQL} END)`;
const SURFACE_LABEL: Record<string, string> = {
  page: "页面访问",
  api: "API 访问",
  account: "账号接口",
  asset: "资产",
  probe: "探测",
  admin: "后台",
  other: "其他",
};

const FAIL_SQL = "(outcome != 'success' OR status_code >= 400)";
const DEGRADED_SQL = "(COALESCE(output_chars, -1) = 0 OR COALESCE(fallbacks, '') != '' OR duration_ms >= 30000 OR COALESCE(paywall, 0) = 1)";
const ANOMALY_SQL = `(outcome = 'success' AND status_code < 400 AND ${DEGRADED_SQL})`;
const PROBLEM_SQL = `(${FAIL_SQL} OR ${ANOMALY_SQL})`;
const CLEAN_SQL = `(outcome = 'success' AND status_code < 400 AND NOT ${DEGRADED_SQL})`;

type SqlBind = string | number | null;
type Flag = "fail" | "warn" | "ok";

interface CountRow { n: number | null }
interface PairRow { label: string; n: number }
interface DayRow { day: string; n: number }
interface DaySplit { day: string; ok: number; warn: number; bad: number }
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

interface AccessRow {
  created_at: string;
  kind: string;
  method: string;
  path: string;
  status: number;
  country: string;
  ua_family: string;
  referrer_host: string;
  surface?: string;
  route_name?: string;
  duration_ms?: number | null;
  auth_present?: string;
  query_redacted?: string;
  format?: string;
}

export interface ConversionRow {
  id: string;
  created_at: string;
  route: string;
  target_url: string;
  target_host: string;
  platform: string;
  outcome: string;
  status_code: number;
  method_used: string;
  cache_status: string;
  duration_ms: number;
  format: string;
  country: string;
  auth_tier: string;
  error_code: string;
  output_excerpt: string;
  output_chars: number | null;
  error_message: string;
  fallbacks: string;
  paywall: number;
  browser_rendered: number;
  request_id?: string;
  engine_requested?: string;
  credit_cost?: number | null;
  selector_present?: number | null;
  force_browser?: number | null;
  no_cache?: number | null;
  quota_bucket?: string;
  account_hash?: string;
  key_hash?: string;
  ua_family?: string;
  colo?: string;
  content_type?: string;
  duration_bucket?: string;
  output_size_bucket?: string;
  selector_bucket?: string;
  has_account?: number | null;
  has_key?: number | null;
}

export interface AdminQuery {
  days: number;
  view: (typeof VIEWS)[number];
  outcome: string;
  route: string;
  platform: string;
  surface: string;
  status: number | null;
  q: string;
  page: number;
  apage: number;
}

export interface AdminReport {
  error: string;
  query: AdminQuery;
  pagesToday: number;
  pagesWindow: number;
  pageErrors: number;
  apiToday: number;
  apiWindow: number;
  apiErrors: number;
  accountWindow: number;
  probeWindow: number;
  assetWindow: number;
  conversionsToday: number;
  conversionsWindow: number;
  usefulToday: number;
  usefulWindow: number;
  successRate: number;
  failures: number;
  anomalies: number;
  anonUsage: number;
  signedUsage: number;
  creditSum: number;
  ledgerRequests: number;
  ledgerCredits: number;
  ledgerRequestsAll: number;
  ledgerCreditsAll: number;
  aggregateRequests: number;
  accounts: number;
  keys: number;
  conversionDays: DaySplit[];
  pageDays: DayRow[];
  apiDays: DayRow[];
  pagePaths: PairRow[];
  apiPaths: PairRow[];
  authTiers: PairRow[];
  countries: PairRow[];
  outcomes: PairRow[];
  platforms: PairRow[];
  errorCodes: PairRow[];
  conversions: ConversionRow[];
  conversionTotal: number;
  accesses: AccessRow[];
  accessTotal: number;
  failurePreview: ConversionRow[];
}

export interface ConversionDetail {
  error: string;
  row: ConversionRow | null;
}

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

export function conversionFlag(row: Pick<ConversionRow, "outcome" | "status_code" | "output_chars" | "fallbacks" | "duration_ms" | "paywall">): Flag {
  if (row.outcome !== "success" || row.status_code >= 400) return "fail";
  if (row.output_chars === 0 || Boolean(row.fallbacks) || row.duration_ms >= 30000 || row.paywall === 1) return "warn";
  return "ok";
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
      conversionTotal, conversions, accessTotal, accesses, failurePreview,
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
                   ${SURFACE_SQL} AS surface, route_name, duration_ms, auth_present, query_redacted, format
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
      countries: normalizePairs(countries),
      outcomes: normalizePairs(outcomes),
      platforms: normalizePairs(platforms),
      errorCodes: normalizePairs(errorCodes),
      conversions: conversions.map(mapConversion),
      conversionTotal,
      accesses: accesses.map(mapAccess),
      accessTotal,
      failurePreview: failurePreview.map(mapConversion),
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
           has_account, has_key
    FROM conversion_log
  `;
}

export function adminPageHTML(report: AdminReport | null, loginError = ""): string {
  if (!report) return layout("管理", loginForm(loginError), false);
  const query = report.query;
  const showConversions = query.view !== "access" && query.view !== "pages" && query.view !== "api";
  const showAccess = query.view !== "conversions";
  const markdown = [...report.conversions, ...report.failurePreview].some((row) => row.output_excerpt);
  return layout("统计", `
    <header class="top">
      <div>
        <p class="kicker">md.genedai.me</p>
        <h1>运营统计</h1>
        <p class="kicker">${esc(filterSummary(query))} · 记录保留 90 天</p>
      </div>
      <form method="post" action="/admin/logout"><button type="submit">退出</button></form>
    </header>
    ${report.error ? `<p class="banner">${esc(report.error)}</p>` : ""}
    ${filterForm(query)}
    <p class="note">页面访问只计首页、示例、文档、接入和门户。API 访问只计转换地址和产品接口。账号接口、探测、图标和后台在「其他请求」里，不进前两项。使用记录是逐条转换结果，带原文。小时汇总是更早的按小时计数，没有单条链接。账户额度只计带密钥的调用，和逐条使用记录不是同一套数字。记录内额度只从这次更新之后的新行累加，更早的行显示未记录。顶部数字是所选天数内的全部记录，累计额度除外。下面的图和列表跟随筛选。失败：结果不是 success，或状态码 ≥ 400。异常：成功，但正文为空、走了回退、超过 30 秒，或检测到付费墙。明细上线之前的转换没有保存正文。耗时、查询参数和过程字段只在这次更新之后的记录里。密钥、邮箱和口令仍然脱敏。</p>
    <section class="band">
      <h2>页面访问</h2>
      <div class="facts">
        ${fact("今日页面访问", report.pagesToday)}
        ${fact(`${query.days} 日页面访问`, report.pagesWindow)}
        ${fact("页面错误", report.pageErrors, report.pageErrors ? "bad" : "")}
      </div>
    </section>
    <section class="band">
      <h2>API 访问</h2>
      <div class="facts">
        ${fact("今日 API 访问", report.apiToday)}
        ${fact(`${query.days} 日 API 访问`, report.apiWindow)}
        ${fact("API 错误", report.apiErrors, report.apiErrors ? "bad" : "")}
      </div>
    </section>
    <section class="band">
      <h2>有效结果</h2>
      <p class="note">有效结果：成功，状态码低于 400，正文不少于 800 字，并且没有付费墙。</p>
      <div class="trios">
        <div class="facts trio">
          ${fact("今日 API 访问", report.apiToday)}
          ${fact("今日使用记录", report.conversionsToday)}
          ${fact("今日有效结果", report.usefulToday)}
        </div>
        <div class="facts trio">
          ${fact(`${query.days} 日 API 访问`, report.apiWindow)}
          ${fact(`${query.days} 日使用记录`, report.conversionsWindow)}
          ${fact(`${query.days} 日有效结果`, report.usefulWindow)}
        </div>
      </div>
    </section>
    <section class="band">
      <h2>其他请求</h2>
      <div class="facts">
        ${fact("账号接口", report.accountWindow)}
        ${fact("探测", report.probeWindow)}
        ${fact("资产", report.assetWindow)}
      </div>
    </section>
    <section class="band">
      <h2>使用数据</h2>
      <div class="facts">
        ${fact("今日使用记录", report.conversionsToday)}
        ${fact(`${query.days} 日使用记录`, report.conversionsWindow)}
        ${fact(`${query.days} 日成功率`, `${report.successRate}%`)}
        ${fact("失败", report.failures, "bad")}
        ${fact("异常", report.anomalies, "warn")}
        ${fact("匿名使用", report.anonUsage)}
        ${fact("账户使用", report.signedUsage)}
        ${fact("记录内额度", report.creditSum)}
        ${fact(`${query.days} 日账户额度`, `${report.ledgerRequests} 次 / ${report.ledgerCredits}`)}
        ${fact("累计账户额度", `${report.ledgerRequestsAll} 次 / ${report.ledgerCreditsAll}`)}
        ${fact(`${query.days} 日小时汇总`, report.aggregateRequests)}
        ${fact("账户 / 有效密钥", `${report.accounts} / ${report.keys}`)}
      </div>
    </section>
    <section class="grid">
      ${splitBars("使用记录", report.conversionDays)}
      ${table("使用结果", report.outcomes, outcomeTone)}
      ${table("身份", report.authTiers)}
      ${table("失败原因", report.errorCodes, () => "bad")}
      ${table("平台", report.platforms)}
      ${bars("页面访问", report.pageDays)}
      ${bars("API 访问", report.apiDays)}
      ${table("页面路径", report.pagePaths)}
      ${table("API 路径", report.apiPaths)}
      ${table("页面国家", report.countries)}
    </section>
    ${query.view !== "failures" ? failureSection(report) : ""}
    ${showConversions ? conversionSection(report) : ""}
    ${showAccess ? accessSection(report) : ""}
  `, markdown);
}

export function conversionDetailHTML(detail: ConversionDetail, back: string): string {
  if (!detail.row) {
    return layout("记录", `
      <p class="kicker"><a href="${esc(back)}">返回列表</a></p>
      <h1>转换记录</h1>
      <p class="banner">${esc(detail.error || "记录不存在。")}</p>
    `, false);
  }
  const row = detail.row;
  const flag = conversionFlag(row);
  const original = externalHref(row.target_url);
  const fields: Array<[string, string]> = [
    ["状态", flagLabel(flag)],
    ["结果", row.outcome],
    ["状态码", String(row.status_code)],
    ["时间", row.created_at],
    ["路由", row.route],
    ["平台", row.platform || "—"],
    ["方法", row.method_used || "—"],
    ["缓存", row.cache_status || "—"],
    ["耗时", `${row.duration_ms} ms`],
    ["格式", row.format || "—"],
    ["国家", row.country || "—"],
    ["身份", row.auth_tier || "—"],
    ["正文字数", row.output_chars == null ? "未记录" : String(row.output_chars)],
    ["付费墙", row.paywall ? "是" : "否"],
    ["浏览器渲染", row.browser_rendered ? "是" : "否"],
    ["回退", row.fallbacks || "—"],
    ["错误码", row.error_code || "—"],
    ["错误信息", row.error_message || "—"],
    ["主机", row.target_host || "—"],
    ["请求", row.request_id || "—"],
    ["引擎", row.engine_requested || "—"],
    ["额度", row.credit_cost == null ? "未记录" : String(row.credit_cost)],
    ["选择器", flagText(row.selector_present, "有", "无")],
    ["强制浏览器", flagText(row.force_browser, "是", "否")],
    ["跳过缓存", flagText(row.no_cache, "是", "否")],
    ["剩余额度档", row.quota_bucket || "—"],
    ["内容类型", row.content_type || "—"],
    ["耗时档", row.duration_bucket || "—"],
    ["体积档", row.output_size_bucket || "—"],
    ["客户端", row.ua_family || "—"],
    ["机房", row.colo || "—"],
    ["账户哈希", row.account_hash || "—"],
    ["密钥哈希", row.key_hash || "—"],
  ];
  return layout("转换记录", `
    <p class="kicker"><a href="${esc(back)}">返回列表</a></p>
    <header class="top">
      <div>
        <h1>转换记录</h1>
        <p class="tag ${flag}">${flagLabel(flag)}</p>
      </div>
    </header>
    <section class="scroll"><table>
      <tbody>${fields.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("")}</tbody>
    </table></section>
    <section class="links-block">
      <h2>原始链接</h2>
      ${original
        ? `<a class="url" href="${esc(original)}" target="_blank" rel="noreferrer">${esc(row.target_url)}</a>`
        : `<p class="url">${esc(row.target_url)}</p>`}
      <p class="links"><a href="${esc(readerPath(row.target_url))}">阅读页</a> · <a href="${esc(rawPath(row.target_url))}">Markdown</a></p>
    </section>
    <section>
      <h2>转换样式</h2>
      ${excerptBlock(row, true)}
    </section>
  `, Boolean(row.output_excerpt));
}

function failureSection(report: AdminReport): string {
  const href = adminHref(report.query, { view: "failures", page: 1, apage: 1 });
  return `<section>
    <div class="split-head">
      <h2>失败与异常</h2>
      <a href="${esc(href)}">查看全部</a>
    </div>
    ${report.failurePreview.length
      ? conversionTable(report.failurePreview, report.query)
      : `<p class="note">这个范围内没有失败或异常。</p>`}
  </section>`;
}

function conversionSection(report: AdminReport): string {
  const query = report.query;
  return `<section>
    <h2>转换记录</h2>
    ${conversionTable(report.conversions, query)}
    ${pager("转换", query.page, report.conversionTotal, (page) => adminHref(query, { page }))}
  </section>`;
}

function accessSection(report: AdminReport): string {
  const query = report.query;
  return `<section>
    <h2>请求记录</h2>
    <div class="scroll"><table>
      <thead><tr><th>时间</th><th>状态</th><th>类别</th><th>路由</th><th>方法</th><th>路径</th><th>耗时</th><th>来源</th><th>国家</th><th>客户端</th></tr></thead>
      <tbody>${report.accesses.map((row) => {
        const bad = row.status >= 400;
        const surface = SURFACE_LABEL[row.surface || ""] || row.surface || "—";
        const duration = row.duration_ms == null ? "未记录" : `${row.duration_ms} ms`;
        return `<tr class="${bad ? "fail" : ""}">
          <td title="${esc(row.created_at)}">${esc(when(row.created_at))}</td>
          <td>${bad ? `<b class="tag fail">失败</b> ` : ""}${row.status}</td>
          <td>${esc(surface)}</td>
          <td>${esc(row.route_name || "—")}${row.format ? ` · ${esc(row.format)}` : ""}</td>
          <td>${esc(row.method)}</td>
          <td class="url" title="${esc(row.query_redacted || "")}">${esc(row.path)}</td>
          <td>${esc(duration)}</td>
          <td>${esc(row.referrer_host)}</td>
          <td>${esc(row.country)}</td>
          <td>${esc(row.ua_family)}${row.auth_present && row.auth_present !== "none" ? ` · ${esc(row.auth_present)}` : ""}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="10">还没有请求记录。</td></tr>`}</tbody>
    </table></div>
    ${pager("请求", query.apage, report.accessTotal, (apage) => adminHref(query, { apage }))}
  </section>`;
}

function conversionTable(rows: ConversionRow[], query: AdminQuery): string {
  return `<div class="scroll"><table>
    <thead><tr><th>时间</th><th>状态</th><th>字段</th><th>原始链接</th><th>错误 / 样式</th></tr></thead>
    <tbody>${rows.map((row) => conversionTr(row, query)).join("") || `<tr><td colspan="5">还没有转换记录。</td></tr>`}</tbody>
  </table></div>`;
}

function conversionTr(row: ConversionRow, query: AdminQuery): string {
  const flag = conversionFlag(row);
  const original = externalHref(row.target_url);
  const detail = `/admin/conversion?id=${encodeURIComponent(row.id)}&back=${encodeURIComponent(adminHref(query))}`;
  const bits = [
    row.route,
    row.platform,
    row.method_used,
    row.cache_status,
    `${row.duration_ms} ms`,
    row.format,
    row.country,
    row.auth_tier,
    row.output_chars == null ? "" : `${row.output_chars} 字`,
    row.browser_rendered ? "浏览器" : "",
    row.paywall ? "付费墙" : "",
    row.fallbacks ? `回退 ${row.fallbacks}` : "",
  ].filter(Boolean);
  return `<tr class="${flag}">
    <td title="${esc(row.created_at)}">${esc(when(row.created_at))}</td>
    <td><b class="tag ${flag}">${flagLabel(flag)}</b><br>${esc(row.outcome)} ${row.status_code}</td>
    <td class="meta">${esc(bits.join(" · "))}</td>
    <td class="url">
      ${original
        ? `<a href="${esc(original)}" target="_blank" rel="noreferrer">${esc(row.target_url)}</a>`
        : esc(row.target_url)}
      <span class="links"><a href="${esc(readerPath(row.target_url))}">阅读页</a> · <a href="${esc(detail)}">转换样式</a></span>
    </td>
    <td>
      ${row.error_code || row.error_message ? `<p class="err">${esc([row.error_code, row.error_message].filter(Boolean).join(" · "))}</p>` : ""}
      ${excerptBlock(row, false)}
    </td>
  </tr>`;
}

function excerptBlock(row: ConversionRow, open: boolean): string {
  if (!row.output_excerpt) {
    if (row.output_chars == null) return `<p class="muted">正文未保存。打开阅读页可以重新转换。</p>`;
    if (row.output_chars === 0) return `<p class="muted">没有返回正文。</p>`;
    return `<p class="muted">正文未保存。</p>`;
  }
  const truncated = row.output_chars != null && row.output_chars > row.output_excerpt.length
    ? `<p class="muted">摘录 ${row.output_excerpt.length} / ${row.output_chars} 字。全文在阅读页。</p>`
    : "";
  if (open) {
    return `${truncated}
      <div class="preview">
        <div class="markdown-body md-out"></div>
        <textarea class="md-src" hidden readonly>${esc(row.output_excerpt)}</textarea>
      </div>
      <h2>Markdown</h2>
      <pre class="raw">${esc(row.output_excerpt)}</pre>`;
  }
  return `${truncated}
    <details>
      <summary>转换样式</summary>
      <div class="markdown-body md-out"></div>
      <textarea class="md-src" hidden readonly>${esc(row.output_excerpt)}</textarea>
      <pre class="raw">${esc(row.output_excerpt)}</pre>
    </details>`;
}

function filterForm(query: AdminQuery): string {
  return `<form class="filters" method="get" action="/admin">
    <label>天数 <select name="days">${DAY_CHOICES.map((days) => option(String(days), `${days} 天`, String(query.days))).join("")}</select></label>
    <label>记录 <select name="view">
      ${option("all", "全部", query.view)}
      ${option("failures", "失败与异常", query.view)}
      ${option("conversions", "只看使用数据", query.view)}
      ${option("pages", "只看页面访问", query.view)}
      ${option("api", "只看 API 访问", query.view)}
    </select></label>
    <label>结果 <select name="outcome">
      ${option("", "全部结果", query.outcome)}
      ${option("success", "success", query.outcome)}
      ${option("convert_error", "convert_error", query.outcome)}
      ${option("unexpected_error", "unexpected_error", query.outcome)}
    </select></label>
    <label>路由 <select name="route">
      ${option("", "全部路由", query.route)}
      ${option("convert", "convert", query.route)}
      ${option("stream", "stream", query.route)}
    </select></label>
    <label>数据 <select name="surface">
      ${option("", "全部数据", query.surface)}
      ${option("page", "页面访问", query.surface)}
      ${option("api", "API 访问", query.surface)}
      ${option("account", "账号接口", query.surface)}
      ${option("asset", "资产", query.surface)}
      ${option("probe", "探测", query.surface)}
      ${option("admin", "后台", query.surface)}
      ${option("other", "其他", query.surface)}
    </select></label>
    <label>平台 <input name="platform" value="${esc(query.platform)}" maxlength="40" placeholder="wechat"></label>
    <label>状态码 <input name="status" inputmode="numeric" maxlength="3" value="${query.status ?? ""}" placeholder="200"></label>
    <label>搜索 <input name="q" value="${esc(query.q)}" maxlength="80" placeholder="链接、路径、错误"></label>
    <button type="submit">筛选</button>
    <a class="clear" href="/admin">清除</a>
  </form>`;
}

function fact(label: string, value: string | number, tone = ""): string {
  return `<div class="${tone}"><b>${esc(String(value))}</b><span>${esc(label)}</span></div>`;
}

function splitBars(title: string, rows: DaySplit[]): string {
  const max = Math.max(1, ...rows.map((row) => row.ok + row.warn + row.bad));
  return `<div class="wide"><h2>${esc(title)}</h2>
    <p class="legend"><i class="swatch ok"></i>成功 <i class="swatch warn"></i>异常 <i class="swatch bad"></i>失败</p>
    ${rows.map((row) => {
      const total = row.ok + row.warn + row.bad;
      return `<div class="bar"><span>${esc(row.day.slice(5))}</span><span class="track"><i class="ok" style="width:${pct(row.ok, max)}%"></i><i class="warn" style="width:${pct(row.warn, max)}%"></i><i class="bad" style="width:${pct(row.bad, max)}%"></i></span><b>${total}</b></div>`;
    }).join("") || "<p>没有按日数据。</p>"}
  </div>`;
}

function bars(title: string, rows: DayRow[]): string {
  const max = Math.max(1, ...rows.map((row) => row.n));
  return `<div class="wide"><h2>${esc(title)}</h2>${rows.map((row) => `
    <div class="bar"><span>${esc(row.day.slice(5))}</span><span class="track"><i class="ok" style="width:${pct(row.n, max)}%"></i></span><b>${row.n}</b></div>
  `).join("") || "<p>没有按日数据。</p>"}</div>`;
}

function table(title: string, rows: PairRow[], tone?: (label: string) => string): string {
  return `<div><h2>${esc(title)}</h2><table>${rows.map((row) => {
    const cls = tone ? tone(row.label) : "";
    return `<tr><td class="${cls}">${esc(row.label || "—")}</td><td>${row.n}</td></tr>`;
  }).join("") || "<tr><td>没有数据</td><td>0</td></tr>"}</table></div>`;
}

function pager(label: string, page: number, total: number, hrefFor: (page: number) => string): string {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const prevTarget = page > pages ? pages : page - 1;
  const prev = page > 1 ? `<a href="${esc(hrefFor(prevTarget))}">上一页</a>` : "<span>上一页</span>";
  const next = page < pages ? `<a href="${esc(hrefFor(page + 1))}">下一页</a>` : "<span>下一页</span>";
  const first = page > 1 ? `<a href="${esc(hrefFor(1))}">第一页</a>` : "";
  return `<p class="pager">${first}${prev}<span>${esc(label)} ${total} 条 · 第 ${page} / ${pages} 页</span>${next}</p>`;
}

function option(value: string, label: string, current: string): string {
  return `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
}

function filterSummary(query: AdminQuery): string {
  const bits = [`${query.days} 天`];
  if (query.view === "failures") bits.push("失败与异常");
  if (query.view === "access") bits.push("只看请求");
  if (query.view === "conversions") bits.push("只看使用数据");
  if (query.view === "pages") bits.push("只看页面访问");
  if (query.view === "api") bits.push("只看 API 访问");
  if (query.outcome) bits.push(query.outcome);
  if (query.route) bits.push(query.route);
  if (query.platform) bits.push(query.platform);
  if (query.surface) bits.push(SURFACE_LABEL[query.surface] || query.surface);
  if (query.status != null) bits.push(String(query.status));
  if (query.q) bits.push(query.q);
  return bits.join(" · ");
}

function adminHref(query: AdminQuery, patch: Partial<AdminQuery> = {}): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.days !== 14) params.set("days", String(next.days));
  if (next.view !== "all") params.set("view", next.view);
  if (next.outcome) params.set("outcome", next.outcome);
  if (next.route) params.set("route", next.route);
  if (next.platform) params.set("platform", next.platform);
  if (next.surface) params.set("surface", next.surface);
  if (next.status != null) params.set("status", String(next.status));
  if (next.q) params.set("q", next.q);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.apage > 1) params.set("apage", String(next.apage));
  const search = params.toString();
  return search ? `/admin?${search}` : "/admin";
}

function outcomeTone(label: string): string {
  if (label === "success") return "ok";
  if (!label) return "";
  return "bad";
}

function flagLabel(flag: Flag): string {
  if (flag === "fail") return "失败";
  if (flag === "warn") return "异常";
  return "成功";
}

function when(iso: string): string {
  return iso.slice(5, 16).replace("T", " ");
}

function pct(part: number, max: number): number {
  if (part <= 0) return 0;
  return Math.max(2, Math.round((part / max) * 100));
}

function readerPath(targetUrl: string): string {
  return `/${encodeURIComponent(targetUrl)}`;
}

function rawPath(targetUrl: string): string {
  return `/${encodeURIComponent(targetUrl)}?raw=true`;
}

function externalHref(targetUrl: string): string {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function loginForm(error: string): string {
  return `
    <form class="login" method="post" action="/admin">
      <p class="kicker">md.genedai.me</p>
      <h1>运营统计</h1>
      <p>输入口令后查看页面访问、API 访问和使用数据。</p>
      ${error ? `<p class="banner">${esc(error)}</p>` : ""}
      <label for="password">口令</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">进入</button>
    </form>`;
}

function layout(title: string, body: string, markdown: boolean): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${esc(title)} — md.genedai.me</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONT_READING}" rel="stylesheet">
  <style>
    :root {
      color-scheme: light dark;
      --bg:#f3f4f6; --surface:#fff; --text:#1c2128; --muted:#5c6573; --line:#d0d5dc;
      --accent:#1b4f8a; --accent-on:#f4f6f8; --danger:#a3262c; --success:#1a6b45; --warning:#8a5a12;
      --text-primary:var(--text); --text-secondary:#3d4654; --accent-text:var(--accent); --border:var(--line);
      --bg-elevated:#e7eaee; --bg-surface:var(--surface);
      --font-reading:"Source Serif 4","Songti SC","Noto Serif SC",Georgia,serif;
      --font-body:"Source Sans 3","PingFang SC","Noto Sans SC",system-ui,sans-serif;
      --font-mono:"IBM Plex Mono",ui-monospace,monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg:#14171c; --surface:#1c2027; --text:#e7e9ed; --muted:#9aa3b2; --line:#3a4250;
        --accent:#c5d8f5; --accent-on:#12161c; --danger:#f0a8a8; --success:#8dcea9; --warning:#e6c48a;
        --text-secondary:#c5cbd4; --bg-elevated:#262b34;
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 15px/1.5 var(--font-body); background: var(--bg); color: var(--text); }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 64px; }
    h1 { font-size: 28px; letter-spacing: -0.03em; margin: 0 0 8px; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    a { color: var(--accent); }
    :focus { outline: none; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .kicker, .note, .muted, .meta { color: var(--muted); }
    .kicker { margin: 0; font-size: 13px; }
    .note { margin: 0 0 16px; font-size: 13px; }
    .top { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 16px; }
    .filters { display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: end; margin-bottom: 12px; }
    .filters label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 12px; }
    .band { margin: 0 0 18px; }
    .band > h2 { margin: 0 0 8px; color: var(--muted); font-size: 13px; font-weight: 650; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 12px; }
    .trios { display: grid; gap: 12px; }
    .facts.trio { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .facts div, .grid > div, .login { background: var(--surface); border: 1px solid var(--line); padding: 14px 16px; }
    .facts b { display: block; font-size: 22px; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
    .facts span { color: var(--muted); }
    .facts .bad b, .tag.fail, td.bad, .err { color: var(--danger); }
    .facts .warn b, .tag.warn, td.warn { color: var(--warning); }
    .tag.ok, td.ok { color: var(--success); }
    .grid { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 12px; margin-bottom: 28px; }
    .wide { grid-column: 1 / -1; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td, th { text-align: left; padding: 7px 8px 7px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
    .url { word-break: break-all; }
    .scroll { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); padding: 8px 14px; margin: 0 0 12px; }
    tr.fail { box-shadow: inset 3px 0 0 var(--danger); }
    tr.warn { box-shadow: inset 3px 0 0 var(--warning); }
    .tag { font-weight: 700; }
    .links, .links-block .links { display: block; margin-top: 4px; }
    .bar { display: grid; grid-template-columns: 46px 1fr 42px; gap: 8px; align-items: center; margin: 4px 0; font-variant-numeric: tabular-nums; font-size: 13px; }
    .track { display: flex; height: 8px; background: var(--line); }
    .track i { display: block; height: 8px; flex: none; }
    .track .ok, .swatch.ok { background: var(--success); }
    .track .warn, .swatch.warn { background: var(--warning); }
    .track .bad, .swatch.bad { background: var(--danger); }
    .legend { display: flex; gap: 8px; align-items: center; margin: 0 0 8px; color: var(--muted); font-size: 12px; }
    .swatch { display: inline-block; width: 10px; height: 8px; }
    .pager { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 0 0 28px; }
    .split-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    button, input, select { font: inherit; color: var(--text); background: var(--bg); }
    input, select { width: 100%; margin: 0; padding: 8px 10px; border: 1px solid var(--line); min-height: 36px; }
    .filters input[name="q"] { width: 220px; }
    button { min-height: 36px; padding: 6px 12px; border: 0; background: var(--accent); color: var(--accent-on); font-weight: 600; cursor: pointer; }
    .clear { min-height: 36px; display: inline-flex; align-items: center; }
    .login { max-width: 360px; }
    .banner { color: var(--danger); }
    .err { margin: 0 0 6px; }
    .raw, textarea.md-src { display: block; white-space: pre-wrap; max-height: 280px; overflow: auto; font-family: var(--font-mono); font-size: 12px; background: var(--bg); border: 1px solid var(--line); padding: 12px; }
    textarea.md-src { display: none; }
    .md-out { max-height: 420px; overflow: auto; border: 1px solid var(--line); padding: 12px 14px; background: var(--bg); margin-bottom: 8px; }
    details { margin-top: 6px; }
    summary { cursor: pointer; }
    ${PROSE_CSS}
    @media (max-width: 800px) {
      .grid { grid-template-columns: 1fr; }
      .filters { display: grid; grid-template-columns: 1fr 1fr; }
      .filters input[name="q"], .filters input, .filters select { width: 100%; }
    }
    @media (max-width: 720px) {
      .facts.trio { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body><main>${body}</main>
${markdown ? `<script src="https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js" integrity="sha384-H+hy9ULve6xfxRkWIh/YOtvDdpXgV2fmAGQkIDTxIgZwNoaoBal14Di2YTMR6MzR" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js" integrity="sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il2u7jvdCSWu" crossorigin="anonymous"></script>
<script>
function paintMarkdown(root) {
  var areas = root.querySelectorAll("textarea.md-src");
  for (var i = 0; i < areas.length; i++) {
    var src = areas[i];
    var out = src.parentElement && src.parentElement.querySelector(".md-out");
    if (!out || out.getAttribute("data-done")) continue;
    var text = src.value;
    try {
      if (window.DOMPurify && window.marked) out.innerHTML = DOMPurify.sanitize(marked.parse(text));
      else out.textContent = text;
    } catch (e) {
      out.textContent = text;
    }
    out.setAttribute("data-done", "1");
  }
}
document.addEventListener("toggle", function (event) {
  if (event.target && event.target.open) paintMarkdown(event.target);
}, true);
var preview = document.querySelector(".preview");
if (preview) paintMarkdown(preview);
</script>` : ""}
</body></html>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    countries: [],
    outcomes: [],
    platforms: [],
    errorCodes: [],
    conversions: [],
    conversionTotal: 0,
    accesses: [],
    accessTotal: 0,
    failurePreview: [],
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
    parts.push("(target_url LIKE ? ESCAPE '\\' OR target_host LIKE ? ESCAPE '\\' OR error_code LIKE ? ESCAPE '\\' OR error_message LIKE ? ESCAPE '\\' OR platform LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like, like);
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
    parts.push("(path LIKE ? ESCAPE '\\' OR referrer_host LIKE ? ESCAPE '\\')");
    binds.push(like, like);
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
  };
}

function nullableNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  return num(value);
}

function flagText(value: number | null | undefined, yes: string, no: string): string {
  if (value == null) return "未记录";
  return value ? yes : no;
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
