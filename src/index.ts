import type {
  ConvertMethod,
  Env,
  ExtractionErrorCode,
  ExtractionOptions,
  ExtractionRequestItem,
  ExtractionSchema,
  ExtractionStrategyType,
  OutputFormat,
} from "./types";
import {
  MAX_RESPONSE_BYTES,
  MAX_SELECTOR_LENGTH,
  CORS_HEADERS,
  WECHAT_UA,
  MOBILE_UA,
  DESKTOP_UA,
  VALID_FORMATS,
  BROWSER_CONCURRENCY,
  BROWSER_TIMEOUT,
  IMAGE_MAX_BYTES,
  RATE_LIMIT_WINDOW_SECONDS,
  RATE_LIMIT_CONVERT_PER_WINDOW,
  RATE_LIMIT_STREAM_PER_WINDOW,
  RATE_LIMIT_BATCH_PER_WINDOW,
} from "./config";
import {
  isSafeUrl,
  isValidUrl,
  needsBrowserRendering,
  extractTargetUrl,
  buildRawRequestPath,
  escapeHtml,
  fetchWithSafeRedirects,
} from "./security";
import { htmlToMarkdown, htmlToText, proxyImageUrls } from "./converter";
import {
  extractWithStrategy,
  ExtractionStrategyError,
} from "./extraction/strategies";
import {
  runBfsDeepCrawl,
  runBestFirstDeepCrawl,
  type DeepCrawlNode,
  type DeepCrawlOptions,
  type DeepCrawlStateSnapshot,
} from "./deepcrawl/bfs";
import {
  FilterChain,
  createContentTypeFilter,
  createDomainFilter,
  createUrlPatternFilter,
} from "./deepcrawl/filters";
import {
  CompositeUrlScorer,
  KeywordUrlScorer,
} from "./deepcrawl/scorers";
import {
  buildJobRecord,
  jobIdempotencyKey,
  jobStorageKey,
  validateJobCreatePayload,
} from "./dispatcher/model";
import { runTasksWithControls } from "./dispatcher/runner";
import type { JobRecord, JobTaskRecord } from "./dispatcher/model";
import {
  fetchWithBrowser,
  alwaysNeedsBrowser,
  getAdapter,
  getBrowserCapacityStats,
} from "./browser";
import { getCached, setCache, getImage } from "./cache";
import {
  parseProxyUrl,
  parseProxyPool,
  fetchViaProxy,
  fetchViaProxyPool,
} from "./proxy";
import {
  applyPaywallHeaders,
  extractJsonLdArticle,
  removePaywallElements,
  looksPaywalled,
  getPaywallRule,
  fetchWaybackSnapshot,
  fetchArchiveToday,
  extractAmpLink,
  stripAmpAccessControls,
  setPaywallRulesFromJson,
  getPaywallRuleStats,
} from "./paywall";
import {
  buildOperationalMetricsSnapshot,
  recordConversionLatency,
  recordDeepCrawlRun,
  recordJobCreated,
  recordJobRun,
} from "./observability/metrics";
import { errorMessage } from "./utils";
import { landingPageHTML } from "./templates/landing";
import { renderedPageHTML } from "./templates/rendered";
import { loadingPageHTML } from "./templates/loading";
import { errorPageHTML } from "./templates/error";

const BATCH_BODY_MAX_BYTES = 100_000;
const EXTRACT_BODY_MAX_BYTES = 1_000_000;
const JOBS_BODY_MAX_BYTES = 200_000;
const DEEPCRAWL_BODY_MAX_BYTES = 200_000;
const IDEMPOTENCY_TTL_SECONDS = 86_400;
const MAX_EXTRACT_BATCH_ITEMS = 10;
const MAX_DEEPCRAWL_DEPTH = 6;
const MAX_DEEPCRAWL_PAGES = 200;
const MAX_DEEPCRAWL_LIST_ITEMS = 100;
const MAX_DEEPCRAWL_KEYWORDS = 32;
const DEEPCRAWL_DEFAULT_CHECKPOINT_EVERY = 5;
const DEEPCRAWL_DEFAULT_CHECKPOINT_TTL_SECONDS = 86_400 * 7;
const DEEPCRAWL_CHECKPOINT_KEY_PREFIX = "deepcrawl:v1:";
const VALID_EXTRACTION_STRATEGIES = new Set<ExtractionStrategyType>([
  "css",
  "xpath",
  "regex",
]);
const LANDING_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src https://fonts.googleapis.com https://fonts.gstatic.com; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const ERROR_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";
const LOADING_CSP =
  "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; " +
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
  "font-src https://fonts.gstatic.com; connect-src 'self'; img-src * data:; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

type RateLimitRoute = "convert" | "stream" | "batch";

interface RuntimeCounters {
  requestsTotal: number;
  conversionsTotal: number;
  conversionFailures: number;
  streamRequests: number;
  batchRequests: number;
  cacheHits: number;
  browserRenderCalls: number;
  paywallDetections: number;
  paywallFallbacks: number;
  rateLimited: number;
  jobsCreated: number;
  jobRuns: number;
  jobRetryAttempts: number;
  deepCrawlRuns: number;
}

interface RateLimitDecision {
  exceeded: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface ConvertDiagnostics {
  cacheHit: boolean;
  browserRendered: boolean;
  paywallDetected: boolean;
  fallbacks: string[];
}

const runtimeStartedAt = Date.now();
const runtimeCounters: RuntimeCounters = {
  requestsTotal: 0,
  conversionsTotal: 0,
  conversionFailures: 0,
  streamRequests: 0,
  batchRequests: 0,
  cacheHits: 0,
  browserRenderCalls: 0,
  paywallDetections: 0,
  paywallFallbacks: 0,
  rateLimited: 0,
  jobsCreated: 0,
  jobRuns: 0,
  jobRetryAttempts: 0,
  deepCrawlRuns: 0,
};
const localRateCounters = new Map<string, { count: number; expiresAt: number }>();
const PAYWALL_RULES_REFRESH_MS = 60_000;
let lastPaywallRulesSyncAt = 0;
let lastPaywallRulesSource = "default";
let lastPaywallRulesRaw = "";

function incrementCounter(name: keyof RuntimeCounters, delta: number = 1): void {
  runtimeCounters[name] += delta;
}

function logMetric(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...data,
  }));
}

function isDocumentNavigationRequest(request: Request, acceptHeader: string): boolean {
  return request.method === "GET" &&
    (request.headers.get("Sec-Fetch-Dest") === "document" ||
      (!acceptHeader.includes("text/markdown") &&
        !acceptHeader.includes("application/json") &&
        acceptHeader.includes("text/html")));
}

function getClientIp(request: Request): string | null {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim() || null;
  }
  return null;
}

function limitForRoute(route: RateLimitRoute): number {
  switch (route) {
    case "batch":
      return RATE_LIMIT_BATCH_PER_WINDOW;
    case "stream":
      return RATE_LIMIT_STREAM_PER_WINDOW;
    default:
      return RATE_LIMIT_CONVERT_PER_WINDOW;
  }
}

function consumeLocalRateCounter(
  route: RateLimitRoute,
  ip: string,
  nowMs: number,
): number {
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const bucket = Math.floor(nowMs / windowMs);
  const key = `rl:${route}:${ip}:${bucket}`;
  const existing = localRateCounters.get(key);
  const expiresAt = (bucket + 1) * windowMs + 5_000;
  const nextCount = (existing?.count || 0) + 1;
  localRateCounters.set(key, { count: nextCount, expiresAt });

  if (localRateCounters.size > 2000) {
    for (const [counterKey, entry] of localRateCounters) {
      if (entry.expiresAt <= nowMs) {
        localRateCounters.delete(counterKey);
      }
    }
  }
  return nextCount;
}

async function consumeDistributedRateCounter(
  env: Env,
  route: RateLimitRoute,
  ip: string,
  nowMs: number,
): Promise<number | null> {
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const bucket = Math.floor(nowMs / windowMs);
  const key = `rl:v1:${route}:${ip}:${bucket}`;
  try {
    const raw = await env.CACHE_KV.get(key, "text");
    const current = Math.max(0, parseInt(raw || "0", 10) || 0);
    const next = current + 1;
    await env.CACHE_KV.put(key, String(next), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 5,
    });
    return next;
  } catch {
    return null;
  }
}

async function consumeRateLimit(
  request: Request,
  env: Env,
  route: RateLimitRoute,
): Promise<RateLimitDecision | null> {
  const ip = getClientIp(request);
  if (!ip) return null;

  const nowMs = Date.now();
  const limit = limitForRoute(route);
  const localCount = consumeLocalRateCounter(route, ip, nowMs);
  const distributedCount = await consumeDistributedRateCounter(env, route, ip, nowMs);
  const count = distributedCount ? Math.max(localCount, distributedCount) : localCount;

  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((((Math.floor(nowMs / windowMs) + 1) * windowMs) - nowMs) / 1000),
  );
  return {
    exceeded: count > limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

function withExtraHeaders(
  response: Response,
  headersToMerge: Record<string, string>,
): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(headersToMerge)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "Retry-After": String(decision.retryAfterSeconds),
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(decision.retryAfterSeconds),
  };
}

function rateLimitedResponse(
  route: RateLimitRoute,
  decision: RateLimitDecision,
  asJson: boolean,
): Response {
  incrementCounter("rateLimited");
  logMetric("rate_limit.blocked", {
    route,
    limit: decision.limit,
    retry_after_s: decision.retryAfterSeconds,
  });
  const message = `Too many requests. Retry in ${decision.retryAfterSeconds} seconds.`;
  const base = errorResponse("Rate Limited", message, 429, asJson);
  return withExtraHeaders(base, rateLimitHeaders(decision));
}

async function isAuthorizedByToken(
  request: Request,
  expectedToken: string,
  queryToken?: string | null,
): Promise<boolean> {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ") && await timingSafeEqual(auth.slice(7), expectedToken)) {
    return true;
  }
  if (queryToken && await timingSafeEqual(queryToken, expectedToken)) {
    return true;
  }
  return false;
}

async function syncPaywallRules(env: Env): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastPaywallRulesSyncAt < PAYWALL_RULES_REFRESH_MS) {
    return;
  }

  let source = "default";
  let raw = "";

  if (env.PAYWALL_RULES_JSON && env.PAYWALL_RULES_JSON.trim()) {
    source = "env:PAYWALL_RULES_JSON";
    raw = env.PAYWALL_RULES_JSON;
  }
  if (env.PAYWALL_RULES_KV_KEY) {
    try {
      const kvRules = await env.CACHE_KV.get(env.PAYWALL_RULES_KV_KEY, "text");
      if (kvRules && kvRules.trim()) {
        source = `kv:${env.PAYWALL_RULES_KV_KEY}`;
        raw = kvRules;
      }
    } catch (error) {
      console.warn("Failed to refresh paywall rules from KV:", errorMessage(error));
    }
  }

  if (source !== lastPaywallRulesSource || raw !== lastPaywallRulesRaw) {
    setPaywallRulesFromJson(raw, source);
    lastPaywallRulesSource = source;
    lastPaywallRulesRaw = raw;
    const stats = getPaywallRuleStats();
    logMetric("paywall.rules_updated", {
      source: stats.source,
      rules: stats.ruleCount,
      domains: stats.domainCount,
    });
  }
  lastPaywallRulesSyncAt = nowMs;
}

/** Convert native markdown to a minimal safe HTML response. */
function markdownToBasicHtml(markdown: string): string {
  return `<pre>${escapeHtml(markdown)}</pre>`;
}

/** Check if the request prefers JSON error responses. */
function wantsJsonError(request: Request): boolean {
  const accept = request.headers.get("Accept") || "";
  return (
    accept.includes("application/json") ||
    accept.includes("text/markdown")
  );
}

/** Timing-safe string comparison using HMAC. Does NOT leak length. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const fixedKey = encoder.encode("timing-safe-compare-key");
  const key = await crypto.subtle.importKey(
    "raw",
    fixedKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig1 = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(a)));
  const sig2 = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(b)));
  let diff = sig1.length ^ sig2.length;
  for (let i = 0; i < sig1.length; i++) diff |= sig1[i] ^ sig2[i];
  return diff === 0;
}

/**
 * Return error as JSON or HTML depending on caller.
 * `message` should be a raw string — it will be escaped in the HTML template.
 */
function errorResponse(
  title: string,
  message: string,
  status: number,
  asJson: boolean,
): Response {
  if (asJson) {
    return Response.json(
      { error: title, message, status },
      { status, headers: CORS_HEADERS },
    );
  }
  return new Response(
    errorPageHTML(title, message, status),
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": ERROR_CSP,
        "X-Frame-Options": "DENY",
        ...CORS_HEADERS,
      },
    },
  );
}

