import type { Env, OutputFormat, ConvertMethod } from "./types";
import {
  MAX_RESPONSE_BYTES,
  CORS_HEADERS,
  WECHAT_UA,
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.host;
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /api/batch — batch conversion
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
    if (path.startsWith("/img/")) {
      const imgUrl = decodeURIComponent(path.slice(5));
      if (!isValidUrl(imgUrl) || !isSafeUrl(imgUrl)) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const imgResp = await fetch(imgUrl, {
          headers: {
            Referer: new URL(imgUrl).origin + "/",
            "User-Agent": WECHAT_UA,
          },
        });
        const headers = new Headers(imgResp.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "public, max-age=86400");
        return new Response(imgResp.body, {
          status: imgResp.status,
          headers,
        });
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
      return new Response(
        errorPageHTML(
          "Invalid URL",
          `The URL "${escapeHtml(targetUrl)}" is not valid. Please provide a valid HTTP(S) URL.`,
        ),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    // SSRF protection
    if (!isSafeUrl(targetUrl)) {
      return new Response(
        errorPageHTML("Blocked", "Requests to internal or private addresses are not allowed."),
        { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    try {
      // Parse request parameters
      const acceptHeader = request.headers.get("Accept") || "";
      const wantsRaw =
        url.searchParams.get("raw") === "true" ||
        acceptHeader.split(",").some((part) => part.trim().split(";")[0] === "text/markdown");

      const format: OutputFormat =
        (url.searchParams.get("format") as OutputFormat) || (wantsRaw ? "markdown" : "markdown");
      const selector = url.searchParams.get("selector") || undefined;
      const forceBrowser = url.searchParams.get("force_browser") === "true";
      const noCache = url.searchParams.get("no_cache") === "true";

      // Check cache first
      if (!noCache) {
        const cached = await getCached(env, targetUrl, format);
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
          return new Response(
            errorPageHTML("Blocked", "Redirect target points to an internal or private address."),
            { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
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
        return new Response(
          errorPageHTML(
            "Fetch Failed",
            `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`,
          ),
          { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      let finalHtml = "";
      let method: ConvertMethod = "readability+turndown";

      if (staticFailed) {
        // Go straight to browser rendering
        try {
          finalHtml = await fetchWithBrowser(targetUrl, env);
          method = "browser+readability+turndown";
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(
            errorPageHTML(
              "Fetch Failed",
              `Static fetch returned ${response.status} and browser rendering also failed: ${msg}`,
            ),
            { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      } else {
        // Validate content type and size
        const contentType = response.headers.get("Content-Type") || "";
        if (
          !contentType.includes("text/") &&
          !contentType.includes("application/xhtml")
        ) {
          return new Response(
            errorPageHTML(
              "Unsupported Content",
              `This URL returned non-text content (${escapeHtml(contentType)}). Only HTML and text pages can be converted to Markdown.`,
            ),
            { status: 415, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }

        const contentLength = parseInt(
          response.headers.get("Content-Length") || "0",
          10,
        );
        if (contentLength > MAX_RESPONSE_BYTES) {
          return new Response(
            errorPageHTML("Content Too Large", "The target page exceeds the 5 MB size limit."),
            { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }

        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
          return new Response(
            errorPageHTML("Content Too Large", "The target page exceeds the 5 MB size limit."),
            { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } },
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
            });
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
            finalHtml = await fetchWithBrowser(targetUrl, env);
            method = "browser+readability+turndown";
          } catch (e) {
            console.error("Browser rendering failed, using static HTML:", e instanceof Error ? e.message : e);
            // Fall back to static HTML
          }
        }
      }

      // Enforce size limit on browser-rendered content
      if (new TextEncoder().encode(finalHtml).byteLength > MAX_RESPONSE_BYTES) {
        return new Response(
          errorPageHTML("Content Too Large", "The rendered page exceeds the 5 MB size limit."),
          { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      // Convert HTML to desired format
      let output: string;
      const { markdown, title } = htmlToMarkdown(finalHtml, targetUrl, selector);

      switch (format) {
        case "html":
          output = finalHtml;
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

      // Cache the result
      if (!noCache) {
        await setCache(env, targetUrl, format, {
          content: output,
          method,
          title,
        });
      }

      return buildResponse(output, targetUrl, host, method, format, wantsRaw, "", false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Conversion error:", { url: targetUrl, error: message });
      return new Response(
        errorPageHTML("Error", `Failed to process the URL: ${escapeHtml(message)}`),
        { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
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
        ...CORS_HEADERS,
      },
    });
  }

  return new Response(
    renderedPageHTML(host, content, sourceUrl, tokenCount, methodLabel, cached),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** Handle POST /api/batch — convert multiple URLs. */
async function handleBatch(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  try {
    const body = await request.json() as { urls?: string[] };
    if (!body.urls || !Array.isArray(body.urls)) {
      return Response.json({ error: "Request body must contain 'urls' array" }, { status: 400 });
    }

    if (body.urls.length > 10) {
      return Response.json({ error: "Maximum 10 URLs per batch" }, { status: 400 });
    }

    const results = await Promise.allSettled(
      body.urls.map(async (targetUrl: string) => {
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
            html = await fetchWithBrowser(targetUrl, env);
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
                html = await fetchWithBrowser(targetUrl, env);
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
      }),
    );

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
