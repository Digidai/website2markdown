import type { AuthContext, ConvertMethod, Env, OutputFormat } from "../types";
import type { ConvertResult } from "../handlers/convert";
import { logMetric } from "../runtime-state";
import { errorMessage } from "../utils";

export type ConversionRoute = "convert" | "stream";
export type ConversionOutcome =
  | "success"
  | "convert_error"
  | "unexpected_error";

export interface ConversionEventInput {
  request: Request;
  requestId: string;
  route: ConversionRoute;
  targetUrl: string;
  auth?: AuthContext | null;
  format?: OutputFormat | string;
  engineRequested?: string;
  outcome: ConversionOutcome;
  statusCode: number;
  latencyMs: number;
  result?: ConvertResult;
  debugOutputContent?: string;
  debugSourceContentType?: string;
  methodUsed?: ConvertMethod | string | null;
  fallbacks?: string[];
  browserRendered?: boolean;
  cacheHit?: boolean;
  paywallDetected?: boolean;
  outputChars?: number | null;
  selector?: string;
  forceBrowser?: boolean;
  noCache?: boolean;
  creditCost?: number;
  quotaRemaining?: number;
  errorTitle?: string;
  errorMessage?: string;
  debugTrace?: DebugTraceDecision;
}

export interface DebugTraceDecision {
  requested: boolean;
  allowed: boolean;
  source: "header" | "query" | "both" | "none";
  headerValue?: "accepted" | "not-authorized" | "not-available";
}

export interface SanitizedConversionEvent {
  request_id: string;
  route: ConversionRoute;
  outcome: ConversionOutcome;
  status_code: number;
  error_code: string;
  auth_tier: string;
  has_account: boolean;
  has_key: boolean;
  account_hash: string;
  key_hash: string;
  target_platform: string;
  target_host_hash: string;
  target_url_hash: string;
  user_agent_family: string;
  country: string;
  colo: string;
  format: string;
  engine_requested: string;
  method_used: string;
  cache_status: "hit" | "miss" | "bypass";
  browser_rendered: boolean;
  paywall_detected: boolean;
  fallbacks: string[];
  duration_ms: number;
  duration_bucket: string;
  output_size_bucket: string;
  selector_present: boolean;
  selector_length_bucket: string;
  force_browser: boolean;
  no_cache: boolean;
  credit_cost: number;
  quota_remaining_bucket: string;
}

const MAX_ERROR_MESSAGE_LENGTH = 240;
const MAX_REQUEST_ID_LENGTH = 80;
const MAX_FALLBACKS = 8;
const MAX_DEBUG_URL_LENGTH = 512;
const DEFAULT_DEBUG_TRACE_RETENTION_DAYS = 7;
const MAX_DEBUG_TRACE_RETENTION_DAYS = 14;
const DEFAULT_DEBUG_EXCERPT_CHARS = 2000;
const MAX_DEBUG_EXCERPT_CHARS = 5000;
const SAFE_ENGINE_VALUES = new Set(["native", "jina", "firecrawl", "cf"]);