// ─── ConvertError ────────────────────────────────────────────

class ConvertError extends Error {
  constructor(
    public readonly title: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

class RequestAbortedError extends Error {
  constructor() {
    super("Request was aborted.");
  }
}

class SseStreamClosedError extends Error {
  constructor(message: string = "SSE stream is closed.") {
    super(message);
  }
}

class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RequestAbortedError();
  }
}

function isTimeoutLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  const lower = errorMessage(error).toLowerCase();
  return lower.includes("timeout") || lower.includes("timed out");
}

function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    },
  };
}

async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLargeMessage: string,
  abortSignal?: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      throwIfAborted(abortSignal);
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new BodyTooLargeError(tooLargeMessage);
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0];

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function readTextWithLimit(
  response: Response,
  maxBytes: number,
  tooLargeMessage: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const bytes = await readBodyWithLimit(
    response.body,
    maxBytes,
    tooLargeMessage,
    abortSignal,
  );
  return new TextDecoder().decode(bytes);
}

function asFetchConvertError(error: unknown): ConvertError {
  const message = errorMessage(error);
  if (message.includes("SSRF")) {
    return new ConvertError(
      "Blocked",
      "Redirect target points to an internal or private address.",
      403,
    );
  }
  if (isTimeoutLikeError(error)) {
    return new ConvertError(
      "Fetch Timeout",
      `Fetching the target URL timed out after ${Math.round(BROWSER_TIMEOUT / 1000)} seconds.`,
      504,
    );
  }
  return new ConvertError(
    "Fetch Failed",
    message || "Failed to fetch the target URL.",
    502,
  );
}

function isLikelyChallengeHtml(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    (lower.includes("passport.weibo") ||
      lower.includes("qrcode_login") ||
      lower.includes("login_type")) ||
    (lower.includes("verify") &&
      lower.includes("captcha") &&
      body.length < 5000) ||
    lower.includes("cf-browser-verification") ||
    lower.includes("cf-challenge") ||
    (lower.includes("just a moment") &&
      lower.includes("cloudflare") &&
      body.length < 10000)
  );
}

// ─── Core conversion function ────────────────────────────────

interface ConvertResult {
  content: string;
  title: string;
  method: ConvertMethod;
  tokenCount: string;
  cached: boolean;
  diagnostics: ConvertDiagnostics;
}

