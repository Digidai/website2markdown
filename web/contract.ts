/**
 * Contract between the Worker (src/) and the HeroUI front end (web/).
 *
 * This file is plain TypeScript with no DOM or Worker types so both
 * tsconfigs can import it. The Worker reaches the renderers through the
 * `@web/server` alias (wrangler.toml / vitest.config.ts), typed by
 * src/web-server.d.ts against these signatures.
 */

export type Lang = "en" | "zh";
export type SitePage = "home" | "examples" | "docs" | "integration";
export type ReaderMethod =
  | "native"
  | "fallback"
  | "browser"
  | "proxy"
  | "jina"
  | "firecrawl"
  | "cloudflare";

export interface WebRenderers {
  landingPageHTML(host: string, lang?: Lang, page?: SitePage): string;
  portalPageHTML(): string;
  loadingPageHTML(
    host: string,
    targetUrl: string,
    extraStreamParams: string,
    rawRequestPath?: string,
  ): string;
  renderedPageHTML(
    host: string,
    content: string,
    sourceUrl: string,
    tokenCount: string,
    method: ReaderMethod,
    cached?: boolean,
    articleTitle?: string,
    rawRequestPath?: string,
  ): string;
  errorPageHTML(title: string, message: string, statusCode?: number): string;
  adminPageHTML(state: AdminState): string;
}

/** localStorage key used by HeroUI's useTheme hook. */
export const THEME_STORAGE_KEY = "heroui-theme";

/**
 * Runs in <head> before paint so the stored or system theme applies without
 * a flash. HeroUI reads `.dark` / `data-theme` on <html>.
 */
export const THEME_BOOT_SCRIPT =
  "(function(){try{var t=localStorage.getItem('heroui-theme')||'system';" +
  "if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';" +
  "var d=document.documentElement;d.classList.add(t);d.setAttribute('data-theme',t);}catch(e){}})();";

// ─── Admin ───────────────────────────────────────────────────

export type AdminView = "all" | "failures" | "access" | "conversions" | "pages" | "api";
export type AdminTab = "overview" | "channels" | "conversions" | "requests";
export type ConversionFlag = "fail" | "warn" | "ok";

export interface PairRow { label: string; n: number }
export interface DayRow { day: string; n: number }
export interface DaySplit { day: string; ok: number; warn: number; bad: number }

export interface AccessRow {
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
  /** Caller IP, full User-Agent, and network, kept 90 days. */
  client_ip?: string;
  user_agent?: string;
  asn?: number | null;
  as_org?: string;
  city?: string;
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
  /** Caller IP, full User-Agent, and network, kept 90 days. */
  client_ip?: string;
  user_agent?: string;
  asn?: number | null;
  as_org?: string;
  city?: string;
  account_id?: string;
  key_id?: string;
  content_type?: string;
  duration_bucket?: string;
  output_size_bucket?: string;
  selector_bucket?: string;
  has_account?: number | null;
  has_key?: number | null;
}

/** fail: not success or status ≥ 400. warn: success but empty, fallback, slow, or paywalled. */
export function conversionFlag(row: Pick<ConversionRow, "outcome" | "status_code" | "output_chars" | "fallbacks" | "duration_ms" | "paywall">): ConversionFlag {
  if (row.outcome !== "success" || row.status_code >= 400) return "fail";
  if (row.output_chars === 0 || Boolean(row.fallbacks) || row.duration_ms >= 30000 || row.paywall === 1) return "warn";
  return "ok";
}

export interface AdminQuery {
  days: number;
  view: AdminView;
  outcome: string;
  route: string;
  platform: string;
  surface: string;
  status: number | null;
  q: string;
  page: number;
  apage: number;
}

export interface ProviderPathHealth {
  path: string;
  attempts: number;
  failures: number;
  lastError: string;
  lastFailureAt: string;
}

export type IpRiskLevel = "normal" | "suspicious" | "abuse";

export interface SuspiciousIp {
  ip: string;
  asn: number | null;
  as_org: string;
  country: string;
  ua_family: string;
  requests: number;
  conversions: number;
  failures: number;
  hosts: number;
  top_host: string;
  score: number;
  level: IpRiskLevel;
  reasons: string[];
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
  /** Conversions per caller IP, labelled with the network name. */
  topIps: PairRow[];
  countries: PairRow[];
  outcomes: PairRow[];
  platforms: PairRow[];
  errorCodes: PairRow[];
  conversions: ConversionRow[];
  conversionTotal: number;
  accesses: AccessRow[];
  accessTotal: number;
  failurePreview: ConversionRow[];
  providerHealth: ProviderPathHealth[];
  /** Anonymous IPs scored over the last 24 hours. Observe-only. */
  suspiciousIps: SuspiciousIp[];
}

export interface ConversionDetail {
  error: string;
  row: ConversionRow | null;
}

export type ChannelStatus = "active" | "missing" | "disabled";

/** One fallback channel as shown on /admin, built from env presence only (never values). */
export interface AdminChannel {
  id: string;
  name: string;
  /** Where in the conversion chain the channel runs and who can reach it. */
  role: string;
  status: ChannelStatus;
  statusNote: string;
  env: { name: string; set: boolean; required: boolean }[];
  testable: boolean;
  health: ProviderPathHealth | null;
}

export interface ChannelTestResult {
  ok: boolean;
  ms: number;
  summary: string;
  details: string[];
}

export const ALERT_MIN_ATTEMPTS = 20;
export const ALERT_FAILURE_RATE = 0.5;

export type AdminState =
  | { mode: "login"; error?: string }
  | { mode: "dashboard"; report: AdminReport; channels: AdminChannel[]; tab: AdminTab }
  | { mode: "detail"; detail: ConversionDetail; back: string };
