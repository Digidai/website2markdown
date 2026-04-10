// 主入口：路由分发与 Cloudflare Worker 导出

import type { ConvertMethod, Env, OutputFormat, AuthContext, PolicyDecision, Tier } from "./types";
import { TIER_QUOTAS } from "./types";
import {
  MAX_SELECTOR_LENGTH,
  CORS_HEADERS,
  WECHAT_UA,
  VALID_FORMATS,
  BROWSER_TIMEOUT,
  IMAGE_MAX_BYTES,
} from "./config";
import {
  isSafeUrl,
  isValidUrl,
  extractTargetUrl,
  buildRawRequestPath,
  fetchWithSafeRedirects,
} from "./security";
import { getCached, getImage } from "./cache";
import { setPaywallRulesFromJson, getPaywallRuleStats } from "./paywall";
import { errorMessage } from "./utils";
import { landingPageHTML } from "./templates/landing";
import { loadingPageHTML } from "./templates/loading";

// 从拆分模块导入
import { incrementCounter, logMetric } from "./runtime-state";
import {
  lastPaywallRulesSyncAt,
  lastPaywallRulesSource,
  lastPaywallRulesRaw,
  PAYWALL_RULES_REFRESH_MS,
  setPaywallSyncState,
} from "./runtime-state";
import { isAuthorizedByToken } from "./middleware/auth";
import { resolveAuth } from "./middleware/auth-d1";
import { buildPolicy, checkPolicy, policyHeaders } from "./middleware/tier-gate";
import { consumeRateLimit, rateLimitedResponse } from "./middleware/rate-limit";
import { recordUsage, flushUsage, shouldFlush, handleUsage } from "./handlers/usage";
import {
  LANDING_CSP,
  LOADING_CSP,
  ConvertError,
  wantsJsonError,
  errorResponse,
  buildResponse,
} from "./helpers/response";
import {
  convertUrlWithMetrics,
  readBodyWithLimit,
  BodyTooLargeError,
} from "./handlers/convert";
import { handleStream } from "./handlers/stream";
import { handleHealth } from "./handlers/health";
import { handleBatch } from "./handlers/batch";
import { handleExtract } from "./handlers/extract";
import { handleDeepCrawl } from "./handlers/deepcrawl";
import {
  parseJobPath,
  handleGetJob,
  handleGetJobStream,
  handleRunJob,
  handleJobs,
} from "./handlers/jobs";
import { handleOgImage } from "./handlers/og-image";
import { handleLlmsTxt } from "./handlers/llms-txt";
import { handleRobotsTxt, handleSitemap } from "./handlers/seo";

// 重新导出 JobCoordinator 供 wrangler Durable Object 绑定使用
export { JobCoordinator } from "./handlers/jobs";

// ─── Paywall 规则同步 ────────────────────────────────────────

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
    const stats = getPaywallRuleStats();
    logMetric("paywall.rules_updated", {
      source: stats.source,
      rules: stats.ruleCount,
      domains: stats.domainCount,
    });
  }
  setPaywallSyncState(nowMs, source, raw);
}

// ─── 辅助函数 ────────────────────────────────────────────────

function isDocumentNavigationRequest(request: Request, acceptHeader: string): boolean {
  return request.method === "GET" &&
    (request.headers.get("Sec-Fetch-Dest") === "document" ||
      (!acceptHeader.includes("text/markdown") &&
        !acceptHeader.includes("application/json") &&
        acceptHeader.includes("text/html")));
}