async function convertUrl(
  targetUrl: string,
  env: Env,
  host: string,
  format: OutputFormat,
  selector: string | undefined,
  forceBrowser: boolean,
  noCache: boolean,
  onProgress?: (step: string, label: string) => void | Promise<void>,
  abortSignal?: AbortSignal,
): Promise<ConvertResult> {
  const progress = onProgress || (() => {});
  throwIfAborted(abortSignal);
  const fallbacks = new Set<string>();
  let browserRendered = false;
  let paywallDetected = false;

  // 1. Cache
  if (!noCache) {
    const cached = await getCached(env, targetUrl, format, selector);
    if (cached) {
      return {
        content: cached.content,
        title: cached.title || "",
        method: cached.method as ConvertMethod,
        tokenCount: "",
        cached: true,
        diagnostics: {
          cacheHit: true,
          browserRendered: false,
          paywallDetected: false,
          fallbacks: [],
        },
      };
    }
  }

  // 2. Fetch & parse
  let finalHtml = "";
  let method: ConvertMethod = "readability+turndown";
  let resolvedUrl = targetUrl;

  // Apply adapter URL transformation (e.g. reddit.com → old.reddit.com)
  const fetchAdapter = getAdapter(targetUrl);
  if (fetchAdapter.transformUrl) {
    targetUrl = fetchAdapter.transformUrl(targetUrl);
    resolvedUrl = targetUrl;
  }

  // Direct fetch path — adapter handles fetching entirely (e.g. API-based sites)
  if (fetchAdapter.fetchDirect) {
    throwIfAborted(abortSignal);
    await progress("fetch", "Fetching via API");
    try {
      const directHtml = await fetchAdapter.fetchDirect(targetUrl);
      if (directHtml) {
        finalHtml = directHtml;
        method = "readability+turndown";
        fallbacks.add("direct_fetch");
      }
    } catch (e) {
      console.error("fetchDirect failed, falling through:", errorMessage(e));
    }
  }

  // Early browser path — skip redundant static fetch for sites that always need browser
  if (!finalHtml && alwaysNeedsBrowser(targetUrl)) {
    throwIfAborted(abortSignal);
    await progress("browser", "Rendering with browser");
    try {
      finalHtml = await fetchWithBrowser(targetUrl, env, host, abortSignal);
      method = "browser+readability+turndown";
      browserRendered = true;
      fallbacks.add("always_browser");
    } catch (error) {
      if (abortSignal?.aborted) throw new RequestAbortedError();
      const msg = error instanceof Error ? error.message : "";

      // Hybrid proxy path: browser solved JS challenge but datacenter IP
      // was blocked. Retry the fetch through ISP proxy with browser cookies.
      if (msg.startsWith("PROXY_RETRY:") || msg.includes("PROXY_RETRY:")) {
        const pooledConfigs = env.PROXY_POOL ? parseProxyPool(env.PROXY_POOL) : [];
        const fallbackProxy = env.PROXY_URL ? parseProxyUrl(env.PROXY_URL) : null;
        if (pooledConfigs.length === 0 && fallbackProxy) {
          pooledConfigs.push(fallbackProxy);
        }
        if (pooledConfigs.length === 0) {
          throw new ConvertError(
            "Fetch Failed",
            "Site requires proxy access. Please configure PROXY_URL or PROXY_POOL.",
            502,
          );
        }
        // Extract cookies from the error message
        const cookieStart = msg.indexOf("PROXY_RETRY:") + "PROXY_RETRY:".length;
        const cookies = msg.slice(cookieStart).replace(/^(Browser rendering failed: )+/, "");

        throwIfAborted(abortSignal);
        await progress("fetch", "Retrying via proxy");
        try {
          const headerVariants = [
            {
              name: "desktop",
              headers: {
                "User-Agent": DESKTOP_UA,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Accept-Encoding": "identity",
                "Cookie": cookies,
              },
            },
            {
              name: "mobile",
              headers: {
                "User-Agent": MOBILE_UA,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Accept-Encoding": "identity",
                "Cookie": cookies,
              },
            },
          ];

          const usePool = !!(env.PROXY_POOL && pooledConfigs.length > 0);
          if (usePool) {
            const proxyResult = await fetchViaProxyPool(
              targetUrl,
              pooledConfigs,
              headerVariants,
              {
                timeoutMs: 25_000,
                signal: abortSignal,
                acceptResult: (candidate) =>
                  candidate.status >= 200 &&
                  candidate.status < 400 &&
                  candidate.body.length > 1000 &&
                  !isLikelyChallengeHtml(candidate.body),
              },
            );
            finalHtml = proxyResult.body;
            method = "browser+readability+turndown";
            browserRendered = true;
            fallbacks.add(`proxy_pool_${proxyResult.proxyIndex + 1}_${proxyResult.variant}`);
          } else {
            const proxyResult = await fetchViaProxy(
              targetUrl,
              pooledConfigs[0],
              headerVariants[0].headers,
              25_000,
              abortSignal,
            );
            if (
              proxyResult.status >= 200 &&
              proxyResult.status < 400 &&
              proxyResult.body.length > 1000 &&
              !isLikelyChallengeHtml(proxyResult.body)
            ) {
              finalHtml = proxyResult.body;
              method = "browser+readability+turndown";
              browserRendered = true;
              fallbacks.add("proxy_retry");
            } else {
              throw new Error(
                `Proxy fetch returned ${proxyResult.status}, body ${proxyResult.body.length} bytes`,
              );
            }
          }
        } catch (proxyError) {
          const proxyDetail = errorMessage(proxyError);
          console.error("Proxy fetch failed:", proxyDetail);
          throw new ConvertError(
            "Fetch Failed",
            `Proxy access failed: ${proxyDetail}`,
            502,
          );
        }
      } else {
        console.error("Browser rendering failed:", errorMessage(error));
        throw new ConvertError("Fetch Failed", "Browser rendering failed for this URL.", 502);
      }
    }
  } else if (!finalHtml) {
    // 3. Static fetch
    throwIfAborted(abortSignal);
    await progress("fetch", "Fetching page");
    const isWechat = targetUrl.includes("mp.weixin.qq.com");
    const fetchHeaders: Record<string, string> = {
      Accept: "text/markdown, text/html;q=0.9, */*;q=0.8",
      "User-Agent": isWechat
        ? WECHAT_UA
        : `${host}/1.0 (Markdown Converter)`,
    };
    if (isWechat) {
      fetchHeaders["Accept-Language"] = "zh-CN,zh;q=0.9,en;q=0.8";
      fetchHeaders["Referer"] = "https://mp.weixin.qq.com/";
    }

    // Apply paywall bypass headers for known paywalled domains
    applyPaywallHeaders(targetUrl, fetchHeaders);

    let response: Response;
    let cleanupFetchSignal = () => {};
    try {
      const { signal, cleanup } = createTimeoutSignal(BROWSER_TIMEOUT, abortSignal);
      cleanupFetchSignal = cleanup;
      const result = await fetchWithSafeRedirects(targetUrl, {
        headers: fetchHeaders,
        signal,
      });
      response = result.response;
      resolvedUrl = result.finalUrl;
    } catch (e) {
      if (abortSignal?.aborted) throw new RequestAbortedError();
      throw asFetchConvertError(e);
    } finally {
      cleanupFetchSignal();
    }

    const staticFailed = !response.ok;

    if (staticFailed && !forceBrowser) {
      // For known paywalled sites returning 403/401, try archive sources
      if (getPaywallRule(resolvedUrl)) {
        paywallDetected = true;
        const waybackHtml = await fetchWaybackSnapshot(resolvedUrl, abortSignal);
        if (waybackHtml && waybackHtml.length > 1000) {
          finalHtml = waybackHtml;
          fallbacks.add("wayback_pre_fetch");
        } else {
          const archiveHtml = await fetchArchiveToday(resolvedUrl, abortSignal);
          if (archiveHtml && archiveHtml.length > 1000) {
            finalHtml = archiveHtml;
            fallbacks.add("archive_pre_fetch");
          } else {
            throw new ConvertError(
              "Fetch Failed",
              `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`,
              502,
            );
          }
        }
      } else {
        throw new ConvertError(
          "Fetch Failed",
          `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`,
          502,
        );
      }
    }

    if (staticFailed && !finalHtml) {
      // forceBrowser was true — go straight to browser rendering
      throwIfAborted(abortSignal);
      await progress("browser", "Rendering with browser");
      try {
        finalHtml = await fetchWithBrowser(targetUrl, env, host, abortSignal);
        method = "browser+readability+turndown";
        browserRendered = true;
        fallbacks.add("browser_after_static_failure");
      } catch (error) {
        if (abortSignal?.aborted) throw new RequestAbortedError();
        console.error("Browser fallback failed:", errorMessage(error));
        throw new ConvertError(
          "Fetch Failed",
          `Static fetch returned ${response.status} and browser rendering also failed.`,
          502,
        );
      }
    } else {
      // 4. Validate content type
      throwIfAborted(abortSignal);
      await progress("analyze", "Analyzing content");
      const contentType = response.headers.get("Content-Type") || "";
      const isTextContent = contentType.includes("text/html") ||
        contentType.includes("application/xhtml") ||
        contentType.includes("text/markdown") ||
        contentType.includes("text/plain");
      if (!isTextContent && !contentType.includes("text/")) {
        throw new ConvertError(
          "Unsupported Content",
          `This URL returned non-text content (${contentType}). Only HTML and text pages can be converted to Markdown.`,
          415,
        );
      }
      if (
        contentType.includes("text/css") ||
        contentType.includes("text/javascript") ||
        contentType.includes("text/csv")
      ) {
        throw new ConvertError(
          "Unsupported Content",
          `This URL returned ${contentType} which cannot be converted to Markdown.`,
          415,
        );
      }

      // 5. Size check
      const contentLength = parseInt(response.headers.get("Content-Length") || "0", 10);
      if (contentLength > MAX_RESPONSE_BYTES) {
        throw new ConvertError("Content Too Large", "The target page exceeds the 5 MB size limit.", 413);
      }

      let body = "";
      try {
        body = await readTextWithLimit(
          response,
          MAX_RESPONSE_BYTES,
          "The target page exceeds the 5 MB size limit.",
          abortSignal,
        );
      } catch (e) {
        if (e instanceof BodyTooLargeError) {
          throw new ConvertError("Content Too Large", e.message, 413);
        }
        throw e;
      }

      const tokenCount = response.headers.get("x-markdown-tokens") || "";
      const isMarkdown = contentType.includes("text/markdown");

      // 6. Native markdown
      if (isMarkdown) {
        let nativeOutput: string;
        switch (format) {
          case "json":
            nativeOutput = JSON.stringify({
              url: resolvedUrl, title: "", markdown: body, method: "native",
              timestamp: new Date().toISOString(),
            });
            break;
          case "html":
            nativeOutput = markdownToBasicHtml(body);
            break;
          default:
            nativeOutput = body;
        }

        if (!noCache) {
          throwIfAborted(abortSignal);
          await setCache(env, targetUrl, format, { content: nativeOutput, method: "native", title: "" }, selector);
        }

        return {
          content: nativeOutput,
          title: "",
          method: "native",
          tokenCount,
          cached: false,
          diagnostics: {
            cacheHit: false,
            browserRendered,
            paywallDetected,
            fallbacks: [...fallbacks],
          },
        };
      }

      // 7. Check browser rendering need
      finalHtml = body;
      if (forceBrowser || needsBrowserRendering(body, resolvedUrl)) {
        throwIfAborted(abortSignal);
        await progress("browser", "Rendering with browser");
        try {
          finalHtml = await fetchWithBrowser(targetUrl, env, host, abortSignal);
          method = "browser+readability+turndown";
          browserRendered = true;
          fallbacks.add(forceBrowser ? "browser_forced" : "browser_auto");
        } catch (e) {
          console.error("Browser rendering failed, using static HTML:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  // 7. Strip <script> and <style> tags — they are never useful for conversion
  //    and can account for 70-80% of page size (e.g. WeChat pages are ~4MB scripts).
  throwIfAborted(abortSignal);
  finalHtml = finalHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  if (new TextEncoder().encode(finalHtml).byteLength > MAX_RESPONSE_BYTES) {
    throw new ConvertError("Content Too Large", "The page content exceeds the 5 MB size limit.", 413);
  }

  // 8. Apply adapter post-processing before conversion
  const siteAdapter = getAdapter(targetUrl);
  if (siteAdapter.postProcess) {
    finalHtml = siteAdapter.postProcess(finalHtml);
  }

  // 8.5. Paywall bypass: remove paywall elements and extract JSON-LD fallback
  finalHtml = removePaywallElements(finalHtml);

  // 8.6. Try AMP version if content looks paywalled
  const htmlLooksPaywalled = looksPaywalled(finalHtml);
  if (htmlLooksPaywalled && getPaywallRule(resolvedUrl)) {
    paywallDetected = true;
    const ampUrl = extractAmpLink(finalHtml);
    if (ampUrl) {
      try {
        const ampHeaders: Record<string, string> = { Accept: "text/html" };
        applyPaywallHeaders(resolvedUrl, ampHeaders);
        const { signal: ampSignal, cleanup: ampCleanup } = createTimeoutSignal(15_000, abortSignal);
        try {
          const { response: ampResp } = await fetchWithSafeRedirects(ampUrl, {
            headers: ampHeaders,
            signal: ampSignal,
          });
          if (ampResp.ok) {
            const ampHtml = stripAmpAccessControls(await ampResp.text());
            if (!looksPaywalled(ampHtml) && ampHtml.length > finalHtml.length / 2) {
              finalHtml = ampHtml;
              fallbacks.add("amp");
            }
          }
        } finally {
          ampCleanup();
        }
      } catch {
        /* AMP fetch failed, continue with original */
      }
    }
  }

  const jsonLdHtml = extractJsonLdArticle(finalHtml);

  // 9. Convert
  throwIfAborted(abortSignal);
  await progress("convert", "Converting to Markdown");
  const conversionUrl = resolvedUrl || targetUrl;
  let { markdown, title: extractedTitle, contentHtml } = htmlToMarkdown(
    finalHtml,
    conversionUrl,
    selector,
  );
  let output: string;

  // If Readability produced very little content but JSON-LD has more, use JSON-LD
  const stillLooksPaywalled = looksPaywalled(finalHtml);
  if (stillLooksPaywalled) {
    paywallDetected = true;
  }
  if (jsonLdHtml && markdown.length < 500 && stillLooksPaywalled) {
    const jsonLdResult = htmlToMarkdown(jsonLdHtml, conversionUrl, selector);
    if (jsonLdResult.markdown.length > markdown.length) {
      markdown = jsonLdResult.markdown;
      extractedTitle = jsonLdResult.title || extractedTitle;
      contentHtml = jsonLdResult.contentHtml;
      fallbacks.add("jsonld");
    }
  }

  // If still looks paywalled after JSON-LD, try archive sources
  if (markdown.length < 500 && stillLooksPaywalled && getPaywallRule(conversionUrl)) {
    // Try Wayback Machine
    const waybackHtml = await fetchWaybackSnapshot(conversionUrl, abortSignal);
    if (waybackHtml) {
      const wbResult = htmlToMarkdown(
        removePaywallElements(waybackHtml),
        conversionUrl,
        selector,
      );
      if (wbResult.markdown.length > markdown.length) {
        markdown = wbResult.markdown;
        extractedTitle = wbResult.title || extractedTitle;
        contentHtml = wbResult.contentHtml;
        fallbacks.add("wayback_post_convert");
      }
    } else {
      console.debug("Wayback fallback unavailable", { url: targetUrl });
    }

    // If still short, try Archive.today
    if (markdown.length < 500) {
      const archiveHtml = await fetchArchiveToday(conversionUrl, abortSignal);
      if (archiveHtml) {
        const arResult = htmlToMarkdown(
          removePaywallElements(archiveHtml),
          conversionUrl,
          selector,
        );
        if (arResult.markdown.length > markdown.length) {
          markdown = arResult.markdown;
          extractedTitle = arResult.title || extractedTitle;
          contentHtml = arResult.contentHtml;
          fallbacks.add("archive_post_convert");
        }
      } else {
        console.debug("Archive.today fallback unavailable", { url: targetUrl });
      }
    }
  }

  switch (format) {
    case "html":
      output = contentHtml;
      break;
    case "text":
      output = htmlToText(finalHtml, conversionUrl, selector);
      break;
    case "json":
      output = JSON.stringify({
        url: conversionUrl, title: extractedTitle, markdown, method,
        timestamp: new Date().toISOString(),
      });
      break;
    default:
      output = markdown;
  }

  // 9. WeChat image proxy
  if (
    format === "markdown" &&
    (conversionUrl.includes("mmbiz.qpic.cn") || conversionUrl.includes("mp.weixin.qq.com"))
  ) {
    output = proxyImageUrls(output, host);
  }

  // 10. Cache
  if (!noCache) {
    throwIfAborted(abortSignal);
    await setCache(env, targetUrl, format, { content: output, method, title: extractedTitle }, selector);
  }

  return {
    content: output,
    title: extractedTitle,
    method,
    tokenCount: "",
    cached: false,
    diagnostics: {
      cacheHit: false,
      browserRendered,
      paywallDetected,
      fallbacks: [...fallbacks],
    },
  };
}

async function convertUrlWithMetrics(
  ...args: Parameters<typeof convertUrl>
): Promise<ConvertResult> {
  const startedAt = Date.now();
  try {
    return await convertUrl(...args);
  } finally {
    recordConversionLatency(Math.max(0, Date.now() - startedAt));
  }
}

// ─── SSE streaming ──────────────────────────────────────────

function sseResponse(
  handler: (
    send: (event: string, data: any) => Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>,
  requestSignal?: AbortSignal,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const streamAbort = new AbortController();
  let writerOpen = true;

  const abortStream = () => {
    if (!streamAbort.signal.aborted) {
      streamAbort.abort();
    }
  };

  const onRequestAbort = () => abortStream();
  if (requestSignal) {
    if (requestSignal.aborted) {
      abortStream();
    } else {
      requestSignal.addEventListener("abort", onRequestAbort, { once: true });
    }
  }

  writer.closed
    .catch(() => {
      writerOpen = false;
      abortStream();
    })
    .finally(() => {
      writerOpen = false;
    });

  const send = async (event: string, data: any) => {
    if (!writerOpen || streamAbort.signal.aborted) {
      throw new SseStreamClosedError();
    }
    try {
      await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch (error) {
      writerOpen = false;
      abortStream();
      throw new SseStreamClosedError(errorMessage(error));
    }
  };

  handler(send, streamAbort.signal)
    .catch((err) => {
      if (
        err instanceof SseStreamClosedError ||
        err instanceof RequestAbortedError ||
        streamAbort.signal.aborted
      ) {
        return;
      }
      console.error("SSE handler error:", errorMessage(err));
    })
    .finally(() => {
      if (requestSignal) {
        requestSignal.removeEventListener("abort", onRequestAbort);
      }
      abortStream();
      if (writerOpen) {
        writerOpen = false;
        writer.close().catch(() => {});
      }
    });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      ...CORS_HEADERS,
    },
  });
}

function handleStream(
  request: Request,
  env: Env,
  host: string,
  url: URL,
): Response {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl || !isValidUrl(targetUrl)) {
    return sseResponse(async (send) => {
      await send("fail", { title: "Invalid URL", message: "Please provide a valid HTTP(S) URL.", status: 400 });
    }, request.signal);
  }
  if (!isSafeUrl(targetUrl)) {
    return sseResponse(async (send) => {
      await send("fail", { title: "Blocked", message: "Requests to internal or private addresses are not allowed.", status: 403 });
    }, request.signal);
  }

  const selector = url.searchParams.get("selector") || undefined;
  if (selector && selector.length > MAX_SELECTOR_LENGTH) {
    return sseResponse(async (send) => {
      await send("fail", {
        title: "Invalid Selector",
        message: `selector is too long (max ${MAX_SELECTOR_LENGTH} characters).`,
        status: 400,
      });
    }, request.signal);
  }
  const forceBrowser = url.searchParams.get("force_browser") === "true";
  const noCache = url.searchParams.get("no_cache") === "true";

  return sseResponse(async (send, streamSignal) => {
    try {
      const result = await convertUrlWithMetrics(
        targetUrl, env, host, "markdown", selector, forceBrowser, noCache,
        async (step, label) => { await send("step", { id: step, label }); },
        streamSignal,
      );
      await send("done", {
        rawUrl: buildRawRequestPath(targetUrl),
        title: result.title,
        method: result.method,
        tokenCount: result.tokenCount,
        cached: result.cached,
        fallbacks: result.diagnostics.fallbacks,
      });
      incrementCounter("conversionsTotal");
      if (result.cached || result.diagnostics.cacheHit) incrementCounter("cacheHits");
      if (result.diagnostics.browserRendered || result.method === "browser+readability+turndown") {
        incrementCounter("browserRenderCalls");
      }
      if (result.diagnostics.paywallDetected) incrementCounter("paywallDetections");
      if (result.diagnostics.fallbacks.length > 0) {
        incrementCounter("paywallFallbacks", result.diagnostics.fallbacks.length);
      }
      logMetric("stream.convert_done", {
        method: result.method,
        cached: result.cached,
        fallbacks: result.diagnostics.fallbacks,
      });
    } catch (err) {
      if (
        err instanceof RequestAbortedError ||
        err instanceof SseStreamClosedError ||
        streamSignal.aborted
      ) {
        return;
      }
      if (err instanceof ConvertError) {
        incrementCounter("conversionFailures");
        await send("fail", { title: err.title, message: err.message, status: err.statusCode });
      } else {
        console.error("Stream conversion error:", err);
        incrementCounter("conversionFailures");
        await send("fail", { title: "Error", message: "Failed to process the URL. Please try again later.", status: 500 });
      }
    }
  }, request.signal);
}

// ─── Main handler ────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.host;
    const path = url.pathname;
    const jsonErrors = wantsJsonError(request);
    incrementCounter("requestsTotal");

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    await syncPaywallRules(env);

    // POST /api/batch
    if (request.method === "POST" && path === "/api/batch") {
      const decision = await consumeRateLimit(request, env, "batch");
      if (decision?.exceeded) {
        return rateLimitedResponse("batch", decision, true);
      }
      return handleBatch(request, env, host);
    }

    // POST /api/extract
    if (request.method === "POST" && path === "/api/extract") {
      const decision = await consumeRateLimit(request, env, "convert");
      if (decision?.exceeded) {
        return rateLimitedResponse("convert", decision, true);
      }
      return handleExtract(request, env, host);
    }

    // POST /api/deepcrawl
    if (request.method === "POST" && path === "/api/deepcrawl") {
      const decision = await consumeRateLimit(request, env, "batch");
      if (decision?.exceeded) {
        return rateLimitedResponse("batch", decision, true);
      }
      return handleDeepCrawl(request, env, host);
    }

    // POST /api/jobs
    if (request.method === "POST" && path === "/api/jobs") {
      const decision = await consumeRateLimit(request, env, "batch");
      if (decision?.exceeded) {
        return rateLimitedResponse("batch", decision, true);
      }
      return handleJobs(request, env);
    }

    const jobPath = parseJobPath(path);
    if (jobPath) {
      const expectsGet = jobPath.action === "status" || jobPath.action === "stream";
      const expectsPost = jobPath.action === "run";
      if ((expectsGet && request.method !== "GET") || (expectsPost && request.method !== "POST")) {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
      }
      const decision = await consumeRateLimit(
        request,
        env,
        jobPath.action === "stream" ? "stream" : "batch",
      );
      if (decision?.exceeded) {
        return rateLimitedResponse(jobPath.action === "stream" ? "stream" : "batch", decision, true);
      }
      if (jobPath.action === "stream") {
        return handleGetJobStream(request, env, jobPath.id);
      }
      if (jobPath.action === "run") {
        return handleRunJob(request, env, host, jobPath.id);
      }
      return handleGetJob(request, env, jobPath.id);
    }

    // Only allow GET and HEAD for other routes
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    // Avoid expensive side effects on HEAD requests.
    if (request.method === "HEAD") {
      if (path === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }
      if (path === "/api/health") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...CORS_HEADERS,
          },
        });
      }
      return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    // Favicon
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Health check
    if (path === "/api/health") {
      const browserStats = getBrowserCapacityStats();
      return Response.json({
        status: "ok",
        service: host,
        uptime_seconds: Math.max(0, Math.floor((Date.now() - runtimeStartedAt) / 1000)),
        metrics: {
          ...runtimeCounters,
          operational: buildOperationalMetricsSnapshot(
            runtimeStartedAt,
            runtimeCounters,
            browserStats,
          ),
        },
        browser: browserStats,
        paywall: getPaywallRuleStats(),
      }, { headers: CORS_HEADERS });
    }

    // Dynamic OG image
    if (path === "/api/og") {
      return handleOgImage(url, host);
    }

    // SSE stream endpoint (GET only — HEAD would trigger conversion with no body)
    if (path === "/api/stream") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
      }
      if (env.PUBLIC_API_TOKEN) {
        const authorized = await isAuthorizedByToken(
          request,
          env.PUBLIC_API_TOKEN,
          url.searchParams.get("token"),
        );
        if (!authorized) {
          return Response.json(
            { error: "Unauthorized", message: "Valid token required for /api/stream" },
            { status: 401, headers: CORS_HEADERS },
          );
        }
      }
      const decision = await consumeRateLimit(request, env, "stream");
      if (decision?.exceeded) {
        return rateLimitedResponse("stream", decision, true);
      }
      incrementCounter("streamRequests");
      return handleStream(request, env, host, url);
    }

    // R2 image proxy
    if (path.startsWith("/r2img/")) {
      const key = path.slice(7);
      if (!key || !key.startsWith("images/") || key.includes("..")) {
        return new Response("Not Found", { status: 404 });
      }
      try {
        const img = await getImage(env, key);
        if (img) {
          if (img.contentType.toLowerCase().includes("svg")) {
            return new Response("Forbidden", { status: 403 });
          }
          return new Response(img.data as any, {
            headers: {
              "Content-Type": img.contentType,
              "Cache-Control": "public, max-age=86400",
              "Access-Control-Allow-Origin": "*",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'",
            },
          });
        }
      } catch {
        // Fall through to 404
      }
      return new Response("Not Found", { status: 404 });
    }

    // Legacy image proxy
    if (path.startsWith("/img/")) {
      let imgUrl: string;
      try {
        imgUrl = decodeURIComponent(path.slice(5));
      } catch {
        return new Response("Invalid image URL encoding", { status: 400 });
      }
      if (!isValidUrl(imgUrl) || !isSafeUrl(imgUrl)) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const { response: imgResp } = await fetchWithSafeRedirects(imgUrl, {
          headers: {
            Referer: new URL(imgUrl).origin + "/",
            "User-Agent": WECHAT_UA,
          },
          signal: AbortSignal.timeout(BROWSER_TIMEOUT),
        });

        if (!imgResp.ok) {
          return new Response("Image fetch failed", { status: 502 });
        }
        const imgContentType = imgResp.headers.get("Content-Type") || "";
        const imgContentTypeLower = imgContentType.toLowerCase();
        if (!imgContentTypeLower.startsWith("image/")) {
          return new Response("Not an image", { status: 403 });
        }
        if (imgContentTypeLower.startsWith("image/svg+xml")) {
          return new Response("SVG images are not allowed", { status: 403 });
        }
        const imgContentLength = parseInt(imgResp.headers.get("Content-Length") || "0", 10);
        if (imgContentLength > IMAGE_MAX_BYTES) {
          return new Response("Image too large", { status: 413 });
        }

        let imgBytes: Uint8Array;
        try {
          imgBytes = await readBodyWithLimit(
            imgResp.body,
            IMAGE_MAX_BYTES,
            "Image too large",
          );
        } catch (e) {
          if (e instanceof BodyTooLargeError) {
            return new Response("Image too large", { status: 413 });
          }
          throw e;
        }

        const headers = new Headers();
        headers.set("Content-Type", imgContentType);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "public, max-age=86400");
        headers.set("Content-Security-Policy", "default-src 'none'");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(imgBytes, { status: 200, headers });
      } catch (e) {
        if (e instanceof Error && e.message.includes("SSRF")) {
          return new Response("Redirect target blocked", { status: 403 });
        }
        return new Response("Image fetch failed", { status: 502 });
      }
    }

    // Extract target URL from path
    const targetUrl = extractTargetUrl(path, url.search);

    // No target URL → landing page
    if (!targetUrl) {
      return new Response(landingPageHTML(host), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": LANDING_CSP,
          "X-Frame-Options": "DENY",
        },
      });
    }

    // Validate target URL
    if (!isValidUrl(targetUrl)) {
      return errorResponse(
        "Invalid URL",
        "The URL is not valid. Please provide a valid HTTP(S) URL.",
        400,
        jsonErrors,
      );
    }

    // SSRF protection
    if (!isSafeUrl(targetUrl)) {
      return errorResponse(
        "Blocked",
        "Requests to internal or private addresses are not allowed.",
        403,
        jsonErrors,
      );
    }

    try {
      // Parse request parameters
      const acceptHeader = request.headers.get("Accept") || "";
      const isDocumentNav = isDocumentNavigationRequest(request, acceptHeader);
      const wantsRaw =
        url.searchParams.get("raw") === "true" ||
        acceptHeader.split(",").some((part) => part.trim().split(";")[0] === "text/markdown");

      const rawFormat = url.searchParams.get("format") || "markdown";
      if (!VALID_FORMATS.has(rawFormat)) {
        return errorResponse(
          "Invalid Format",
          `Unknown format "${rawFormat}". Valid values: markdown, html, text, json.`,
          400,
          jsonErrors,
        );
      }
      const format = rawFormat as OutputFormat;
      const selector = url.searchParams.get("selector") || undefined;
      if (selector && selector.length > MAX_SELECTOR_LENGTH) {
        return errorResponse(
          "Invalid Selector",
          `selector is too long (max ${MAX_SELECTOR_LENGTH} characters).`,
          400,
          jsonErrors,
        );
      }
      const forceBrowser = url.searchParams.get("force_browser") === "true";
      const noCache = url.searchParams.get("no_cache") === "true";
      const queryToken = url.searchParams.get("token");

      // Optional API auth for non-document requests.
      const isApiStyleRequest =
        !isDocumentNav ||
        wantsRaw ||
        format !== "markdown" ||
        acceptHeader.includes("application/json") ||
        acceptHeader.includes("text/markdown");
      if (env.PUBLIC_API_TOKEN && isApiStyleRequest) {
        const authorized = await isAuthorizedByToken(request, env.PUBLIC_API_TOKEN, queryToken);
        if (!authorized) {
          return errorResponse(
            "Unauthorized",
            "Valid token required for API access.",
            401,
            true,
          );
        }
      }

      const rateDecision = await consumeRateLimit(request, env, "convert");
      if (rateDecision?.exceeded) {
        return rateLimitedResponse("convert", rateDecision, jsonErrors);
      }

      // ── Browser document navigation → loading experience with SSE ──
      if (!wantsRaw && format === "markdown" && isDocumentNav) {
        // Check cache for instant display
        if (!noCache) {
          const cached = await getCached(env, targetUrl, "markdown", selector);
          if (cached) {
            incrementCounter("conversionsTotal");
            incrementCounter("cacheHits");
            logMetric("convert.cache_hit", {
              route: "document",
              method: cached.method,
            });
            return buildResponse(
              cached.content, targetUrl, host,
              cached.method as ConvertMethod, "markdown",
              false, "", true, cached.title,
              {
                cacheHit: true,
                browserRendered: cached.method === "browser+readability+turndown",
                paywallDetected: false,
                fallbacks: [],
              },
            );
          }
        }

        // Not cached → return loading page with SSE
        const streamParams = new URLSearchParams();
        if (selector) streamParams.set("selector", selector);
        if (forceBrowser) streamParams.set("force_browser", "true");
        if (noCache) streamParams.set("no_cache", "true");
        if (queryToken) streamParams.set("token", queryToken);
        const sp = streamParams.toString();

        return new Response(
          loadingPageHTML(host, targetUrl, sp ? "&" + sp : ""),
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": LOADING_CSP,
              "X-Frame-Options": "DENY",
              ...CORS_HEADERS,
            },
          },
        );
      }

      // ── Raw / API calls → synchronous conversion ──
      const result = await convertUrlWithMetrics(
        targetUrl, env, host, format, selector, forceBrowser, noCache,
      );

      incrementCounter("conversionsTotal");
      if (result.cached || result.diagnostics.cacheHit) incrementCounter("cacheHits");
      if (result.method === "browser+readability+turndown" || result.diagnostics.browserRendered) {
        incrementCounter("browserRenderCalls");
      }
      if (result.diagnostics.paywallDetected) incrementCounter("paywallDetections");
      if (result.diagnostics.fallbacks.length > 0) {
        incrementCounter("paywallFallbacks", result.diagnostics.fallbacks.length);
      }
      logMetric("convert.completed", {
        method: result.method,
        cached: result.cached,
        format,
        browser_rendered: result.diagnostics.browserRendered,
        paywall_detected: result.diagnostics.paywallDetected,
        fallbacks: result.diagnostics.fallbacks,
      });

      return buildResponse(
        result.content, targetUrl, host, result.method, format,
        wantsRaw, result.tokenCount, result.cached, result.title, result.diagnostics,
      );
    } catch (err: unknown) {
      if (err instanceof ConvertError) {
        incrementCounter("conversionFailures");
        logMetric("convert.failed", {
          title: err.title,
          status: err.statusCode,
        });
        return errorResponse(err.title, err.message, err.statusCode, jsonErrors);
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error("Conversion error:", { url: targetUrl, error: message });
      incrementCounter("conversionFailures");
      logMetric("convert.failed", {
        title: "Error",
        status: 500,
      });
      return errorResponse(
        "Error",
        "Failed to process the URL. Please try again later.",
        500,
        jsonErrors,
      );
    }
  },
};