const SECRET_KEY_RE =
  /\b(authorization|bearer|token|access_token|refresh_token|api_key|apikey|key|secret|password|passwd|session|cookie|code|signature)=([^&\s"'<>]+)/gi;
const SECRET_ASSIGNMENT_RE =
  /["']?\b([A-Za-z0-9_.-]*(?:access_token|refresh_token|api_key|apikey|authorization|bearer|token|secret|key|password|passwd|session|cookie|csrf|xsrf|jwt|sid|clearance|signature|sig|code)[A-Za-z0-9_.-]*)\b["']?\s*[:=]\s*["']?([^"'\s,;}<>]+)/gi;
const AUTH_HEADER_RE = /\bAuthorization\s*:\s*(?:Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/-]+=*/gi;
const COOKIE_HEADER_RE = /\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n<>]+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_KEY_RE =
  /^(access_token|auth|authorization|bearer|code|cookie|email|key|password|passwd|refresh_token|secret|session|signature|sig|token)$/i;
const SENSITIVE_PATH_WORD_RE =
  /(token|secret|key|auth|session|jwt|password|passwd|email|phone|login|signin|verify|reset|magic)/i;

export function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function resolveRequestId(request: Request): string {
  const incoming = request.headers.get("X-Request-ID") ||
    request.headers.get("X-Request-Id");
  if (incoming) {
    const trimmed = incoming.trim();
    if (containsSensitiveIdentifier(trimmed)) return createRequestId();
    const normalized = incoming
      .trim()
      .replace(/[^A-Za-z0-9._:-]/g, "")
      .slice(0, MAX_REQUEST_ID_LENGTH);
    if (containsSensitiveIdentifier(normalized)) return createRequestId();
    if (normalized.length >= 8) return normalized;
  }
  return createRequestId();
}

export function sanitizeErrorMessage(message: unknown): string {
  return redactSensitiveText(errorMessage(message))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export function buildDebugTraceDecision(
  request: Request,
  auth?: AuthContext | null,
  env?: Env,
): DebugTraceDecision {
  const headerRequested = parseBooleanFlag(request.headers.get("X-Debug-Trace"));
  let queryRequested = false;
  try {
    const url = new URL(request.url);
    queryRequested = parseBooleanFlag(url.searchParams.get("debug_trace"));
  } catch {
    queryRequested = false;
  }

  const requested = headerRequested || queryRequested;
  if (!requested) {
    return { requested: false, allowed: false, source: "none" };
  }
  const hasTraceStore = Boolean(env?.AUTH_DB);
  const hasAuthenticatedCaller = Boolean(auth && auth.tier !== "anonymous");
  const allowed = hasTraceStore && hasAuthenticatedCaller;
  return {
    requested: true,
    allowed,
    source: headerRequested && queryRequested ? "both" : headerRequested ? "header" : "query",
    headerValue: allowed ? "accepted" : hasTraceStore ? "not-authorized" : "not-available",
  };
}

export function debugTraceHeaders(
  decision?: DebugTraceDecision,
): Record<string, string> {
  if (!decision?.requested || !decision.headerValue) return {};
  return { "X-Debug-Trace": decision.headerValue };
}

export function userAgentFamily(userAgent: string | null): string {
  const ua = (userAgent || "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("curl/")) return "curl";
  if (ua.includes("python-requests") || ua.includes("python")) return "python";
  if (ua.includes("postmanruntime")) return "postman";
  if (ua.includes("axios") || ua.includes("undici") || ua.includes("node")) return "node";
  if (ua.includes("bot") || ua.includes("crawler") || ua.includes("spider")) return "bot";
  if (
    ua.includes("mozilla/") ||
    ua.includes("chrome/") ||
    ua.includes("safari/") ||
    ua.includes("firefox/") ||
    ua.includes("edg/")
  ) {
    return "browser";
  }
  return "other";
}

export function detectTargetPlatform(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === "mp.weixin.qq.com") return "wechat";
    if (host.endsWith("zhihu.com")) return "zhihu";
    if (host.endsWith("juejin.cn")) return "juejin";
    if (host.endsWith("xiaohongshu.com") || host.endsWith("xhslink.com")) return "xiaohongshu";
    if (host.endsWith("weibo.com")) return "weibo";
    if (host === "x.com" || host.endsWith(".x.com") || host.endsWith("twitter.com")) return "x";
    if (host.endsWith("github.com")) return "github";
    if (host.endsWith("linkedin.com")) return "linkedin";
    if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
    if (host.endsWith("medium.com")) return "medium";
    if (host.endsWith("substack.com")) return "substack";
    if (host.endsWith("notion.site") || host.endsWith("notion.so")) return "notion";
    if (host.endsWith("docs.google.com")) return "google_docs";
    if (parsed.pathname.toLowerCase().endsWith(".pdf")) return "pdf";
    return "generic";
  } catch {
    return "invalid_url";
  }
}

export async function buildSanitizedConversionEvent(
  env: Env,
  input: ConversionEventInput,
): Promise<SanitizedConversionEvent> {
  const cf = (input.request as Request & {
    cf?: { country?: string; colo?: string };
  }).cf;
  const diagnostics = input.result?.diagnostics;
  const auth = input.auth ?? null;
  const salt = env.ANALYTICS_SALT?.trim() || "";
  const parsedTarget = parseTarget(input.targetUrl);
  const durationMs = Math.max(0, Math.round(input.latencyMs));
  const outputChars = input.outputChars ?? (input.result ? input.result.content.length : null);
  const method = input.methodUsed ?? input.result?.method ?? "";
  const cacheHit = input.cacheHit ?? input.result?.cached ?? diagnostics?.cacheHit ?? false;
  const fallbacks = normalizeFallbacks(input.fallbacks ?? diagnostics?.fallbacks ?? []);

  return {
    request_id: input.requestId,
    route: input.route,
    outcome: input.outcome,
    status_code: input.statusCode,
    error_code: normalizeErrorCode(input.errorTitle, input.outcome, input.statusCode),
    auth_tier: auth?.tier ?? "anonymous",
    has_account: Boolean(auth?.accountId),
    has_key: Boolean(auth?.keyId),
    account_hash: salt && auth?.accountId ? await hmacSha256Hex(salt, auth.accountId) : "",
    key_hash: salt && auth?.keyId ? await hmacSha256Hex(salt, auth.keyId) : "",
    target_platform: detectTargetPlatform(input.targetUrl),
    target_host_hash: salt && parsedTarget.host ? await hmacSha256Hex(salt, parsedTarget.host) : "",
    target_url_hash: salt && parsedTarget.canonicalUrl
      ? await hmacSha256Hex(salt, parsedTarget.canonicalUrl)
      : "",
    user_agent_family: userAgentFamily(input.request.headers.get("User-Agent")),
    country: normalizeDimension(cf?.country ?? ""),
    colo: normalizeDimension(cf?.colo ?? ""),
    format: normalizeDimension(input.format ?? "markdown"),
    engine_requested: normalizeEngineRequested(input.engineRequested),
    method_used: normalizeDimension(method),
    cache_status: input.noCache ? "bypass" : cacheHit ? "hit" : "miss",
    browser_rendered: input.browserRendered ?? diagnostics?.browserRendered ?? false,
    paywall_detected: input.paywallDetected ?? diagnostics?.paywallDetected ?? false,
    fallbacks,
    duration_ms: durationMs,
    duration_bucket: durationBucket(durationMs),
    output_size_bucket: sizeBucket(outputChars),
    selector_present: Boolean(input.selector),
    selector_length_bucket: selectorBucket(input.selector),
    force_browser: Boolean(input.forceBrowser),
    no_cache: Boolean(input.noCache),
    credit_cost: Math.max(0, Math.floor(input.creditCost ?? 0)),
    quota_remaining_bucket: quotaBucket(input.quotaRemaining),
  };
}

export async function recordConversionEvent(
  env: Env,
  input: ConversionEventInput,
): Promise<void> {
  try {
    const event = await buildSanitizedConversionEvent(env, input);
    logMetric("conversion.event", { ...event });
    await upsertConversionAggregate(env, event);
    if (input.debugTrace?.allowed) {
      await insertConversionDebugTrace(env, input, event);
    }
  } catch (error) {
    console.error("Conversion event write failed:", sanitizeErrorMessage(error));
  }
}

export async function cleanupExpiredDebugTraces(env: Env): Promise<number> {
  if (!env.AUTH_DB) return 0;
  try {
    const result = await env.AUTH_DB.prepare(`
      DELETE FROM conversion_debug_traces
      WHERE expires_at <= ?
    `).bind(new Date().toISOString()).run();
    const meta = result.meta as { changes?: number } | undefined;
    return typeof meta?.changes === "number" ? meta.changes : 0;
  } catch (error) {
    console.error("Debug trace cleanup failed:", sanitizeErrorMessage(error));
    return 0;
  }
}

async function upsertConversionAggregate(
  env: Env,
  event: SanitizedConversionEvent,
): Promise<void> {
  if (!env.AUTH_DB) return;

  const now = new Date();
  const createdAt = now.toISOString();
  const date = createdAt.slice(0, 10);
  const hour = createdAt.slice(0, 13);

  await env.AUTH_DB.prepare(`
    INSERT INTO conversion_events_daily (
      date,
      hour,
      route,
      outcome,
      status_code,
      error_code,
      auth_tier,
      account_hash,
      key_hash,
      target_platform,
      target_host_hash,
      country,
      format,
      engine_requested,
      method_used,
      cache_status,
      browser_rendered,
      paywall_detected,
      duration_bucket,
      output_size_bucket,
      selector_present,
      selector_length_bucket,
      force_browser,
      no_cache,
      request_count,
      error_count,
      duration_ms_sum,
      credit_cost_sum,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT (
      date,
      hour,
      route,
      outcome,
      status_code,
      error_code,
      auth_tier,
      account_hash,
      key_hash,
      target_platform,
      target_host_hash,
      country,
      format,
      engine_requested,
      method_used,
      cache_status,
      browser_rendered,
      paywall_detected,
      duration_bucket,
      output_size_bucket,
      selector_present,
      selector_length_bucket,
      force_browser,
      no_cache
    ) DO UPDATE SET
      request_count = request_count + 1,
      error_count = error_count + excluded.error_count,
      duration_ms_sum = duration_ms_sum + excluded.duration_ms_sum,
      credit_cost_sum = credit_cost_sum + excluded.credit_cost_sum,
      updated_at = excluded.updated_at
  `).bind(
    date,
    hour,
    event.route,
    event.outcome,
    event.status_code,
    event.error_code,
    event.auth_tier,
    event.account_hash,
    event.key_hash,
    event.target_platform,
    event.target_host_hash,
    event.country,
    event.format,
    event.engine_requested,
    event.method_used,
    event.cache_status,
    boolToInt(event.browser_rendered),
    boolToInt(event.paywall_detected),
    event.duration_bucket,
    event.output_size_bucket,
    boolToInt(event.selector_present),
    event.selector_length_bucket,
    boolToInt(event.force_browser),
    boolToInt(event.no_cache),
    event.outcome === "success" ? 0 : 1,
    event.duration_ms,
    event.credit_cost,
    createdAt,
  ).run();
}

async function insertConversionDebugTrace(
  env: Env,
  input: ConversionEventInput,
  event: SanitizedConversionEvent,
): Promise<void> {
  if (!env.AUTH_DB) return;

  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + resolveDebugTraceRetentionDays(env) * 24 * 60 * 60 * 1000,
  ).toISOString();
  const debugContent = input.result?.content ?? input.debugOutputContent;
  const outputExcerpt = debugContent
    ? sanitizeDebugText(debugContent, resolveDebugExcerptLimit(env))
    : null;
  const errorShort = input.errorMessage
    ? sanitizeErrorMessage(input.errorMessage)
    : null;

  await env.AUTH_DB.prepare(`
    INSERT INTO conversion_debug_traces (
      id,
      created_at,
      expires_at,
      request_id,
      route,
      outcome,
      status_code,
      error_code,
      auth_tier,
      account_hash,
      key_hash,
      target_platform,
      target_url_hash,
      target_url_redacted,
      user_agent_family,
      format,
      engine_requested,
      method_used,
      cache_status,
      browser_rendered,
      paywall_detected,
      fallbacks,
      source_content_type,
      selector_present,
      selector_length_bucket,
      force_browser,
      no_cache,
      output_chars,
      output_excerpt,
      error_message_short,
      duration_ms,
      trace_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    createRequestId(),
    createdAt,
    expiresAt,
    event.request_id,
    event.route,
    event.outcome,
    event.status_code,
    event.error_code,
    event.auth_tier,
    event.account_hash,
    event.key_hash,
    event.target_platform,
    event.target_url_hash,
    buildDebugTargetUrl(input.targetUrl),
    event.user_agent_family,
    event.format,
    event.engine_requested,
    event.method_used,
    event.cache_status,
    boolToInt(event.browser_rendered),
    boolToInt(event.paywall_detected),
    JSON.stringify(event.fallbacks),
    input.result?.sourceContentType ?? input.debugSourceContentType ?? null,
    boolToInt(event.selector_present),
    event.selector_length_bucket,
    boolToInt(event.force_browser),
    boolToInt(event.no_cache),
    input.outputChars ?? (debugContent ? debugContent.length : null),
    outputExcerpt,
    errorShort,
    event.duration_ms,
    input.debugTrace?.source ?? "unknown",
  ).run();
}

function parseTarget(targetUrl: string): { host: string; canonicalUrl: string } {
  try {
    const parsed = new URL(targetUrl);
    parsed.hash = "";
    parsed.search = "";
    return {
      host: parsed.hostname.toLowerCase(),
      canonicalUrl: parsed.toString(),
    };
  } catch {
    return { host: "", canonicalUrl: "" };
  }
}

function buildDebugTargetUrl(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl);
    const params = new URLSearchParams();
    let paramIndex = 0;
    for (const [rawKey] of parsed.searchParams) {
      paramIndex += 1;
      const sensitiveKey = SENSITIVE_KEY_RE.test(rawKey) || containsSensitiveIdentifier(rawKey);
      params.append(
        sensitiveKey ? `redacted_${paramIndex}` : `param_${paramIndex}`,
        sensitiveKey ? "[redacted]" : "[value]",
      );
    }
    const query = params.toString();
    return clampString(
      `${parsed.protocol}//${redactHost(parsed.hostname)}${redactPath(parsed.pathname)}${query ? `?${query}` : ""}`,
      MAX_DEBUG_URL_LENGTH,
    );
  } catch {
    return "[invalid-url]";
  }
}

function normalizeFallbacks(fallbacks: string[]): string[] {
  return fallbacks
    .slice(0, MAX_FALLBACKS)
    .map((fallback) => normalizeDimension(fallback).slice(0, 80))
    .filter(Boolean);
}

function normalizeErrorCode(
  title: string | undefined,
  outcome: ConversionOutcome,
  statusCode: number,
): string {
  if (outcome === "success") return "";
  const source = title || outcome || `status_${statusCode}`;
  return normalizeDimension(source).replace(/-/g, "_").slice(0, 80) || "error";
}

function normalizeEngineRequested(value: string | undefined): string {
  const normalized = normalizeDimension(value ?? "");
  if (!normalized) return "";
  if (SAFE_ENGINE_VALUES.has(normalized)) return normalized;
  return "custom";
}

function sanitizeDebugText(value: string, maxLength: number): string {
  return redactSensitiveText(value)
    .replace(/\r/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeDimension(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_+.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function durationBucket(durationMs: number): string {
  if (durationMs < 250) return "lt_250ms";
  if (durationMs < 1000) return "250ms_1s";
  if (durationMs < 3000) return "1s_3s";
  if (durationMs < 10000) return "3s_10s";
  if (durationMs < 30000) return "10s_30s";
  return "gte_30s";
}

function sizeBucket(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size)) return "unknown";
  if (size < 1024) return "lt_1kb";
  if (size < 10 * 1024) return "1kb_10kb";
  if (size < 100 * 1024) return "10kb_100kb";
  if (size < 1024 * 1024) return "100kb_1mb";
  return "gte_1mb";
}

function selectorBucket(selector: string | undefined): string {
  if (!selector) return "none";
  if (selector.length <= 32) return "1_32";
  if (selector.length <= 128) return "33_128";
  return "129_plus";
}

function quotaBucket(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value <= 0) return "none";
  if (value <= 10) return "1_10";
  if (value <= 100) return "11_100";
  if (value <= 1000) return "101_1000";
  return "gt_1000";
}

function resolveDebugTraceRetentionDays(env: Env): number {
  const parsed = Number(env.DEBUG_TRACE_RETENTION_DAYS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DEBUG_TRACE_RETENTION_DAYS;
  return Math.min(Math.max(1, Math.floor(parsed)), MAX_DEBUG_TRACE_RETENTION_DAYS);
}

function resolveDebugExcerptLimit(env: Env): number {
  const parsed = Number(env.DEBUG_TRACE_MAX_CONTENT_CHARS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DEBUG_EXCERPT_CHARS;
  return Math.min(Math.max(256, Math.floor(parsed)), MAX_DEBUG_EXCERPT_CHARS);
}

function parseBooleanFlag(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function redactPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const extension = safePathExtension(segments[segments.length - 1]);
  return `/[path:${Math.min(segments.length, 99)}]${extension}`;
}

function redactHost(hostname: string): string {
  const host = hostname.toLowerCase();
  if (
    !host ||
    host.includes("@") ||
    SENSITIVE_PATH_WORD_RE.test(host) ||
    /^[a-f0-9:.]+$/i.test(host)
  ) {
    return "[host]";
  }
  const labels = host.split(".").filter(Boolean);
  if (labels.some((label) => label.length > 63 || /^[A-Za-z0-9_-]{24,}$/.test(label))) {
    return "[host]";
  }
  if (labels.length <= 2) return host;
  return `*.${labels.slice(-2).join(".")}`;
}

function safePathExtension(segment: string): string {
  const decoded = safeDecodeURIComponent(segment).toLowerCase();
  const match = decoded.match(/\.([a-z0-9]{1,8})$/);
  if (!match) return "";
  const extension = match[1];
  if (!/^(html?|md|txt|pdf|docx?|xlsx?|csv|json)$/.test(extension)) return "";
  return `.${extension}`;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function clampString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

function containsSensitiveIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    /https?:\/\//i.test(trimmed) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(trimmed) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(trimmed) ||
    /\b(?:sk|pk|mk|fc|ghp|gho|ghu|ghs|xoxb|xoxp)[_-][A-Za-z0-9_-]{8,}\b/i.test(trimmed) ||
    /\b(?:access_token|refresh_token|api_key|apikey|authorization|bearer|token|secret|password|passwd|session|cookie|csrf|xsrf|jwt|signature)\b/i.test(trimmed) ||
    /[A-Za-z0-9_-]{40,}/.test(trimmed)
  );
}

function redactSensitiveText(value: string): string {
  return value
    .replace(URL_RE, "[url]")
    .replace(AUTH_HEADER_RE, "Authorization: [redacted]")
    .replace(COOKIE_HEADER_RE, (match) => `${match.split(":")[0]}: [redacted]`)
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(SECRET_KEY_RE, "$1=[redacted]")
    .replace(SECRET_ASSIGNMENT_RE, "$1=[redacted]")
    .replace(EMAIL_RE, "[email]");
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

async function hmacSha256Hex(salt: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
