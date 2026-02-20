import type { Env, OutputFormat, ConvertMethod } from "./types";
import {
  MAX_RESPONSE_BYTES,
  CORS_HEADERS,
  WECHAT_UA,
  DESKTOP_UA,
  VALID_FORMATS,
  BROWSER_CONCURRENCY,
  BROWSER_TIMEOUT,
  IMAGE_MAX_BYTES,
} from "./config";
import {
  isSafeUrl,
  isValidUrl,
  needsBrowserRendering,
  extractTargetUrl,
  escapeHtml,
  fetchWithSafeRedirects,
} from "./security";
import { htmlToMarkdown, htmlToText, proxyImageUrls } from "./converter";
import { fetchWithBrowser, alwaysNeedsBrowser } from "./browser";
import { getCached, setCache, getImage } from "./cache";
import { parseProxyUrl, fetchViaProxy } from "./proxy";
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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
      };
    }
  }

  // 2. Fetch & parse
  let finalHtml = "";
  let method: ConvertMethod = "readability+turndown";

  // Early browser path — skip redundant static fetch for sites that always need browser
  if (alwaysNeedsBrowser(targetUrl)) {
    throwIfAborted(abortSignal);
    await progress("browser", "Rendering with browser");
    try {
      finalHtml = await fetchWithBrowser(targetUrl, env, host, abortSignal);
      method = "browser+readability+turndown";
    } catch (error) {
      if (abortSignal?.aborted) throw new RequestAbortedError();
      const msg = error instanceof Error ? error.message : "";

      // Zhihu hybrid path: browser solved JS challenge but datacenter IP
      // was blocked. Retry the fetch through ISP proxy with browser cookies.
      if (msg.startsWith("ZHIHU_PROXY_RETRY:") || msg.includes("ZHIHU_PROXY_RETRY:")) {
        const proxyConfig = env.PROXY_URL ? parseProxyUrl(env.PROXY_URL) : null;
        if (!proxyConfig) {
          throw new ConvertError(
            "Fetch Failed",
            "知乎要求登录验证。需要配置代理才能访问。",
            502,
          );
        }
        // Extract cookies from the error message
        const cookieStart = msg.indexOf("ZHIHU_PROXY_RETRY:") + "ZHIHU_PROXY_RETRY:".length;
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
          }, 25_000);
          if (proxyResult.status >= 200 && proxyResult.status < 400 && proxyResult.body.length > 1000) {
            finalHtml = proxyResult.body;
            method = "browser+readability+turndown";
          } else {
            throw new Error(`Proxy fetch returned ${proxyResult.status}, body ${proxyResult.body.length} bytes`);
          }
        } catch (proxyError) {
          const proxyDetail = errorMessage(proxyError);
          console.error("Proxy fetch failed:", proxyDetail);
          throw new ConvertError(
            "Fetch Failed",
            `知乎代理访问失败: ${proxyDetail}`,
            502,
          );
        }
      } else {
        console.error("Browser rendering failed:", errorMessage(error));
        const userMessage = msg.includes("知乎") || msg.includes("Zhihu")
          ? msg.replace(/^(Browser rendering failed: )+/, "")
          : "Browser rendering failed for this URL.";
        throw new ConvertError("Fetch Failed", userMessage, 502);
      }
    }
  } else {
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
    } catch (e) {
      if (abortSignal?.aborted) throw new RequestAbortedError();
      throw asFetchConvertError(e);
    } finally {
      cleanupFetchSignal();
    }

    const staticFailed = !response.ok;

    if (staticFailed && !forceBrowser) {
      throw new ConvertError(
        "Fetch Failed",
        `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`,
        502,
      );
    }

    if (staticFailed) {
      // forceBrowser was true — go straight to browser rendering
      throwIfAborted(abortSignal);
      await progress("browser", "Rendering with browser");
      try {
        finalHtml = await fetchWithBrowser(targetUrl, env, host, abortSignal);
        method = "browser+readability+turndown";
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

      const body = await response.text();
      throwIfAborted(abortSignal);
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        throw new ConvertError("Content Too Large", "The target page exceeds the 5 MB size limit.", 413);
      }

      const tokenCount = response.headers.get("x-markdown-tokens") || "";
      const isMarkdown = contentType.includes("text/markdown");

      // 6. Native markdown
      if (isMarkdown) {
        let nativeOutput: string;
        switch (format) {
          case "json":
            nativeOutput = JSON.stringify({
              url: targetUrl, title: "", markdown: body, method: "native",
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

        return { content: nativeOutput, title: "", method: "native", tokenCount, cached: false };
      }

      // 7. Check browser rendering need
      finalHtml = body;
      if (forceBrowser || needsBrowserRendering(body, targetUrl)) {
        throwIfAborted(abortSignal);
        await progress("browser", "Rendering with browser");
        try {
          finalHtml = await fetchWithBrowser(targetUrl, env, host, abortSignal);
          method = "browser+readability+turndown";
        } catch (e) {
          console.error("Browser rendering failed, using static HTML:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  // 7. Size check on final HTML
  throwIfAborted(abortSignal);
  if (new TextEncoder().encode(finalHtml).byteLength > MAX_RESPONSE_BYTES) {
    throw new ConvertError("Content Too Large", "The rendered page exceeds the 5 MB size limit.", 413);
  }

  // 8. Convert
  throwIfAborted(abortSignal);
  await progress("convert", "Converting to Markdown");
  const { markdown, title: extractedTitle, contentHtml } = htmlToMarkdown(finalHtml, targetUrl, selector);
  let output: string;

  switch (format) {
    case "html":
      output = contentHtml;
      break;
    case "text":
      output = htmlToText(finalHtml, targetUrl);
      break;
    case "json":
      output = JSON.stringify({
        url: targetUrl, title: extractedTitle, markdown, method,
        timestamp: new Date().toISOString(),
      });
      break;
    default:
      output = markdown;
  }

  // 9. WeChat image proxy
  if (
    format === "markdown" &&
    (targetUrl.includes("mmbiz.qpic.cn") || targetUrl.includes("mp.weixin.qq.com"))
  ) {
    output = proxyImageUrls(output, host);
  }

  // 10. Cache
  if (!noCache) {
    throwIfAborted(abortSignal);
    await setCache(env, targetUrl, format, { content: output, method, title: extractedTitle }, selector);
  }

  return { content: output, title: extractedTitle, method, tokenCount: "", cached: false };
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
  const forceBrowser = url.searchParams.get("force_browser") === "true";
  const noCache = url.searchParams.get("no_cache") === "true";

  return sseResponse(async (send, streamSignal) => {
    try {
      const result = await convertUrl(
        targetUrl, env, host, "markdown", selector, forceBrowser, noCache,
        async (step, label) => { await send("step", { id: step, label }); },
        streamSignal,
      );
      const sep = targetUrl.includes("?") ? "&" : "?";
      await send("done", {
        rawUrl: `/${targetUrl}${sep}raw=true`,
        title: result.title,
        method: result.method,
        tokenCount: result.tokenCount,
        cached: result.cached,
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
        await send("fail", { title: err.title, message: err.message, status: err.statusCode });
      } else {
        console.error("Stream conversion error:", err);
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

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /api/batch
    if (request.method === "POST" && path === "/api/batch") {
      return handleBatch(request, env, host);
    }

    // Only allow GET and HEAD for other routes
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    // Favicon
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Health check
    if (path === "/api/health") {
      return Response.json({ status: "ok", service: host }, { headers: CORS_HEADERS });
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
        const headers = new Headers();
        headers.set("Content-Type", imgContentType);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "public, max-age=86400");
        headers.set("Content-Security-Policy", "default-src 'none'");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(imgResp.body, { status: 200, headers });
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
      const forceBrowser = url.searchParams.get("force_browser") === "true";
      const noCache = url.searchParams.get("no_cache") === "true";

      // ── Browser document navigation → loading experience with SSE ──
      // Only serve loading page for browser document navigations (not programmatic API calls)
      const isDocumentNav =
        request.method === "GET" &&
        (request.headers.get("Sec-Fetch-Dest") === "document" ||
          (!acceptHeader.includes("text/markdown") && !acceptHeader.includes("application/json") && acceptHeader.includes("text/html")));

      if (!wantsRaw && format === "markdown" && isDocumentNav) {
        // Check cache for instant display
        if (!noCache) {
          const cached = await getCached(env, targetUrl, "markdown", selector);
          if (cached) {
            return buildResponse(
              cached.content, targetUrl, host,
              cached.method as ConvertMethod, "markdown",
              false, "", true, cached.title,
            );
          }
        }

        // Not cached → return loading page with SSE
        const streamParams = new URLSearchParams();
        if (selector) streamParams.set("selector", selector);
        if (forceBrowser) streamParams.set("force_browser", "true");
        if (noCache) streamParams.set("no_cache", "true");
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

      return buildResponse(
        result.content, targetUrl, host, result.method, format,
        wantsRaw, result.tokenCount, result.cached, result.title,
      );
    } catch (err: unknown) {
      if (err instanceof ConvertError) {
        return errorResponse(err.title, err.message, err.statusCode, jsonErrors);
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error("Conversion error:", { url: targetUrl, error: message });
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

/** Handle POST /api/batch — convert multiple URLs. */
async function handleBatch(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
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
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).length > BATCH_BODY_MAX_BYTES) {
      return Response.json(
        { error: "Request too large", message: "Maximum body size is 100 KB" },
        { status: 413, headers: CORS_HEADERS },
      );
    }
    const body = JSON.parse(bodyText) as { urls?: string[] };
    if (!body.urls || !Array.isArray(body.urls)) {
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

    const tasks = body.urls.map((targetUrl: string) => async () => {
      if (!isValidUrl(targetUrl) || !isSafeUrl(targetUrl)) {
        return { url: targetUrl, error: "Invalid or blocked URL" };
      }
      try {
        const result = await convertUrl(targetUrl, env, host, "markdown", undefined, false, false);
        return {
          url: targetUrl,
          markdown: result.content,
          title: result.title,
          method: result.method,
          cached: result.cached,
        };
      } catch (e) {
        if (e instanceof ConvertError) {
          return { url: targetUrl, error: e.message };
        }
        console.error("Batch item failed:", targetUrl, e instanceof Error ? e.message : e);
        return { url: targetUrl, error: "Failed to process this URL." };
      }
    });

    const results = await pLimit(tasks, BROWSER_CONCURRENCY);
    const output = results.map((r) =>
      r.status === "fulfilled" ? r.value : { error: "Processing failed" },
    );

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