// ─── Response builder ────────────────────────────────────────

function buildResponse(
  content: string,
  sourceUrl: string,
  host: string,
  method: ConvertMethod,
  format: OutputFormat,
  wantsRaw: boolean,
  tokenCount: string,
  cached: boolean,
  title: string = "",
  diagnostics?: ConvertDiagnostics,
): Response {
  const methodLabel =
    method === "browser+readability+turndown"
      ? "browser"
      : method === "native"
        ? "native"
        : "fallback";

  if (wantsRaw || format === "json" || format === "text" || format === "html") {
    const contentType =
      format === "json"
        ? "application/json; charset=utf-8"
        : format === "html"
          ? "text/html; charset=utf-8"
          : format === "text"
            ? "text/plain; charset=utf-8"
            : "text/markdown; charset=utf-8";

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "X-Source-URL": sourceUrl.replace(/[\r\n]/g, ""),
        "X-Markdown-Native": method === "native" ? "true" : "false",
        "X-Markdown-Method": method,
        "X-Cache-Status": cached ? "HIT" : "MISS",
        ...(diagnostics?.fallbacks.length
          ? { "X-Markdown-Fallbacks": diagnostics.fallbacks.join(",") }
          : {}),
        ...(diagnostics?.browserRendered ? { "X-Browser-Rendered": "true" } : {}),
        ...(diagnostics?.paywallDetected ? { "X-Paywall-Detected": "true" } : {}),
        ...(tokenCount ? { "X-Markdown-Tokens": tokenCount } : {}),
        ...(format === "html"
          ? {
              "Content-Security-Policy":
                "default-src 'none'; img-src * data:; style-src 'unsafe-inline'",
              "X-Content-Type-Options": "nosniff",
            }
          : {}),
        ...CORS_HEADERS,
      },
    });
  }

  return new Response(
    renderedPageHTML(host, content, sourceUrl, tokenCount, methodLabel, cached, title),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; " +
          "style-src https://fonts.googleapis.com https://cdnjs.cloudflare.com 'unsafe-inline'; " +
          "img-src * data:; font-src https://fonts.gstatic.com; connect-src 'none'",
        "X-Frame-Options": "DENY",
        ...CORS_HEADERS,
      },
    },
  );
}

