import type { Env, OutputFormat, ConvertMethod } from "./types";
import {
  MAX_RESPONSE_BYTES,
  CORS_HEADERS,
  WECHAT_UA,
  VALID_FORMATS,
  BROWSER_CONCURRENCY,
} from "./config";
import {
  isSafeUrl,
  isValidUrl,
  needsBrowserRendering,
  extractTargetUrl,
  escapeHtml,
} from "./security";
import { htmlToMarkdown, htmlToText, proxyImageUrls } from "./converter";
import { fetchWithBrowser, alwaysNeedsBrowser } from "./browser";
import { getCached, setCache, getImage } from "./cache";
import { landingPageHTML } from "./templates/landing";
import { renderedPageHTML } from "./templates/rendered";
import { errorPageHTML } from "./templates/error";

/** Check if the request prefers JSON error responses. */
function wantsJsonError(request: Request): boolean {
  const accept = request.headers.get("Accept") || "";
  return (
    accept.includes("application/json") ||
    accept.includes("text/markdown")
  );
}

/** Return error as JSON or HTML depending on caller. */
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
    errorPageHTML(title, message),
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

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

    // POST /api/batch — batch conversion (requires auth)
    if (request.method === "POST" && path === "/api/batch") {
      return handleBatch(request, env, host);
    }

    // Only allow GET and HEAD for other routes
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Favicon
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Health check
    if (path === "/api/health") {
      return Response.json({ status: "ok", service: host });
    }

    // R2 image proxy — serve stored images
    if (path.startsWith("/r2img/")) {
      const key = path.slice(7); // strip "/r2img/"
      try {
        const img = await getImage(env, key);
        if (img) {
          return new Response(img.data as any, {
            headers: {
              "Content-Type": img.contentType,
              "Cache-Control": "public, max-age=86400",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      } catch {
        // Fall through to 404
      }
      return new Response("Not Found", { status: 404 });
    }

    // Legacy image proxy — rewrites Referer so hotlink-protected images load
    // P0-1 fix: use redirect:"manual" and validate each hop + content-type
    if (path.startsWith("/img/")) {
      const imgUrl = decodeURIComponent(path.slice(5));
      if (!isValidUrl(imgUrl) || !isSafeUrl(imgUrl)) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        let currentUrl = imgUrl;
        let imgResp: Response | null = null;
        // Follow redirects manually, validating each hop
        for (let hops = 0; hops < 5; hops++) {
          imgResp = await fetch(currentUrl, {
            headers: {
              Referer: new URL(currentUrl).origin + "/",
              "User-Agent": WECHAT_UA,
            },
            redirect: "manual",
          });
          if ([301, 302, 303, 307, 308].includes(imgResp.status)) {
            const location = imgResp.headers.get("Location");
            if (!location) break;
            const nextUrl = new URL(location, currentUrl).href;
            if (!isSafeUrl(nextUrl)) {
              return new Response("Redirect target blocked", { status: 403 });
            }
            currentUrl = nextUrl;
            continue;
          }
          break;
        }
        if (!imgResp || !imgResp.ok) {
          return new Response("Image fetch failed", { status: 502 });
        }
        // Validate content-type is actually an image
        const imgContentType = imgResp.headers.get("Content-Type") || "";
        if (!imgContentType.startsWith("image/")) {
          return new Response("Not an image", { status: 403 });
        }
        const headers = new Headers();
        headers.set("Content-Type", imgContentType);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "public, max-age=86400");
        return new Response(imgResp.body, { status: 200, headers });
      } catch {
        return new Response("Image fetch failed", { status: 502 });
      }
    }

    // Extract target URL from path
    const targetUrl = extractTargetUrl(path, url.search);

    // No target URL → landing page
    if (!targetUrl) {
      return new Response(landingPageHTML(host), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Validate target URL
    if (!isValidUrl(targetUrl)) {
      return errorResponse(
        "Invalid URL",
        `The URL "${escapeHtml(targetUrl)}" is not valid. Please provide a valid HTTP(S) URL.`,
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

      // Validate format parameter
      const rawFormat = url.searchParams.get("format") || "markdown";
      const format: OutputFormat = VALID_FORMATS.has(rawFormat)
        ? (rawFormat as OutputFormat)
        : "markdown";
      const selector = url.searchParams.get("selector") || undefined;
      const forceBrowser = url.searchParams.get("force_browser") === "true";
      const noCache = url.searchParams.get("no_cache") === "true";

      // Check cache first (include selector in cache key)
      if (!noCache) {
        const cached = await getCached(env, targetUrl, format, selector);
        if (cached) {
          return buildResponse(
            cached.content,
            targetUrl,
            host,
            cached.method as ConvertMethod,
            format,
            wantsRaw,
            "",
            true,
          );
        }
      }

      // Static fetch with manual redirect handling
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

      let response = await fetch(targetUrl, {
        headers: fetchHeaders,
        redirect: "manual",
      });

      // Follow up to 5 redirects, validating each hop
      let redirects = 0;
      while (
        redirects < 5 &&
        [301, 302, 303, 307, 308].includes(response.status)
      ) {
        const location = response.headers.get("Location");
        if (!location) break;
        const redirectUrl = new URL(location, targetUrl).href;
        if (!isSafeUrl(redirectUrl)) {
          return errorResponse(
            "Blocked",
            "Redirect target points to an internal or private address.",
            403,
            jsonErrors,
          );
        }
        response = await fetch(redirectUrl, {
          headers: fetchHeaders,
          redirect: "manual",
        });
        redirects++;
      }

      const staticFailed = !response.ok;

      // If static fetch failed and not a browser-required site, return error
      if (staticFailed && !forceBrowser && !alwaysNeedsBrowser(targetUrl)) {
        return errorResponse(
          "Fetch Failed",
          `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`,
          502,
          jsonErrors,
        );
      }

      let finalHtml = "";
      let method: ConvertMethod = "readability+turndown";

      if (staticFailed) {
        // Go straight to browser rendering
        try {
          finalHtml = await fetchWithBrowser(targetUrl, env, host);
          method = "browser+readability+turndown";
        } catch {
          return errorResponse(
            "Fetch Failed",
            `Static fetch returned ${response.status} and browser rendering also failed.`,
            502,
            jsonErrors,
          );
        }
      } else {
        // Validate content type — only accept HTML-like text content
        const contentType = response.headers.get("Content-Type") || "";
        const isTextContent = contentType.includes("text/html") ||
          contentType.includes("application/xhtml") ||
          contentType.includes("text/markdown") ||
          contentType.includes("text/plain");
        if (!isTextContent && !contentType.includes("text/")) {
          return errorResponse(
            "Unsupported Content",
            `This URL returned non-text content (${escapeHtml(contentType)}). Only HTML and text pages can be converted to Markdown.`,
            415,
            jsonErrors || wantsRaw,
          );
        }
        // Reject non-HTML text types that would confuse Readability
        if (
          contentType.includes("text/css") ||
          contentType.includes("text/javascript") ||
          contentType.includes("text/csv")
        ) {
          return errorResponse(
            "Unsupported Content",
            `This URL returned ${escapeHtml(contentType)} which cannot be converted to Markdown.`,
            415,
            jsonErrors || wantsRaw,
          );
        }

        const contentLength = parseInt(
          response.headers.get("Content-Length") || "0",
          10,
        );
        if (contentLength > MAX_RESPONSE_BYTES) {
          return errorResponse(
            "Content Too Large",
            "The target page exceeds the 5 MB size limit.",
            413,
            jsonErrors || wantsRaw,
          );
        }

        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
          return errorResponse(
            "Content Too Large",
            "The target page exceeds the 5 MB size limit.",
            413,
            jsonErrors || wantsRaw,
          );
        }

        const tokenCount = response.headers.get("x-markdown-tokens") || "";
        const isMarkdown = contentType.includes("text/markdown");

        // Native markdown path
        if (isMarkdown) {
          // Cache the native markdown
          if (!noCache) {
            await setCache(env, targetUrl, format, {
              content: body,
              method: "native",
              title: "",
            }, selector);
          }

          if (wantsRaw || format !== "markdown") {
            return new Response(body, {
              headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                "X-Source-URL": targetUrl,
                "X-Markdown-Tokens": tokenCount,
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          return new Response(
            renderedPageHTML(host, body, targetUrl, tokenCount, "native"),
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }

        // Check if browser rendering is needed
        finalHtml = body;
        if (
          forceBrowser ||
          needsBrowserRendering(body, targetUrl) ||
          alwaysNeedsBrowser(targetUrl)
        ) {
          try {
            finalHtml = await fetchWithBrowser(targetUrl, env, host);
            method = "browser+readability+turndown";
          } catch (e) {
            console.error("Browser rendering failed, using static HTML:", e instanceof Error ? e.message : e);
            // Fall back to static HTML
          }
        }
      }

      // Enforce size limit on browser-rendered content
      if (new TextEncoder().encode(finalHtml).byteLength > MAX_RESPONSE_BYTES) {
        return errorResponse(
          "Content Too Large",
          "The rendered page exceeds the 5 MB size limit.",
          413,
          jsonErrors || wantsRaw,
        );
      }

      // Convert HTML to desired format
      let output: string;
      const { markdown, title, contentHtml } = htmlToMarkdown(finalHtml, targetUrl, selector);

      switch (format) {
        case "html":
          // P0-2 fix: return Readability-processed content, NOT raw target HTML
          output = contentHtml;
          break;
        case "text":
          output = htmlToText(finalHtml, targetUrl);
          break;
        case "json":
          output = JSON.stringify({
            url: targetUrl,
            title,
            markdown,
            method,
            timestamp: new Date().toISOString(),
          });
          break;
        default:
          output = markdown;
      }

      // Rewrite hotlink-protected WeChat images
      if (
        format === "markdown" &&
        (targetUrl.includes("mmbiz.qpic.cn") ||
          targetUrl.includes("mp.weixin.qq.com"))
      ) {
        output = proxyImageUrls(output, host);
      }

      // Cache the result (include selector in cache key)
      if (!noCache) {
        await setCache(env, targetUrl, format, {
          content: output,
          method,
          title,
        }, selector);
      }

      return buildResponse(output, targetUrl, host, method, format, wantsRaw, "", false);
    } catch (err: unknown) {
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

/** Build the appropriate response based on format and raw preference. */
function buildResponse(
  content: string,
  sourceUrl: string,
  host: string,
  method: ConvertMethod,
  format: OutputFormat,
  wantsRaw: boolean,
  tokenCount: string,
  cached: boolean,
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
        "X-Source-URL": sourceUrl,
        "X-Markdown-Native": method === "native" ? "true" : "false",
        "X-Markdown-Method": method,
        "X-Cache-Status": cached ? "HIT" : "MISS",
        // Security headers for HTML format
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
    renderedPageHTML(host, content, sourceUrl, tokenCount, methodLabel, cached),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

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
  // Authentication check
  if (env.API_TOKEN) {
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ") || auth.slice(7) !== env.API_TOKEN) {
      return Response.json(
        { error: "Unauthorized", message: "Valid Bearer token required" },
        { status: 401, headers: CORS_HEADERS },
      );
    }
  }

  try {
    const body = await request.json() as { urls?: string[] };
    if (!body.urls || !Array.isArray(body.urls)) {
      return Response.json({ error: "Request body must contain 'urls' array" }, { status: 400 });
    }

    if (body.urls.length > 10) {
      return Response.json({ error: "Maximum 10 URLs per batch" }, { status: 400 });
    }

    // Build task list with concurrency control for browser rendering
    const tasks = body.urls.map((targetUrl: string) => async () => {
      if (!isValidUrl(targetUrl) || !isSafeUrl(targetUrl)) {
        return { url: targetUrl, error: "Invalid or blocked URL" };
      }

      // Check cache
      const cached = await getCached(env, targetUrl, "markdown");
      if (cached) {
        return {
          url: targetUrl,
          markdown: cached.content,
          title: cached.title,
          method: cached.method,
          cached: true,
        };
      }

      // Fetch and convert
      try {
        let html: string;
        let method: ConvertMethod = "readability+turndown";

        if (alwaysNeedsBrowser(targetUrl)) {
          html = await fetchWithBrowser(targetUrl, env, host);
          method = "browser+readability+turndown";
        } else {
          const resp = await fetch(targetUrl, {
            headers: {
              Accept: "text/markdown, text/html;q=0.9, */*;q=0.8",
              "User-Agent": `${host}/1.0 (Markdown Converter)`,
            },
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          html = await resp.text();

          if (needsBrowserRendering(html, targetUrl)) {
            try {
              html = await fetchWithBrowser(targetUrl, env, host);
              method = "browser+readability+turndown";
            } catch {
              // Use static HTML
            }
          }
        }

        const { markdown, title } = htmlToMarkdown(html, targetUrl);

        // Cache
        await setCache(env, targetUrl, "markdown", {
          content: markdown,
          method,
          title,
        });

        return { url: targetUrl, markdown, title, method, cached: false };
      } catch (e) {
        return {
          url: targetUrl,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    // Use concurrency limiter to prevent browser rendering session exhaustion
    const results = await pLimit(tasks, BROWSER_CONCURRENCY);

    const output = results.map((r) =>
      r.status === "fulfilled" ? r.value : { error: "Processing failed" },
    );

    return Response.json({ results: output }, {
      headers: CORS_HEADERS,
    });
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}
