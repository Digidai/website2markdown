import type { Env } from "../types";
import { classifyAccessPath } from "./classify";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SENSITIVE_PARAM = /token|key|secret|password|passwd|session|code|signature/i;
const SAFE_FORMATS = new Set(["markdown", "html", "text", "json"]);

export async function recordAccess(
  env: Env,
  request: Request,
  response: Response,
  durationMs = 0,
): Promise<void> {
  if (!env.AUTH_DB || request.method === "OPTIONS") return;
  try {
    const url = new URL(request.url);
    const classified = classifyAccessPath(url.pathname);
    const format = SAFE_FORMATS.has(url.searchParams.get("format") || "")
      ? url.searchParams.get("format") || ""
      : "";
    await env.AUTH_DB.prepare(`
      INSERT INTO access_events (
        id, created_at, kind, method, path, status, country, colo, ua_family, referrer_host,
        surface, route_name, auth_present, duration_ms, cache_status, format, query_redacted, request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      classified.surface,
      request.method.slice(0, 12),
      url.pathname.slice(0, 2000),
      response.status,
      countryOf(request),
      coloOf(request),
      userAgentFamily(request.headers.get("user-agent")),
      referrerHost(request),
      classified.surface,
      classified.route,
      authPresent(request),
      Math.max(0, Math.round(durationMs)),
      cacheStatusOf(response),
      format,
      sanitizedQuery(url),
      requestIdOf(request),
    ).run();
  } catch (error) {
    console.error("access event write failed:", error instanceof Error ? error.message : "unknown");
  }
}

const EXCERPT_CHARS = 8000;

export async function recordConversionLog(env: Env, input: {
  request: Request;
  route: string;
  targetUrl: string;
  platform: string;
  outcome: string;
  statusCode: number;
  methodUsed: string;
  cacheStatus: string;
  durationMs: number;
  format: string;
  authTier: string;
  errorCode: string;
  outputContent?: string;
  outputChars?: number | null;
  errorMessage?: string;
  fallbacks?: string[];
  paywall?: boolean;
  browserRendered?: boolean;
  requestId?: string;
  engineRequested?: string;
  creditCost?: number;
  selectorPresent?: boolean;
  forceBrowser?: boolean;
  noCache?: boolean;
  quotaBucket?: string;
  accountHash?: string;
  keyHash?: string;
  uaFamily?: string;
  colo?: string;
  contentType?: string;
  durationBucket?: string;
  outputSizeBucket?: string;
  selectorBucket?: string;
  hasAccount?: boolean;
  hasKey?: boolean;
}): Promise<void> {
  if (!env.AUTH_DB) return;
  let host = "";
  try {
    host = new URL(input.targetUrl).hostname.slice(0, 180);
  } catch {
    host = "";
  }
  const outputChars = Number.isFinite(input.outputChars)
    ? Math.max(0, Math.round(input.outputChars as number))
    : (input.outputContent || "").length;
  try {
    await env.AUTH_DB.prepare(`
      INSERT INTO conversion_log (
        id, created_at, route, target_url, target_host, platform, outcome, status_code,
        method_used, cache_status, duration_ms, format, country, auth_tier, error_code,
        output_excerpt, output_chars, error_message, fallbacks, paywall, browser_rendered,
        request_id, engine_requested, credit_cost, selector_present, force_browser, no_cache,
        quota_bucket, account_hash, key_hash, ua_family, colo, content_type,
        duration_bucket, output_size_bucket, selector_bucket, has_account, has_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      input.route.slice(0, 40),
      safeUrl(input.targetUrl),
      host,
      input.platform.slice(0, 40),
      input.outcome.slice(0, 40),
      input.statusCode,
      input.methodUsed.slice(0, 60),
      input.cacheStatus.slice(0, 20),
      Math.max(0, Math.round(input.durationMs)),
      input.format.slice(0, 20),
      countryOf(input.request),
      input.authTier.slice(0, 20),
      input.errorCode.slice(0, 80),
      adminExcerpt(input.outputContent || ""),
      outputChars,
      adminExcerpt(input.errorMessage || "").slice(0, 400),
      fallbackText(input.fallbacks),
      input.paywall ? 1 : 0,
      input.browserRendered ? 1 : 0,
      (input.requestId || "").slice(0, 80),
      storedEngine(input.engineRequested || ""),
      Math.max(0, Math.round(input.creditCost || 0)),
      input.selectorPresent ? 1 : 0,
      input.forceBrowser ? 1 : 0,
      input.noCache ? 1 : 0,
      (input.quotaBucket || "").slice(0, 40),
      (input.accountHash || "").slice(0, 64),
      (input.keyHash || "").slice(0, 64),
      (input.uaFamily || userAgentFamily(input.request.headers.get("user-agent"))).slice(0, 20),
      (input.colo || coloOf(input.request)).slice(0, 8),
      (input.contentType || "").split(";")[0].trim().slice(0, 80),
      (input.durationBucket || "").slice(0, 20),
      (input.outputSizeBucket || "").slice(0, 20),
      (input.selectorBucket || "").slice(0, 20),
      input.hasAccount ? 1 : 0,
      input.hasKey ? 1 : 0,
    ).run();
  } catch (error) {
    console.error("conversion log write failed:", error instanceof Error ? error.message : "unknown");
  }
}

export async function cleanupAnalytics(env: Env): Promise<void> {
  if (!env.AUTH_DB) return;
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  for (const table of ["access_events", "conversion_log"]) {
    try {
      await env.AUTH_DB.prepare(`DELETE FROM ${table} WHERE created_at < ?`).bind(cutoff).run();
    } catch (error) {
      console.error("analytics cleanup failed:", error instanceof Error ? error.message : "unknown");
    }
  }
}

function userAgentFamily(userAgent: string | null): string {
  const ua = (userAgent || "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("curl/")) return "curl";
  if (ua.includes("python")) return "python";
  if (ua.includes("bot") || ua.includes("crawler") || ua.includes("spider")) return "bot";
  if (ua.includes("mozilla/") || ua.includes("chrome/") || ua.includes("safari/")) return "browser";
  return "other";
}

function countryOf(request: Request): string {
  const cf = (request as Request & { cf?: { country?: string; colo?: string } }).cf;
  return (cf?.country || "").slice(0, 8);
}

function coloOf(request: Request): string {
  const cf = (request as Request & { cf?: { colo?: string } }).cf;
  return (cf?.colo || "").slice(0, 8);
}

function authPresent(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  const hasBearer = /^bearer\s+\S+/i.test(authorization.trim());
  const hasCookie = Boolean(request.headers.get("cookie"));
  if (hasBearer && hasCookie) return "both";
  if (hasBearer) return "bearer";
  if (hasCookie) return "cookie";
  return "none";
}

function cacheStatusOf(response: Response): string {
  const raw = response.headers.get("X-Cache-Status") || response.headers.get("X-Cache") || "";
  return raw.toLowerCase().replace(/[^a-z]/g, "").slice(0, 20);
}

function sanitizedQuery(url: URL): string {
  const params = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    params.append(secretShaped(key) ? "redacted" : key.slice(0, 80), redactQueryValue(key, value).slice(0, 300));
  }
  return params.toString().slice(0, 700);
}

function requestIdOf(request: Request): string {
  const incoming = request.headers.get("X-Request-ID") || request.headers.get("X-Request-Id") || "";
  const normalized = incoming.trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 80);
  if (normalized.length >= 8 && !SENSITIVE_PARAM.test(normalized) && !secretShaped(normalized)) return normalized;
  return crypto.randomUUID();
}