// ─── Extract handler ─────────────────────────────────────────

interface ExtractNormalizedItem {
  strategy: ExtractionStrategyType;
  schema: ExtractionSchema;
  options?: ExtractionOptions;
  url?: string;
  html?: string;
  selector?: string;
  forceBrowser: boolean;
  noCache: boolean;
  includeMarkdown: boolean;
}

interface NormalizedExtractPayload {
  isBatch: boolean;
  items: ExtractNormalizedItem[];
}

interface ExtractResultError {
  code: ExtractionErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

function extractErrorResponse(
  error: ExtractResultError,
  status: number = 400,
): Response {
  return Response.json(
    {
      error: "Invalid request",
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    { status, headers: CORS_HEADERS },
  );
}

function normalizeExtractItem(input: unknown): { item?: ExtractNormalizedItem; error?: ExtractResultError } {
  if (!input || typeof input !== "object") {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "Extraction item must be an object.",
      },
    };
  }

  const raw = input as Partial<ExtractionRequestItem> & { [key: string]: unknown };
  const sourceInput = (raw.input && typeof raw.input === "object")
    ? raw.input as { url?: unknown; html?: unknown }
    : undefined;

  const strategy = raw.strategy;
  if (!strategy || typeof strategy !== "string" || !VALID_EXTRACTION_STRATEGIES.has(strategy as ExtractionStrategyType)) {
    return {
      error: {
        code: "UNSUPPORTED_STRATEGY",
        message: "strategy must be one of: css, xpath, regex.",
      },
    };
  }

  const schema = raw.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return {
      error: {
        code: "INVALID_SCHEMA",
        message: "schema must be an object.",
      },
    };
  }

  const url = typeof raw.url === "string"
    ? raw.url
    : typeof sourceInput?.url === "string"
      ? sourceInput.url
      : undefined;
  const html = typeof raw.html === "string"
    ? raw.html
    : typeof sourceInput?.html === "string"
      ? sourceInput.html
      : undefined;

  if (!url && !html) {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "Either url or html input is required.",
      },
    };
  }

  if (url && (!isValidUrl(url) || !isSafeUrl(url))) {
    return {
      error: {
        code: "INVALID_URL",
        message: "url is invalid or blocked by SSRF rules.",
        details: { url },
      },
    };
  }

  if (html) {
    const bytes = new TextEncoder().encode(html).byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: `html input exceeds max size (${MAX_RESPONSE_BYTES} bytes).`,
          details: { bytes, max: MAX_RESPONSE_BYTES },
        },
      };
    }
  }

  const selector = typeof raw.selector === "string" ? raw.selector : undefined;
  if (selector && selector.length > MAX_SELECTOR_LENGTH) {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: `selector is too long (max ${MAX_SELECTOR_LENGTH} characters).`,
      },
    };
  }

  const forceBrowser = raw.force_browser === true;
  const noCache = raw.no_cache === true;
  const includeMarkdown = raw.include_markdown === true;
  const options = raw.options && typeof raw.options === "object"
    ? raw.options as ExtractionOptions
    : undefined;

  return {
    item: {
      strategy: strategy as ExtractionStrategyType,
      schema: schema as ExtractionSchema,
      options,
      url,
      html,
      selector,
      forceBrowser,
      noCache,
      includeMarkdown,
    },
  };
}

function normalizeExtractPayload(input: unknown): { payload?: NormalizedExtractPayload; error?: ExtractResultError } {
  if (!input || typeof input !== "object") {
    return {
      error: {
        code: "INVALID_REQUEST",
        message: "Request body must be a JSON object.",
      },
    };
  }

  const body = input as { items?: unknown[] };
  if (Array.isArray(body.items)) {
    if (body.items.length === 0) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "items cannot be empty.",
        },
      };
    }
    if (body.items.length > MAX_EXTRACT_BATCH_ITEMS) {
      return {
        error: {
          code: "INVALID_REQUEST",
          message: `Maximum ${MAX_EXTRACT_BATCH_ITEMS} items per extraction batch.`,
        },
      };
    }
    const items: ExtractNormalizedItem[] = [];
    for (let i = 0; i < body.items.length; i++) {
      const normalized = normalizeExtractItem(body.items[i]);
      if (normalized.error) {
        return {
          error: {
            ...normalized.error,
            details: {
              ...(normalized.error.details || {}),
              index: i,
            },
          },
        };
      }
      items.push(normalized.item!);
    }
    return {
      payload: {
        isBatch: true,
        items,
      },
    };
  }

  const single = normalizeExtractItem(body);
  if (single.error) return { error: single.error };
  return {
    payload: {
      isBatch: false,
      items: [single.item!],
    },
  };
}

async function handleExtract(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  // Require API_TOKEN for extraction API.
  if (!env.API_TOKEN) {
    return Response.json(
      {
        error: "Service misconfigured",
        code: "INVALID_REQUEST",
        message: "API_TOKEN not set",
      },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !(await timingSafeEqual(auth.slice(7), env.API_TOKEN))) {
    return Response.json(
      {
        error: "Unauthorized",
        code: "INVALID_REQUEST",
        message: "Valid Bearer token required",
      },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > EXTRACT_BODY_MAX_BYTES) {
    return Response.json(
      {
        error: "Request too large",
        code: "INVALID_REQUEST",
        message: `Maximum body size is ${EXTRACT_BODY_MAX_BYTES} bytes`,
      },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    const bodyBytes = await readBodyWithLimit(
      request.body,
      EXTRACT_BODY_MAX_BYTES,
      `Maximum body size is ${EXTRACT_BODY_MAX_BYTES} bytes`,
      request.signal,
    );
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return Response.json(
        {
          error: "Request too large",
          code: "INVALID_REQUEST",
          message: `Maximum body size is ${EXTRACT_BODY_MAX_BYTES} bytes`,
        },
        { status: 413, headers: CORS_HEADERS },
      );
    }
    return extractErrorResponse({
      code: "INVALID_REQUEST",
      message: "Body must be valid JSON.",
      details: { error: errorMessage(error) },
    });
  }

  const normalized = normalizeExtractPayload(body);
  if (normalized.error) {
    return extractErrorResponse(normalized.error, 400);
  }
  const { payload } = normalized;

  const tasks = payload!.items.map((item) => async () => {
    const sourceUrl = item.url || "";
    let html = item.html || "";
    let markdown = "";
    let title = "";

    try {
      if (!html) {
        const converted = await convertUrlWithMetrics(
          sourceUrl,
          env,
          host,
          "html",
          item.selector,
          item.forceBrowser,
          item.noCache,
          undefined,
          request.signal,
        );
        html = converted.content;
        title = converted.title;
      }

      const extraction = extractWithStrategy(
        item.strategy,
        html,
        item.schema,
        item.options,
        item.selector,
      );

      if (item.includeMarkdown) {
        const markdownResult = htmlToMarkdown(
          html,
          sourceUrl || "https://example.invalid/",
          item.selector,
        );
        markdown = markdownResult.markdown;
        if (!title) title = markdownResult.title;
      }

      return {
        success: true,
        strategy: item.strategy,
        source: {
          ...(sourceUrl ? { url: sourceUrl } : {}),
          html_bytes: new TextEncoder().encode(html).byteLength,
        },
        data: extraction.data,
        meta: extraction.meta,
        ...(item.includeMarkdown ? { markdown } : {}),
        ...(title ? { title } : {}),
      };
    } catch (error) {
      if (error instanceof ExtractionStrategyError) {
        return {
          success: false,
          strategy: item.strategy,
          source: sourceUrl ? { url: sourceUrl } : undefined,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        };
      }
      if (error instanceof ConvertError) {
        return {
          success: false,
          strategy: item.strategy,
          source: sourceUrl ? { url: sourceUrl } : undefined,
          error: {
            code: "UPSTREAM_FETCH_FAILED",
            message: error.message,
          },
        };
      }
      return {
        success: false,
        strategy: item.strategy,
        source: sourceUrl ? { url: sourceUrl } : undefined,
        error: {
          code: "EXTRACTION_FAILED",
          message: "Failed to extract content from input.",
          details: {
            error: errorMessage(error),
          },
        },
      };
    }
  });

  const settled = await pLimit(tasks, BROWSER_CONCURRENCY);
  const results = settled.map((entry) =>
    entry.status === "fulfilled"
      ? entry.value
      : {
          success: false,
          error: {
            code: "EXTRACTION_FAILED",
            message: "Extraction task execution failed.",
          },
        });

  logMetric("extract.completed", {
    items: payload!.items.length,
    failures: results.filter((item: any) => !item.success).length,
  });

  if (payload!.isBatch) {
    return Response.json({ results }, { headers: CORS_HEADERS });
  }
  return Response.json(results[0], { headers: CORS_HEADERS });
}

// ─── Deep crawl handler ──────────────────────────────────────

type DeepCrawlStrategy = "bfs" | "best_first";

interface DeepCrawlCheckpointInput {
  crawl_id?: string;
  resume?: boolean;
  snapshot_interval?: number;
  ttl_seconds?: number;
}

interface DeepCrawlFiltersInput {
  url_patterns?: string[];
  allow_domains?: string[];
  block_domains?: string[];
  content_types?: string[];
}

interface DeepCrawlScorerInput {
  keywords?: string[];
  weight?: number;
  score_threshold?: number;
}

interface DeepCrawlOutputInput {
  include_markdown?: boolean;
}

interface DeepCrawlFetchInput {
  selector?: string;
  force_browser?: boolean;
  no_cache?: boolean;
}

interface DeepCrawlRequestInput {
  seed?: string;
  max_depth?: number;
  max_pages?: number;
  strategy?: DeepCrawlStrategy;
  include_external?: boolean;
  stream?: boolean;
  filters?: DeepCrawlFiltersInput;
  scorer?: DeepCrawlScorerInput;
  output?: DeepCrawlOutputInput;
  fetch?: DeepCrawlFetchInput;
  checkpoint?: DeepCrawlCheckpointInput;
}

interface DeepCrawlNormalizedPayload {
  seed: string;
  maxDepth: number;
  maxPages: number;
  strategy: DeepCrawlStrategy;
  includeExternal: boolean;
  stream: boolean;
  urlPatterns: string[];
  allowDomains: string[];
  blockDomains: string[];
  contentTypes: string[];
  keywords: string[];
  keywordWeight: number;
  scoreThreshold: number;
  includeMarkdown: boolean;
  selector?: string;
  forceBrowser: boolean;
  noCache: boolean;
  crawlId: string;
  resume: boolean;
  snapshotInterval: number;
  checkpointTtlSeconds: number;
}

interface DeepCrawlCheckpointRecord {
  version: number;
  crawlId: string;
  seed: string;
  strategy: DeepCrawlStrategy;
  maxDepth: number;
  maxPages: number;
  includeExternal: boolean;
  state: DeepCrawlStateSnapshot;
  updatedAt: string;
}

class DeepCrawlRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function deepCrawlCheckpointKey(crawlId: string): string {
  return `${DEEPCRAWL_CHECKPOINT_KEY_PREFIX}${crawlId}`;
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DeepCrawlRequestError(`${field} must be an integer.`);
  }
  if (value < min || value > max) {
    throw new DeepCrawlRequestError(`${field} must be between ${min} and ${max}.`);
  }
  return value;
}

function parseOptionalBoolean(value: unknown, field: string, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw new DeepCrawlRequestError(`${field} must be a boolean.`);
  }
  return value;
}

