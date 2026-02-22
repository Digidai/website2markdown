import type { Env, OutputFormat, ConvertMethod } from "./types";
import {
  MAX_RESPONSE_BYTES,
  MAX_SELECTOR_LENGTH,
  CORS_HEADERS,
  WECHAT_UA,
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
  fetchWithBrowser,
  alwaysNeedsBrowser,
  getAdapter,
  getBrowserCapacityStats,
} from "./browser";
import { getCached, setCache, getImage } from "./cache";
import { parseProxyUrl, fetchViaProxy } from "./proxy";
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
import { errorMessage } from "./utils";
import { landingPageHTML } from "./templates/landing";
import { renderedPageHTML } from "./templates/rendered";
import { loadingPageHTML } from "./templates/loading";
import { errorPageHTML } from "./templates/error";

const BATCH_BODY_MAX_BYTES = 100_000;
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
        const proxyConfig = env.PROXY_URL ? parseProxyUrl(env.PROXY_URL) : null;
        if (!proxyConfig) {
          throw new ConvertError(
            "Fetch Failed",
            "Site requires proxy access. Please configure PROXY_URL.",
            502,
          );
        }
        // Extract cookies from the error message
        const cookieStart = msg.indexOf("PROXY_RETRY:") + "PROXY_RETRY:".length;
        const cookies = msg.slice(cookieStart).replace(/^(Browser rendering failed: )+/, "");

        throwIfAborted(abortSignal);
        await progress("fetch", "Retrying via proxy");
        try {
          const proxyResult = await fetchViaProxy(targetUrl, proxyConfig, {
            "User-Agent": DESKTOP_UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "identity",
            "Cookie": cookies,
          }, 25_000, abortSignal);
          if (proxyResult.status >= 200 && proxyResult.status < 400 && proxyResult.body.length > 1000) {
            // Check if proxy returned a login/challenge page instead of real content
            const lower = proxyResult.body.toLowerCase();
            const isGarbage =
              (lower.includes("passport.weibo") || lower.includes("qrcode_login") || lower.includes("login_type")) ||
              (lower.includes("verify") && lower.includes("captcha") && proxyResult.body.length < 5000) ||
              (lower.includes("cf-browser-verification") || lower.includes("cf-challenge")) ||
              (lower.includes("just a moment") && lower.includes("cloudflare") && proxyResult.body.length < 10000);
            if (isGarbage) {
              throw new Error(`Proxy returned login/challenge page (${proxyResult.body.length} bytes)`);
            }
            finalHtml = proxyResult.body;
            method = "browser+readability+turndown";
            browserRendered = true;
            fallbacks.add("proxy_retry");
          } else {
            throw new Error(`Proxy fetch returned ${proxyResult.status}, body ${proxyResult.body.length} bytes`);
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
      const result = await convertUrl(
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
      return Response.json({
        status: "ok",
        service: host,
        uptime_seconds: Math.max(0, Math.floor((Date.now() - runtimeStartedAt) / 1000)),
        metrics: {
          ...runtimeCounters,
        },
        browser: getBrowserCapacityStats(),
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
      const result = await convertUrl(
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
        const result = await convertUrl(
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