function referrerHost(request: Request): string {
  const raw = request.headers.get("referer");
  if (!raw) return "";
  try {
    return new URL(raw).hostname.slice(0, 180);
  } catch {
    return "";
  }
}

const AUTH_HEADER_RE = /\bAuthorization\s*:\s*(?:Bearer|Basic|Digest)\s+\S+/gi;
const COOKIE_HEADER_RE = /\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const SECRET_ASSIGNMENT_RE =
  /(["']?\b[A-Za-z0-9_.-]*(?:access_token|refresh_token|api_key|apikey|authorization|bearer|token|secret|password|passwd|session|cookie|csrf|xsrf|jwt|signature|sig|code)[A-Za-z0-9_.-]*\b["']?\s*[:=]\s*["']?)([^"'\s,;}<>]+)/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_TOKEN_RE = /\b(?:sk|pk|mk|fc|ghp|gho|ghu|ghs|xoxb|xoxp)[_-][A-Za-z0-9_-]{8,}\b/gi;

function storedEngine(value: string): string {
  const trimmed = value.trim().slice(0, 40);
  if (!trimmed) return "";
  if (secretShaped(trimmed)) return "custom";
  return trimmed;
}

function redactQueryValue(key: string, value: string): string {
  if (SENSITIVE_PARAM.test(key) || secretShaped(key)) return "redacted";
  return redactSecretFragments(value);
}

function redactSecretFragments(value: string): string {
  return value
    .replace(resetGlobal(LONG_TOKEN_RE), "redacted")
    .replace(resetGlobal(BEARER_RE), "redacted")
    .replace(resetGlobal(EMAIL_RE), "redacted");
}

function secretShaped(value: string): boolean {
  return resetGlobal(LONG_TOKEN_RE).test(value)
    || resetGlobal(BEARER_RE).test(value)
    || resetGlobal(EMAIL_RE).test(value);
}

function resetGlobal(pattern: RegExp): RegExp {
  pattern.lastIndex = 0;
  return pattern;
}
const URL_USERINFO_RE = /(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi;

function adminExcerpt(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .slice(0, 12000)
    .replace(URL_USERINFO_RE, "$1")
    .replace(AUTH_HEADER_RE, "Authorization: [redacted]")
    .replace(COOKIE_HEADER_RE, (match) => `${match.split(":")[0]}: [redacted]`)
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT_RE, "$1[redacted]")
    .replace(LONG_TOKEN_RE, "[redacted]")
    .replace(EMAIL_RE, "[email]")
    .trim()
    .slice(0, EXCERPT_CHARS);
}

function fallbackText(values: string[] | undefined): string {
  return (values || [])
    .map((value) => value.replace(/[^\w.+-]/g, "").slice(0, 40))
    .filter(Boolean)
    .slice(0, 8)
    .join(",");
}

function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    const redacted = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      redacted.append(secretShaped(key) ? "redacted" : key, redactQueryValue(key, value));
    }
    url.search = redacted.toString();
    return url.toString().slice(0, 500);
  } catch {
    return raw.replace(/[\r\n]/g, "").slice(0, 500);
  }
}