// ─── 主 fetch handler ────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    if (path.startsWith("/api/jobs/") && !jobPath) {
      return Response.json(
        {
          error: "Invalid request",
          message: "Invalid job path or job id.",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }
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
      if (path === "/robots.txt" || path === "/sitemap.xml") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": path === "/robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8",
            ...CORS_HEADERS,
          },
        });
      }
      if (path === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }
      if (path === "/llms.txt" || path === "/.well-known/llms.txt") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...CORS_HEADERS,
          },
        });
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

    // SEO files
    if (path === "/robots.txt") {
      return handleRobotsTxt();
    }
    if (path === "/sitemap.xml") {
      return handleSitemap(host);
    }

    // Favicon
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // llms.txt — AI discoverability
    if (path === "/llms.txt" || path === "/.well-known/llms.txt") {
      return handleLlmsTxt(host);
    }

    // Health check
    if (path === "/api/health") {
      return handleHealth(host);
    }

    // Dynamic OG image
    if (path === "/api/og") {
      return handleOgImage(url, host);
    }

    // GET /api/usage — per-key usage data
    if (path === "/api/usage" && request.method === "GET") {
      const auth = await resolveAuth(request, env);
      return handleUsage(auth, env);
    }

    // SSE stream endpoint (GET only — HEAD would trigger conversion with no body)
    if (path === "/api/stream") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
      }
      // D1 auth path (preferred when AUTH_DB is configured)
      const streamAuth = env.AUTH_DB
        ? await resolveAuth(request, env)
        : null;
      const streamPolicy = streamAuth
        ? buildPolicy(streamAuth, "stream")
        : null;

      // Legacy auth fallback (when no D1)
      if (!streamAuth) {
        const streamToken = url.searchParams.get("token");
        const streamNoCache = url.searchParams.get("no_cache") === "true";
        const streamEngine = url.searchParams.get("engine");
        const streamForceBrowser = url.searchParams.get("force_browser") === "true";
        if (env.PUBLIC_API_TOKEN) {
          const authorized = await isAuthorizedByToken(request, env.PUBLIC_API_TOKEN, streamToken);
          if (!authorized) {
            return Response.json(
              { error: "Unauthorized", message: "Valid token required for /api/stream" },
              { status: 401, headers: CORS_HEADERS },
            );
          }
        } else if (streamNoCache || streamEngine || streamForceBrowser) {
          return Response.json(
            { error: "Unauthorized", message: "Parameters no_cache, engine, and force_browser require a valid token." },
            { status: 401, headers: CORS_HEADERS },
          );
        }
      }

      const decision = await consumeRateLimit(request, env, "stream");
      if (decision?.exceeded) {
        return rateLimitedResponse("stream", decision, true);
      }
      incrementCounter("streamRequests");
      const streamBrowserAllowed = streamPolicy ? streamPolicy.browserAllowed : !env.PUBLIC_API_TOKEN ? false : true;
      return handleStream(request, env, host, url, streamBrowserAllowed);
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
      const langParam = url.searchParams.get("lang");
      let landingLang: "en" | "zh" = "en";
      if (langParam === "zh") {
        landingLang = "zh";
      } else if (langParam === "en") {
        landingLang = "en";
      } else {
        // Auto-detect from Accept-Language header
        const acceptLang = request.headers.get("Accept-Language") || "";
        if (acceptLang.match(/^zh\b/i) || acceptLang.includes("zh-CN") || acceptLang.includes("zh-TW")) {
          landingLang = "zh";
        }
      }
      return new Response(landingPageHTML(host, landingLang), {
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
      const engine = url.searchParams.get("engine") || undefined;

      // ── Auth: D1 path (preferred) or legacy token path ──
      let auth: AuthContext;
      let policy: PolicyDecision;

      if (env.AUTH_DB) {
        // D1-backed auth — resolveAuth checks Bearer header
        auth = await resolveAuth(request, env);
        policy = buildPolicy(auth, "convert");
      } else {
        // Legacy path: single-token auth (no D1 configured)
        const expectedToken = env.PUBLIC_API_TOKEN || env.API_TOKEN || "";
        const isAuthenticated = expectedToken
          ? await isAuthorizedByToken(request, expectedToken, queryToken)
          : false;
        const legacyTier: Tier = isAuthenticated ? "pro" : "anonymous";
        auth = {
          tier: legacyTier,
          accountId: null, keyId: null,
          quotaLimit: TIER_QUOTAS[legacyTier],
          quotaUsed: 0,
        };
        policy = buildPolicy(auth, "convert");
      }

      // Check policy for restricted parameters
      const policyError = checkPolicy(policy, { forceBrowser, noCache, engine });
      if (policyError) {
        return errorResponse("Unauthorized", policyError, 401, jsonErrors);
      }

      const browserAllowed = policy.browserAllowed;

      const rawRequestPath = buildRawRequestPath(targetUrl, {
        selector,
        forceBrowser,
        noCache,
        engine,
      });

      // Optional API auth for non-document requests (legacy path only)
      if (!env.AUTH_DB) {
        const isApiStyleRequest =
          !isDocumentNav ||
          wantsRaw ||
          format !== "markdown" ||
          acceptHeader.includes("application/json") ||
          acceptHeader.includes("text/markdown");
        if (env.PUBLIC_API_TOKEN && isApiStyleRequest && auth.tier === "anonymous") {
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
          const cached = await getCached(env, targetUrl, "markdown", selector, engine);
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
              rawRequestPath,
            );
          }
        }

        // Not cached → return loading page with SSE
        const streamParams = new URLSearchParams();
        if (selector) streamParams.set("selector", selector);
        if (forceBrowser) streamParams.set("force_browser", "true");
        if (noCache) streamParams.set("no_cache", "true");
        if (queryToken) streamParams.set("token", queryToken);
        if (engine) streamParams.set("engine", engine);
        const sp = streamParams.toString();

        return new Response(
          loadingPageHTML(host, targetUrl, sp ? "&" + sp : "", rawRequestPath),
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

      // ── Quota check with graceful degradation ──
      if (policy.tier !== "anonymous" && policy.quotaRemaining <= 0) {
        // Quota exceeded: try to serve cached content
        const cachedFallback = await getCached(env, targetUrl, format, selector, engine);
        if (cachedFallback) {
          incrementCounter("conversionsTotal");
          incrementCounter("cacheHits");
          const resp = buildResponse(
            cachedFallback.content, targetUrl, host,
            cachedFallback.method as ConvertMethod, format,
            wantsRaw, "", true, cachedFallback.title,
            { cacheHit: true, browserRendered: false, paywallDetected: false, fallbacks: [] },
            rawRequestPath,
          );
          resp.headers.set("X-Quota-Exceeded", "true");
          for (const [k, v] of Object.entries(policyHeaders(policy, auth))) resp.headers.set(k, v);
          return resp;
        }
        // No cache available
        return errorResponse(
          "Quota Exceeded",
          `Monthly quota of ${auth.quotaLimit} credits exhausted. Upgrade your plan at /portal/.`,
          429,
          jsonErrors,
        );
      }

      // ── Raw / API calls → synchronous conversion ──
      const result = await convertUrlWithMetrics(
        targetUrl, env, host, format, selector, forceBrowser, noCache,
        undefined, undefined, engine, browserAllowed,
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

      // Track usage (D1 flush via waitUntil)
      recordUsage(auth, policy.creditCost, result.diagnostics.browserRendered, result.cached);
      if (shouldFlush()) {
        ctx.waitUntil(flushUsage(env));
      }

      const resp = buildResponse(
        result.content, targetUrl, host, result.method, format,
        wantsRaw, result.tokenCount, result.cached, result.title, result.diagnostics,
        rawRequestPath,
      );
      // Add rate limit + cost headers
      for (const [k, v] of Object.entries(policyHeaders(policy, auth))) resp.headers.set(k, v);
      return resp;
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