function parseStringList(value: unknown, field: string, maxItems: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new DeepCrawlRequestError(`${field} must be an array of strings.`);
  }
  if (value.length > maxItems) {
    throw new DeepCrawlRequestError(`${field} supports at most ${maxItems} items.`);
  }
  const output = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (output.length !== value.length) {
    throw new DeepCrawlRequestError(`${field} must only contain strings.`);
  }
  return output;
}

function normalizeDeepCrawlPayload(input: unknown): DeepCrawlNormalizedPayload {
  if (!input || typeof input !== "object") {
    throw new DeepCrawlRequestError("Request body must be a JSON object.");
  }

  const body = input as DeepCrawlRequestInput;
  const seed = typeof body.seed === "string" ? body.seed.trim() : "";
  if (!seed) {
    throw new DeepCrawlRequestError("seed is required.");
  }
  if (!isValidUrl(seed) || !isSafeUrl(seed)) {
    throw new DeepCrawlRequestError(
      "seed must be a valid and safe HTTP(S) URL.",
      400,
      { seed },
    );
  }

  const maxDepth = parseBoundedInteger(
    body.max_depth,
    "max_depth",
    2,
    0,
    MAX_DEEPCRAWL_DEPTH,
  );
  const maxPages = parseBoundedInteger(
    body.max_pages,
    "max_pages",
    20,
    1,
    MAX_DEEPCRAWL_PAGES,
  );

  const strategy = body.strategy || "bfs";
  if (strategy !== "bfs" && strategy !== "best_first") {
    throw new DeepCrawlRequestError("strategy must be one of: bfs, best_first.");
  }

  const includeExternal = parseOptionalBoolean(
    body.include_external,
    "include_external",
    false,
  );
  const stream = parseOptionalBoolean(body.stream, "stream", false);

  const filters = body.filters && typeof body.filters === "object"
    ? body.filters
    : {};
  const urlPatterns = parseStringList(
    filters.url_patterns,
    "filters.url_patterns",
    MAX_DEEPCRAWL_LIST_ITEMS,
  );
  const allowDomains = parseStringList(
    filters.allow_domains,
    "filters.allow_domains",
    MAX_DEEPCRAWL_LIST_ITEMS,
  );
  const blockDomains = parseStringList(
    filters.block_domains,
    "filters.block_domains",
    MAX_DEEPCRAWL_LIST_ITEMS,
  );
  const contentTypes = parseStringList(
    filters.content_types,
    "filters.content_types",
    MAX_DEEPCRAWL_LIST_ITEMS,
  );

  const scorer = body.scorer && typeof body.scorer === "object"
    ? body.scorer
    : {};
  const keywords = parseStringList(
    scorer.keywords,
    "scorer.keywords",
    MAX_DEEPCRAWL_KEYWORDS,
  );
  const keywordWeight = scorer.weight === undefined
    ? 1
    : (() => {
      if (typeof scorer.weight !== "number" || !Number.isFinite(scorer.weight)) {
        throw new DeepCrawlRequestError("scorer.weight must be a finite number.");
      }
      return scorer.weight;
    })();
  const scoreThreshold = scorer.score_threshold === undefined
    ? Number.NEGATIVE_INFINITY
    : (() => {
      if (
        typeof scorer.score_threshold !== "number" ||
        !Number.isFinite(scorer.score_threshold)
      ) {
        throw new DeepCrawlRequestError("scorer.score_threshold must be a finite number.");
      }
      return scorer.score_threshold;
    })();

  const output = body.output && typeof body.output === "object"
    ? body.output
    : {};
  const includeMarkdown = parseOptionalBoolean(
    output.include_markdown,
    "output.include_markdown",
    false,
  );

  const fetchOptions = body.fetch && typeof body.fetch === "object"
    ? body.fetch
    : {};
  const selector = typeof fetchOptions.selector === "string"
    ? fetchOptions.selector
    : undefined;
  if (selector && selector.length > MAX_SELECTOR_LENGTH) {
    throw new DeepCrawlRequestError(
      `fetch.selector is too long (max ${MAX_SELECTOR_LENGTH} characters).`,
    );
  }
  const forceBrowser = parseOptionalBoolean(
    fetchOptions.force_browser,
    "fetch.force_browser",
    false,
  );
  const noCache = parseOptionalBoolean(fetchOptions.no_cache, "fetch.no_cache", false);

  const checkpoint = body.checkpoint && typeof body.checkpoint === "object"
    ? body.checkpoint
    : {};
  const resume = parseOptionalBoolean(checkpoint.resume, "checkpoint.resume", false);
  const providedCrawlId = typeof checkpoint.crawl_id === "string"
    ? checkpoint.crawl_id.trim()
    : "";
  if (providedCrawlId && providedCrawlId.length > 128) {
    throw new DeepCrawlRequestError("checkpoint.crawl_id is too long (max 128 characters).");
  }
  if (resume && !providedCrawlId) {
    throw new DeepCrawlRequestError(
      "checkpoint.crawl_id is required when checkpoint.resume is true.",
    );
  }

  const snapshotInterval = parseBoundedInteger(
    checkpoint.snapshot_interval,
    "checkpoint.snapshot_interval",
    DEEPCRAWL_DEFAULT_CHECKPOINT_EVERY,
    1,
    100,
  );
  const checkpointTtlSeconds = parseBoundedInteger(
    checkpoint.ttl_seconds,
    "checkpoint.ttl_seconds",
    DEEPCRAWL_DEFAULT_CHECKPOINT_TTL_SECONDS,
    60,
    86_400 * 30,
  );
  const crawlId = providedCrawlId || crypto.randomUUID();

  return {
    seed,
    maxDepth,
    maxPages,
    strategy,
    includeExternal,
    stream,
    urlPatterns,
    allowDomains,
    blockDomains,
    contentTypes,
    keywords,
    keywordWeight,
    scoreThreshold,
    includeMarkdown,
    selector,
    forceBrowser,
    noCache,
    crawlId,
    resume,
    snapshotInterval,
    checkpointTtlSeconds,
  };
}

function buildDeepCrawlFilterChain(payload: DeepCrawlNormalizedPayload): FilterChain {
  let chain = new FilterChain();

  // Enforce base URL safety for discovered links.
  chain = chain.add(async (url) => isValidUrl(url) && isSafeUrl(url));

  if (payload.urlPatterns.length > 0) {
    chain = chain.add(createUrlPatternFilter(payload.urlPatterns));
  }
  if (payload.allowDomains.length > 0 || payload.blockDomains.length > 0) {
    chain = chain.add(createDomainFilter(payload.allowDomains, payload.blockDomains));
  }
  if (payload.contentTypes.length > 0) {
    chain = chain.add(createContentTypeFilter(payload.contentTypes));
  }
  return chain;
}

function buildDeepCrawlScorer(payload: DeepCrawlNormalizedPayload): CompositeUrlScorer | undefined {
  if (payload.keywords.length === 0) return undefined;
  return new CompositeUrlScorer([
    new KeywordUrlScorer(payload.keywords, payload.keywordWeight),
  ]);
}

async function loadDeepCrawlCheckpoint(
  env: Env,
  crawlId: string,
): Promise<DeepCrawlCheckpointRecord | null> {
  const raw = await env.CACHE_KV.get(deepCrawlCheckpointKey(crawlId), "text");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeepCrawlCheckpointRecord>;
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    const state = parsed.state as DeepCrawlStateSnapshot;
    if (
      !Array.isArray(state.frontier) ||
      !Array.isArray(state.visited) ||
      !Array.isArray(state.results)
    ) {
      return null;
    }
    return {
      version: Number(parsed.version) || 1,
      crawlId: typeof parsed.crawlId === "string" ? parsed.crawlId : crawlId,
      seed: typeof parsed.seed === "string" ? parsed.seed : "",
      strategy: parsed.strategy === "best_first" ? "best_first" : "bfs",
      maxDepth: Number(parsed.maxDepth) || 0,
      maxPages: Number(parsed.maxPages) || 0,
      includeExternal: !!parsed.includeExternal,
      state,
      updatedAt: typeof parsed.updatedAt === "string"
        ? parsed.updatedAt
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function persistDeepCrawlCheckpoint(
  env: Env,
  payload: DeepCrawlNormalizedPayload,
  state: DeepCrawlStateSnapshot,
): Promise<void> {
  const record: DeepCrawlCheckpointRecord = {
    version: 1,
    crawlId: payload.crawlId,
    seed: payload.seed,
    strategy: payload.strategy,
    maxDepth: payload.maxDepth,
    maxPages: payload.maxPages,
    includeExternal: payload.includeExternal,
    state,
    updatedAt: new Date().toISOString(),
  };
  await env.CACHE_KV.put(
    deepCrawlCheckpointKey(payload.crawlId),
    JSON.stringify(record),
    { expirationTtl: payload.checkpointTtlSeconds },
  );
}

interface DeepCrawlExecutionResult {
  crawlId: string;
  resumed: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: DeepCrawlNode[];
  stats: {
    crawledPages: number;
    succeededPages: number;
    failedPages: number;
    enqueuedPages: number;
    visitedPages: number;
  };
}

async function executeDeepCrawl(
  env: Env,
  host: string,
  payload: DeepCrawlNormalizedPayload,
  signal: AbortSignal | undefined,
  onNode?: (node: DeepCrawlNode) => Promise<void>,
): Promise<DeepCrawlExecutionResult> {
  let initialState: DeepCrawlStateSnapshot | undefined;
  let resumed = false;

  if (payload.resume) {
    const checkpoint = await loadDeepCrawlCheckpoint(env, payload.crawlId);
    if (!checkpoint) {
      throw new DeepCrawlRequestError("checkpoint.crawl_id not found.", 404);
    }
    if (checkpoint.seed && checkpoint.seed !== payload.seed) {
      throw new DeepCrawlRequestError(
        "checkpoint seed does not match current request seed.",
        409,
      );
    }
    if (checkpoint.strategy !== payload.strategy) {
      throw new DeepCrawlRequestError(
        "checkpoint strategy does not match current request strategy.",
        409,
      );
    }
    initialState = checkpoint.state;
    resumed = true;
  }

  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  const options: DeepCrawlOptions = {
    maxDepth: payload.maxDepth,
    maxPages: payload.maxPages,
    includeExternal: payload.includeExternal,
    filterChain: buildDeepCrawlFilterChain(payload),
    urlScorer: buildDeepCrawlScorer(payload),
    scoreThreshold: payload.scoreThreshold,
    signal,
    ...(initialState ? { initialState } : {}),
    checkpointEvery: payload.snapshotInterval,
    onCheckpoint: async (state) => {
      try {
        await persistDeepCrawlCheckpoint(env, payload, state);
      } catch (error) {
        console.warn("deepcrawl.checkpoint_failed", {
          crawlId: payload.crawlId,
          error: errorMessage(error),
        });
      }
    },
    onResult: async (node) => {
      if (onNode) await onNode(node);
    },
  };

  const fetchPage = async (
    url: string,
    context: { depth: number; parentUrl?: string; signal?: AbortSignal },
  ) => {
    if (!isValidUrl(url) || !isSafeUrl(url)) {
      throw new Error("Invalid or blocked URL.");
    }

    const converted = await convertUrlWithMetrics(
      url,
      env,
      host,
      "html",
      payload.selector,
      payload.forceBrowser,
      payload.noCache,
      undefined,
      context.signal,
    );

    let markdown: string | undefined;
    if (payload.includeMarkdown) {
      const md = htmlToMarkdown(
        converted.content,
        url,
        payload.selector,
      );
      markdown = md.markdown;
    }

    return {
      url,
      html: converted.content,
      markdown,
      title: converted.title,
      method: converted.method,
      contentType: "text/html",
    };
  };

  const crawlResult = payload.strategy === "best_first"
    ? await runBestFirstDeepCrawl(payload.seed, fetchPage, options)
    : await runBfsDeepCrawl(payload.seed, fetchPage, options);

  incrementCounter("conversionsTotal", crawlResult.stats.succeededPages);
  incrementCounter("conversionFailures", crawlResult.stats.failedPages);

  const finishedAtMs = Date.now();
  const finishedAtIso = new Date(finishedAtMs).toISOString();
  const durationMs = Math.max(0, finishedAtMs - startedAtMs);
  incrementCounter("deepCrawlRuns");
  recordDeepCrawlRun(durationMs);
  return {
    crawlId: payload.crawlId,
    resumed,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    durationMs,
    results: crawlResult.results,
    stats: crawlResult.stats,
  };
}

async function handleDeepCrawl(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > DEEPCRAWL_BODY_MAX_BYTES) {
    return Response.json(
      {
        error: "Request too large",
        message: `Maximum body size is ${DEEPCRAWL_BODY_MAX_BYTES} bytes`,
      },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    const bodyBytes = await readBodyWithLimit(
      request.body,
      DEEPCRAWL_BODY_MAX_BYTES,
      `Maximum body size is ${DEEPCRAWL_BODY_MAX_BYTES} bytes`,
      request.signal,
    );
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return Response.json(
        {
          error: "Request too large",
          message: `Maximum body size is ${DEEPCRAWL_BODY_MAX_BYTES} bytes`,
        },
        { status: 413, headers: CORS_HEADERS },
      );
    }
    return Response.json(
      {
        error: "Invalid request body",
        message: "Body must be valid JSON.",
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  let payload: DeepCrawlNormalizedPayload;
  try {
    payload = normalizeDeepCrawlPayload(body);
  } catch (error) {
    if (error instanceof DeepCrawlRequestError) {
      return Response.json(
        {
          error: "Invalid request",
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.statusCode, headers: CORS_HEADERS },
      );
    }
    return Response.json(
      {
        error: "Invalid request",
        message: "Request payload validation failed.",
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (payload.stream) {
    return sseResponse(async (send, streamSignal) => {
      try {
        await send("start", {
          crawlId: payload.crawlId,
          seed: payload.seed,
          strategy: payload.strategy,
          maxDepth: payload.maxDepth,
          maxPages: payload.maxPages,
          resumed: payload.resume,
        });

        const result = await executeDeepCrawl(
          env,
          host,
          payload,
          streamSignal,
          async (node) => {
            await send("node", node);
          },
        );

        await send("done", {
          crawlId: result.crawlId,
          resumed: result.resumed,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          durationMs: result.durationMs,
          stats: result.stats,
          resultCount: result.results.length,
        });
        logMetric("deepcrawl.completed", {
          crawlId: result.crawlId,
          strategy: payload.strategy,
          stream: true,
          resumed: result.resumed,
          crawled: result.stats.crawledPages,
          failed: result.stats.failedPages,
          durationMs: result.durationMs,
        });
      } catch (error) {
        if (streamSignal.aborted || error instanceof RequestAbortedError) return;
        if (error instanceof DeepCrawlRequestError) {
          await send("fail", {
            title: "Invalid request",
            message: error.message,
            status: error.statusCode,
          });
          return;
        }
        console.error("deepcrawl.stream_failed", {
          crawlId: payload.crawlId,
          error: errorMessage(error),
        });
        await send("fail", {
          title: "Deep crawl failed",
          message: "Failed to execute deep crawl.",
          status: 500,
        });
      }
    }, request.signal);
  }

  try {
    const result = await executeDeepCrawl(
      env,
      host,
      payload,
      request.signal,
    );
    logMetric("deepcrawl.completed", {
      crawlId: result.crawlId,
      strategy: payload.strategy,
      stream: false,
      resumed: result.resumed,
      crawled: result.stats.crawledPages,
      failed: result.stats.failedPages,
      durationMs: result.durationMs,
    });
    return Response.json(
      {
        crawlId: result.crawlId,
        seed: payload.seed,
        strategy: payload.strategy,
        resumed: result.resumed,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        stats: result.stats,
        results: result.results,
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    if (error instanceof DeepCrawlRequestError) {
      return Response.json(
        {
          error: "Invalid request",
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.statusCode, headers: CORS_HEADERS },
      );
    }
    console.error("deepcrawl.failed", {
      crawlId: payload.crawlId,
      error: errorMessage(error),
    });
    return Response.json(
      {
        error: "Deep crawl failed",
        message: "Failed to execute deep crawl.",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

// ─── Jobs handler ────────────────────────────────────────────

type StoredJobRecord = JobRecord;

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "canceled"]);

async function authorizeApiTokenRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!env.API_TOKEN) {
    return Response.json(
      {
        error: "Service misconfigured",
        message: "API_TOKEN not set",
      },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !(await timingSafeEqual(auth.slice(7), env.API_TOKEN))) {
    return Response.json(
      {
        error: "Unauthorized",
        message: "Valid Bearer token required",
      },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  return null;
}

async function loadStoredJobRecord(env: Env, jobId: string): Promise<StoredJobRecord | null> {
  const raw = await env.CACHE_KV.get(jobStorageKey(jobId), "text");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredJobRecord;
  } catch {
    return null;
  }
}

function summarizeJob(job: StoredJobRecord): Record<string, unknown> {
  return {
    jobId: job.id,
    type: job.type,
    status: job.status,
    totalTasks: job.totalTasks,
    succeededTasks: job.succeededTasks ?? 0,
    failedTasks: job.failedTasks ?? 0,
    queuedTasks: job.queuedTasks ?? 0,
    runningTasks: job.runningTasks ?? 0,
    canceledTasks: job.canceledTasks ?? 0,
    priority: job.priority ?? 10,
    maxRetries: job.maxRetries ?? 2,
    retryCount: job.retryCount ?? 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

type JobPathAction = "status" | "stream" | "run";

function parseJobPath(path: string): { id: string; action: JobPathAction } | null {
  const parts = path.split("/").filter(Boolean);
  // /api/jobs/:id or /api/jobs/:id/stream or /api/jobs/:id/run
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (parts[0] !== "api" || parts[1] !== "jobs") return null;
  const id = parts[2];
  if (!id) return null;
  if (parts.length === 3) return { id, action: "status" };
  if (parts[3] === "stream") return { id, action: "stream" };
  if (parts[3] === "run") return { id, action: "run" };
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new RequestAbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RequestAbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function handleGetJob(
  request: Request,
  env: Env,
  jobId: string,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  const job = await loadStoredJobRecord(env, jobId);
  if (!job) {
    return Response.json(
      { error: "Not Found", message: "Job not found." },
      { status: 404, headers: CORS_HEADERS },
    );
  }
  return Response.json(summarizeJob(job), { headers: CORS_HEADERS });
}

async function handleGetJobStream(
  request: Request,
  env: Env,
  jobId: string,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  return sseResponse(async (send, signal) => {
    const startedAt = Date.now();
    let lastSent = "";

    while (!signal.aborted) {
      const job = await loadStoredJobRecord(env, jobId);
      if (!job) {
        await send("fail", { title: "Not Found", message: "Job not found.", status: 404 });
        return;
      }
      const summary = summarizeJob(job);
      const serialized = JSON.stringify(summary);
      if (serialized !== lastSent) {
        await send("status", summary);
        lastSent = serialized;
      }

      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        await send("done", summary);
        return;
      }

      if (Date.now() - startedAt > 60_000) {
        await send("timeout", {
          message: "Stream timeout reached. Reconnect to continue monitoring.",
        });
        return;
      }

      await sleep(1000, signal);
    }
  }, request.signal);
}

function recalculateJobCounters(job: JobRecord): void {
  let succeeded = 0;
  let failed = 0;
  let queued = 0;
  let running = 0;
  let canceled = 0;

  for (const task of job.tasks) {
    if (task.status === "succeeded") succeeded += 1;
    else if (task.status === "failed") failed += 1;
    else if (task.status === "queued") queued += 1;
    else if (task.status === "running") running += 1;
    else if (task.status === "canceled") canceled += 1;
  }

  job.succeededTasks = succeeded;
  job.failedTasks = failed;
  job.queuedTasks = queued;
  job.runningTasks = running;
  job.canceledTasks = canceled;

  if (running > 0) {
    job.status = "running";
  } else if (succeeded === job.totalTasks) {
    job.status = "succeeded";
  } else if (failed > 0 && queued === 0) {
    job.status = "failed";
  } else if (canceled === job.totalTasks) {
    job.status = "canceled";
  } else {
    job.status = "queued";
  }
}

function normalizeTaskResultForStorage(result: unknown): unknown {
  const raw = JSON.stringify(result ?? null);
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes <= 16_000) return result;
  return {
    truncated: true,
    bytes,
  };
}

async function handleRunJob(
  request: Request,
  env: Env,
  host: string,
  jobId: string,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  const job = await loadStoredJobRecord(env, jobId);
  if (!job) {
    return Response.json(
      { error: "Not Found", message: "Job not found." },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  if (job.status === "running") {
    return Response.json(
      { error: "Conflict", message: "Job is already running." },
      { status: 409, headers: CORS_HEADERS },
    );
  }

  const runnableTaskIds = new Set(
    job.tasks
      .filter((task) => task.status === "queued" || task.status === "failed")
      .map((task) => task.id),
  );
  if (runnableTaskIds.size === 0) {
    return Response.json(
      {
        ...summarizeJob(job),
        executedTasks: 0,
      },
      { headers: CORS_HEADERS },
    );
  }

  for (const task of job.tasks) {
    if (runnableTaskIds.has(task.id)) {
      task.status = "running";
      task.updatedAt = new Date().toISOString();
    }
  }
  recalculateJobCounters(job);
  job.updatedAt = new Date().toISOString();
  await env.CACHE_KV.put(
    jobStorageKey(job.id),
    JSON.stringify(job),
    { expirationTtl: IDEMPOTENCY_TTL_SECONDS * 30 },
  );

  const runnableTasks = job.tasks.filter((task) => runnableTaskIds.has(task.id));
  const runStartedAt = Date.now();
  const results = await runTasksWithControls(
    runnableTasks.map((task) => ({
      id: task.id,
      input: task,
      url: task.url,
      retryCount: task.retryCount,
    })),
    async (runnerTask) => {
      const task = runnerTask.input as JobTaskRecord;

      if (job.type === "crawl") {
        const crawlInput = task.input as any;
        const targetUrl = typeof crawlInput === "string" ? crawlInput : crawlInput?.url;
        if (typeof targetUrl !== "string" || !isValidUrl(targetUrl) || !isSafeUrl(targetUrl)) {
          return {
            success: false,
            statusCode: 400,
            error: "Invalid or blocked URL",
          };
        }

        const format = (typeof crawlInput === "object" && crawlInput?.format) || "markdown";
        const selector = typeof crawlInput === "object" ? crawlInput?.selector : undefined;
        const forceBrowser = !!(typeof crawlInput === "object" && crawlInput?.force_browser);
        const noCache = !!(typeof crawlInput === "object" && crawlInput?.no_cache);

        try {
          const converted = await convertUrlWithMetrics(
            targetUrl,
            env,
            host,
            VALID_FORMATS.has(format) ? format : "markdown",
            typeof selector === "string" ? selector : undefined,
            forceBrowser,
            noCache,
            undefined,
            request.signal,
          );
          return {
            success: true,
            result: {
              method: converted.method,
              cached: converted.cached,
              title: converted.title,
              fallbacks: converted.diagnostics.fallbacks,
            },
          };
        } catch (error) {
          if (error instanceof ConvertError) {
            return {
              success: false,
              statusCode: error.statusCode,
              error: error.message,
            };
          }
          return {
            success: false,
            error: errorMessage(error),
          };
        }
      }

      const normalized = normalizeExtractItem(task.input);
      if (normalized.error) {
        return {
          success: false,
          statusCode: 400,
          error: normalized.error.message,
        };
      }
      const item = normalized.item!;
      let html = item.html || "";

      try {
        if (!html) {
          const converted = await convertUrlWithMetrics(
            item.url || "",
            env,
            host,
            "html",
            item.selector,
            item.forceBrowser,
            item.noCache,
            undefined,
            request.signal,
          );
          html = converted.content;
        }
        const extracted = extractWithStrategy(
          item.strategy,
          html,
          item.schema,
          item.options,
          item.selector,
        );
        return {
          success: true,
          result: {
            strategy: extracted.strategy,
            meta: extracted.meta,
            data: extracted.data,
          },
        };
      } catch (error) {
        if (error instanceof ExtractionStrategyError) {
          return {
            success: false,
            statusCode: 400,
            error: error.message,
          };
        }
        if (error instanceof ConvertError) {
          return {
            success: false,
            statusCode: error.statusCode,
            error: error.message,
          };
        }
        return {
          success: false,
          error: errorMessage(error),
        };
      }
    },
    {
      concurrency: BROWSER_CONCURRENCY,
      maxRetries: job.maxRetries,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      rateLimitStatusCodes: [429, 503],
      signal: request.signal,
    },
  );

  const retriesUsedInRun = results.reduce(
    (sum, item) => sum + Math.max(0, item.attempts - 1),
    0,
  );
  const runDurationMs = Math.max(0, Date.now() - runStartedAt);
  incrementCounter("jobRuns");
  incrementCounter("jobRetryAttempts", retriesUsedInRun);
  recordJobRun(runDurationMs, retriesUsedInRun, results.length);

  const resultById = new Map(results.map((item) => [item.id, item]));
  for (const task of job.tasks) {
    const outcome = resultById.get(task.id);
    if (!outcome) continue;
    task.retryCount = Math.max(task.retryCount, Math.max(0, outcome.attempts - 1));
    task.status = outcome.success ? "succeeded" : "failed";
    task.error = outcome.success ? undefined : outcome.error || "Task failed";
    if (outcome.success) {
      task.result = normalizeTaskResultForStorage(outcome.result);
    }
    task.updatedAt = new Date().toISOString();
  }

  recalculateJobCounters(job);
  job.updatedAt = new Date().toISOString();
  await env.CACHE_KV.put(
    jobStorageKey(job.id),
    JSON.stringify(job),
    { expirationTtl: IDEMPOTENCY_TTL_SECONDS * 30 },
  );

  const failedInRun = results.filter((item) => !item.success).length;
  logMetric("jobs.run_completed", {
    jobId: job.id,
    type: job.type,
    executedTasks: results.length,
    failedTasksInRun: failedInRun,
    retriesUsedInRun,
    durationMs: runDurationMs,
    status: job.status,
  });

  return Response.json(
    {
      ...summarizeJob(job),
      executedTasks: results.length,
      failedTasksInRun: failedInRun,
      retriesUsedInRun,
      durationMs: runDurationMs,
    },
    { headers: CORS_HEADERS },
  );
}

async function handleJobs(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > JOBS_BODY_MAX_BYTES) {
    return Response.json(
      {
        error: "Request too large",
        message: `Maximum body size is ${JOBS_BODY_MAX_BYTES} bytes`,
      },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    const bodyBytes = await readBodyWithLimit(
      request.body,
      JOBS_BODY_MAX_BYTES,
      `Maximum body size is ${JOBS_BODY_MAX_BYTES} bytes`,
      request.signal,
    );
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return Response.json(
        {
          error: "Request too large",
          message: `Maximum body size is ${JOBS_BODY_MAX_BYTES} bytes`,
        },
        { status: 413, headers: CORS_HEADERS },
      );
    }
    return Response.json(
      {
        error: "Invalid request body",
        message: "Body must be valid JSON.",
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const validated = validateJobCreatePayload(body);
  if (validated.error) {
    return Response.json(
      {
        error: validated.error.code,
        message: validated.error.message,
        ...(validated.error.details ? { details: validated.error.details } : {}),
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (idempotencyKey) {
    try {
      const existingJobId = await env.CACHE_KV.get(jobIdempotencyKey(idempotencyKey), "text");
      if (existingJobId) {
        const existingRaw = await env.CACHE_KV.get(jobStorageKey(existingJobId), "text");
        if (existingRaw) {
          const existing = JSON.parse(existingRaw) as {
            id: string;
            type: string;
            status: string;
            totalTasks: number;
            createdAt: string;
            updatedAt: string;
          };
          return Response.json(
            {
              jobId: existing.id,
              type: existing.type,
              status: existing.status,
              totalTasks: existing.totalTasks,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
              idempotent: true,
            },
            { status: 200, headers: CORS_HEADERS },
          );
        }
      }
    } catch {
      // Fall through and create a new job if idempotency lookup fails.
    }
  }

  const job = buildJobRecord(validated.payload!);
  try {
    await env.CACHE_KV.put(
      jobStorageKey(job.id),
      JSON.stringify(job),
      { expirationTtl: IDEMPOTENCY_TTL_SECONDS * 30 },
    );
    if (idempotencyKey) {
      await env.CACHE_KV.put(
        jobIdempotencyKey(idempotencyKey),
        job.id,
        { expirationTtl: IDEMPOTENCY_TTL_SECONDS },
      );
    }
  } catch (error) {
    console.error("Failed to persist job:", errorMessage(error));
    return Response.json(
      {
        error: "Storage error",
        message: "Failed to persist job.",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  incrementCounter("jobsCreated");
  recordJobCreated(job.totalTasks);
  logMetric("jobs.created", {
    jobId: job.id,
    type: job.type,
    totalTasks: job.totalTasks,
    priority: job.priority,
    idempotency: !!idempotencyKey,
  });

  return Response.json(
    {
      jobId: job.id,
      type: job.type,
      status: job.status,
      totalTasks: job.totalTasks,
      priority: job.priority,
      maxRetries: job.maxRetries,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      idempotent: false,
    },
    { status: 202, headers: CORS_HEADERS },
  );
}

// ─── Batch handler ───────────────────────────────────────────

/** Simple concurrency limiter for browser rendering tasks. */
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      try {
        const value = await tasks[i]();
        results[i] = { status: "fulfilled", value };
      } catch (reason: any) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}

interface BatchUrlObjectInput {
  url: string;
  format?: OutputFormat;
  selector?: string;
  force_browser?: boolean;
  no_cache?: boolean;
}

interface BatchNormalizedItem {
  url: string;
  format: OutputFormat;
  selector?: string;
  forceBrowser: boolean;
  noCache: boolean;
}

function normalizeBatchItem(input: unknown): BatchNormalizedItem | null {
  if (typeof input === "string") {
    return {
      url: input,
      format: "markdown",
      selector: undefined,
      forceBrowser: false,
      noCache: false,
    };
  }
  if (!input || typeof input !== "object") {
    return null;
  }
  const item = input as Partial<BatchUrlObjectInput>;
  if (typeof item.url !== "string") {
    return null;
  }
  const format = item.format || "markdown";
  if (!VALID_FORMATS.has(format)) {
    return null;
  }
  if (item.selector !== undefined && typeof item.selector !== "string") {
    return null;
  }
  if (item.selector && item.selector.length > MAX_SELECTOR_LENGTH) {
    return null;
  }
  if (item.force_browser !== undefined && typeof item.force_browser !== "boolean") {
    return null;
  }
  if (item.no_cache !== undefined && typeof item.no_cache !== "boolean") {
    return null;
  }
  return {
    url: item.url,
    format: format as OutputFormat,
    selector: item.selector,
    forceBrowser: item.force_browser === true,
    noCache: item.no_cache === true,
  };
}

/** Handle POST /api/batch — convert multiple URLs. */
async function handleBatch(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  incrementCounter("batchRequests");
  // Require API_TOKEN
  if (!env.API_TOKEN) {
    return Response.json(
      { error: "Service misconfigured", message: "API_TOKEN not set" },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  // Timing-safe authentication
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !(await timingSafeEqual(auth.slice(7), env.API_TOKEN))) {
    return Response.json(
      { error: "Unauthorized", message: "Valid Bearer token required" },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  // Body size limit
  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > BATCH_BODY_MAX_BYTES) {
    return Response.json(
      { error: "Request too large", message: "Maximum body size is 100 KB" },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  try {
    let bodyText = "";
    try {
      const bodyBytes = await readBodyWithLimit(
        request.body,
        BATCH_BODY_MAX_BYTES,
        "Maximum body size is 100 KB",
        request.signal,
      );
      bodyText = new TextDecoder().decode(bodyBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return Response.json(
          { error: "Request too large", message: "Maximum body size is 100 KB" },
          { status: 413, headers: CORS_HEADERS },
        );
      }
      throw error;
    }

    if (!bodyText.trim()) {
      return Response.json(
        { error: "Invalid request body", message: "Body must be valid JSON and include a 'urls' array." },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const body = JSON.parse(bodyText) as { urls?: unknown };
    if (!Array.isArray(body.urls)) {
      return Response.json(
        { error: "Request body must contain 'urls' array" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (body.urls.length > 10) {
      return Response.json(
        { error: "Maximum 10 URLs per batch" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const items = body.urls
      .map((item) => normalizeBatchItem(item))
      .filter((item): item is BatchNormalizedItem => item !== null);

    if (items.length !== body.urls.length) {
      return Response.json(
        {
          error:
            "Each batch item must be either a URL string or { url, format?, selector?, force_browser?, no_cache? }",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const tasks = items.map((item) => async () => {
      if (!isValidUrl(item.url) || !isSafeUrl(item.url)) {
        return { url: item.url, format: item.format, error: "Invalid or blocked URL" };
      }
      try {
        const result = await convertUrlWithMetrics(
          item.url,
          env,
          host,
          item.format,
          item.selector,
          item.forceBrowser,
          item.noCache,
        );
        incrementCounter("conversionsTotal");
        if (result.cached || result.diagnostics.cacheHit) incrementCounter("cacheHits");
        if (result.method === "browser+readability+turndown" || result.diagnostics.browserRendered) {
          incrementCounter("browserRenderCalls");
        }
        if (result.diagnostics.paywallDetected) incrementCounter("paywallDetections");
        if (result.diagnostics.fallbacks.length > 0) {
          incrementCounter("paywallFallbacks", result.diagnostics.fallbacks.length);
        }
        return {
          url: item.url,
          format: item.format,
          content: result.content,
          ...(item.format === "markdown" ? { markdown: result.content } : {}),
          title: result.title,
          method: result.method,
          cached: result.cached,
          fallbacks: result.diagnostics.fallbacks,
        };
      } catch (e) {
        if (e instanceof ConvertError) {
          incrementCounter("conversionFailures");
          return { url: item.url, format: item.format, error: e.message };
        }
        incrementCounter("conversionFailures");
        console.error("Batch item failed:", item.url, e instanceof Error ? e.message : e);
        return { url: item.url, format: item.format, error: "Failed to process this URL." };
      }
    });

    const results = await pLimit(tasks, BROWSER_CONCURRENCY);
    const output = results.map((r) =>
      r.status === "fulfilled" ? r.value : { error: "Processing failed" },
    );

    logMetric("batch.completed", {
      items: items.length,
      failures: output.filter((item: any) => !!item.error).length,
    });
    return Response.json({ results: output }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("Batch request processing failed:", error);
    return Response.json(
      { error: "Invalid request body", message: "Body must be valid JSON and include a 'urls' array." },
      { status: 400, headers: CORS_HEADERS },
    );
  }
}

// ─── OG image ────────────────────────────────────────────────

/** Generate a branded SVG OG image for social sharing. */
function handleOgImage(url: URL, host: string): Response {
  const title = url.searchParams.get("title") || "";
  const displayTitle = title.length > 80 ? title.slice(0, 79) + "\u2026" : title;

  const lines: string[] = [];
  if (displayTitle) {
    const words = displayTitle.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line && (line + " " + word).length > 40) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) lines.push(line);
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const titleLines = lines
    .slice(0, 3)
    .map((l, i) => `<text x="80" y="${title ? 280 + i * 56 : 320}" font-family="system-ui,sans-serif" font-size="44" font-weight="600" fill="#eeeef2">${esc(l)}</text>`)
    .join("\n    ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07080c"/>
      <stop offset="100%" stop-color="#0c0d12"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="50%" stop-color="#67e8f9"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="4" fill="url(#accent)"/>
  <circle cx="1050" cy="120" r="200" fill="#22d3ee" opacity="0.04"/>
  <circle cx="150" cy="500" r="150" fill="#22d3ee" opacity="0.03"/>
  <text x="80" y="120" font-family="system-ui,sans-serif" font-size="24" font-weight="600" fill="#22d3ee">${esc(host)}</text>
  <text x="80" y="160" font-family="system-ui,sans-serif" font-size="18" fill="#8b8da3">Any URL to Markdown, instantly</text>
  <line x1="80" y1="200" x2="300" y2="200" stroke="#23252f" stroke-width="1"/>
  ${titleLines || `<text x="80" y="340" font-family="Georgia,serif" font-size="52" font-style="italic" font-weight="400" fill="#eeeef2">Any URL to</text>
    <text x="80" y="400" font-family="Georgia,serif" font-size="52" font-style="italic" font-weight="400" fill="url(#accent)">Markdown</text>`}
  <text x="80" y="580" font-family="system-ui,sans-serif" font-size="16" fill="#555770">Powered by Cloudflare Workers</text>
  <rect x="940" y="560" width="180" height="40" rx="8" fill="#22d3ee" opacity="0.1"/>
  <text x="980" y="586" font-family="monospace" font-size="14" font-weight="500" fill="#22d3ee">Convert &rarr;</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
