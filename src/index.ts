import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import puppeteer from "@cloudflare/puppeteer";

interface Env {
  MYBROWSER: Fetcher;
}

// Module-level singleton — avoids re-creating on every request
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});
turndown.addRule("strikethrough", {
  filter: ["del", "s"],
  replacement: (content) => `~~${content}~~`,
});

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

function needsBrowserRendering(html: string, url: string): boolean {
  const lower = html.toLowerCase();
  // WeChat articles always require JS to render the body content.
  // Even when static fetch bypasses the anti-bot page, the HTML is just
  // a shell — the actual article text is injected by client-side scripts.
  if (url.includes("mp.weixin.qq.com")) return true;
  // Common JS-challenge / CAPTCHA markers
  if (lower.includes("cf-challenge") || lower.includes("cf_chl_opt")) return true;
  if (lower.includes("captcha") && html.length < 10000) return true;
  // Very short page with JS redirect (likely anti-bot)
  if (html.length < 2000 && (lower.includes("document.location") || lower.includes("window.location"))) return true;
  return false;
}

// WeChat in-app browser UA — mp.weixin.qq.com checks for "MicroMessenger"
const WECHAT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2f) " +
  "NetType/WIFI Language/zh_CN";

// Generic mobile UA for other sites that block headless Chrome
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

async function fetchWithBrowser(url: string, env: Env): Promise<string> {
  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();

    // Pick the right UA based on the target site
    const ua = url.includes("mp.weixin.qq.com") ? WECHAT_UA : MOBILE_UA;
    await page.setUserAgent(ua);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });

    // P1 fix: intercept every request so redirects to private/internal
    // addresses are blocked, matching the SSRF protection on the static path.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const reqUrl = req.url();
      if (!isSafeUrl(reqUrl)) {
        req.abort("accessdenied");
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Some pages load content lazily — give a short extra wait
    await new Promise((r) => setTimeout(r, 2000));

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

function htmlToMarkdown(html: string, url: string): { markdown: string; title: string } {
  // Wrap in <html><head></head><body>...</body></html> to guarantee
  // linkedom always has a documentElement, head, and body — prevents
  // crashes on plain-text or fragment responses.
  const wrappedHtml = html.includes("<html") ? html : `<html><head></head><body>${html}</body></html>`;
  const { document } = parseHTML(wrappedHtml);

  // Set <base> for Readability to resolve relative links
  try {
    const existingBase = document.querySelector("base");
    if (existingBase) {
      existingBase.href = url;
    } else if (document.head) {
      const base = document.createElement("base");
      base.href = url;
      document.head.appendChild(base);
    }
  } catch {
    // Ignore if head is not available
  }

  // Try Readability to extract main content
  let contentHtml = html;
  let title = "";
  try { title = document.title || ""; } catch { /* no title */ }
  try {
    const reader = new Readability(document.cloneNode(true) as any);
    const article = reader.parse();
    if (article && article.content) {
      contentHtml = article.content;
      title = article.title || title;
    }
  } catch {
    // Readability failed, fall through to convert full HTML
  }

  // Parse content into DOM so Turndown receives a node (not a string).
  // This avoids Turndown calling global `document.implementation` which
  // doesn't exist in Workers.
  const { document: contentDoc } = parseHTML(
    `<html><body>${contentHtml}</body></html>`
  );
  let markdown = turndown.turndown(contentDoc.body as unknown as HTMLElement);

  // Prepend title as H1 if available and not already present
  if (title && !markdown.includes(`# ${title}`)) {
    markdown = `# ${title}\n\n${markdown}`;
  }

  return { markdown, title };
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1") return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) return false;
    if (hostname === "169.254.169.254") return false;
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    return true;
  } catch {
    return false;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.host;
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Only allow GET and HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Handle favicon
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Handle API health check
    if (path === "/api/health") {
      return Response.json({ status: "ok", service: host });
    }

    // Extract target URL from path
    const targetUrl = extractTargetUrl(path, url.search);

    // If no target URL, show landing page
    if (!targetUrl) {
      return new Response(landingPageHTML(host), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Validate target URL
    if (!isValidUrl(targetUrl)) {
      return new Response(errorPageHTML("Invalid URL", `The URL "${targetUrl}" is not valid. Please provide a valid HTTP(S) URL.`), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // SSRF protection — block internal/private addresses
    if (!isSafeUrl(targetUrl)) {
      return new Response(errorPageHTML("Blocked", "Requests to internal or private addresses are not allowed."), {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    try {
      // Determine if caller wants raw markdown
      const acceptHeader = request.headers.get("Accept") || "";
      const wantsRaw =
        url.searchParams.get("raw") === "true" ||
        acceptHeader.split(",").some(part => part.trim().split(";")[0] === "text/markdown");

      // Fetch with manual redirect to validate each hop against SSRF
      // Use WeChat in-app UA for mp.weixin.qq.com so static fetch has the
      // best chance of getting real content without needing browser rendering.
      const isWechat = targetUrl.includes("mp.weixin.qq.com");
      const fetchHeaders: Record<string, string> = {
        "Accept": "text/markdown, text/html;q=0.9, */*;q=0.8",
        "User-Agent": isWechat ? WECHAT_UA : `${host}/1.0 (Markdown Converter)`,
      };
      if (isWechat) {
        fetchHeaders["Accept-Language"] = "zh-CN,zh;q=0.9,en;q=0.8";
        fetchHeaders["Referer"] = "https://mp.weixin.qq.com/";
      }
      let response = await fetch(targetUrl, { headers: fetchHeaders, redirect: "manual" });

      // Follow up to 5 redirects, validating each destination
      let redirects = 0;
      while (redirects < 5 && [301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        if (!location) break;
        const redirectUrl = new URL(location, targetUrl).href;
        if (!isSafeUrl(redirectUrl)) {
          return new Response(
            errorPageHTML("Blocked", "Redirect target points to an internal or private address."),
            { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        response = await fetch(redirectUrl, { headers: fetchHeaders, redirect: "manual" });
        redirects++;
      }

      if (!response.ok) {
        return new Response(
          errorPageHTML(
            "Fetch Failed",
            `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`
          ),
          {
            status: 502,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        );
      }

      // Reject non-text content (PDFs, images, videos, etc.)
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes("text/") && !contentType.includes("application/xhtml")) {
        return new Response(
          errorPageHTML("Unsupported Content", `This URL returned non-text content (${contentType}). Only HTML and text pages can be converted to Markdown.`),
          { status: 415, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      // Reject oversized responses
      const contentLength = parseInt(response.headers.get("Content-Length") || "0", 10);
      if (contentLength > MAX_RESPONSE_BYTES) {
        return new Response(
          errorPageHTML("Content Too Large", "The target page exceeds the 5 MB size limit."),
          { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        return new Response(
          errorPageHTML("Content Too Large", "The target page exceeds the 5 MB size limit."),
          { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      const tokenCount = response.headers.get("x-markdown-tokens") || "";
      const isMarkdown = contentType.includes("text/markdown");
      const forceBrowser = url.searchParams.get("force_browser") === "true";

      // If the site returned markdown directly (supports Markdown for Agents)
      if (isMarkdown) {
        if (wantsRaw) {
          return new Response(body, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "X-Source-URL": targetUrl,
              "X-Markdown-Tokens": tokenCount,
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
        return new Response(renderedPageHTML(host, body, targetUrl, tokenCount, "native"), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Check if the static fetch returned an anti-bot/JS-required page
      let finalHtml = body;
      let method = "readability+turndown";

      if (forceBrowser || needsBrowserRendering(body, targetUrl)) {
        try {
          finalHtml = await fetchWithBrowser(targetUrl, env);
          method = "browser+readability+turndown";
        } catch {
          // Browser rendering failed — fall back to static HTML
        }
      }

      // P2 fix: enforce the same 5 MB size limit on browser-rendered content
      if (new TextEncoder().encode(finalHtml).byteLength > MAX_RESPONSE_BYTES) {
        return new Response(
          errorPageHTML("Content Too Large", "The rendered page exceeds the 5 MB size limit."),
          { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      const { markdown } = htmlToMarkdown(finalHtml, targetUrl);

      if (wantsRaw) {
        return new Response(markdown, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "X-Source-URL": targetUrl,
            "X-Markdown-Native": "false",
            "X-Markdown-Method": method,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      return new Response(
        renderedPageHTML(host, markdown, targetUrl, "", method === "browser+readability+turndown" ? "browser" : "fallback"),
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        errorPageHTML("Error", `Failed to process the URL: ${message}`),
        {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }
      );
    }
  },
};

function extractTargetUrl(path: string, search: string): string | null {
  // Remove leading slash
  let raw = path.slice(1);
  if (!raw) return null;

  // The target URL might not have a protocol prefix
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    // Check if it looks like a domain
    if (raw.includes(".") && !raw.startsWith(".")) {
      raw = "https://" + raw;
    } else {
      return null;
    }
  }

  // Re-attach the original query string if the target URL doesn't have one
  // but exclude our own parameters (raw, force_browser)
  const targetSearchParams = new URLSearchParams(search);
  targetSearchParams.delete("raw");
  targetSearchParams.delete("force_browser");
  const remainingSearch = targetSearchParams.toString();

  if (remainingSearch && !raw.includes("?")) {
    raw += "?" + remainingSearch;
  }

  return raw;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function landingPageHTML(host: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(host)} - Convert Any URL to Markdown</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .hero {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      text-align: center;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 1rem;
      background: rgba(249, 115, 22, 0.1);
      border: 1px solid rgba(249, 115, 22, 0.3);
      border-radius: 999px;
      font-size: 0.8rem;
      color: #f97316;
      margin-bottom: 2rem;
    }

    h1 {
      font-size: clamp(2.5rem, 6vw, 4.5rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: 1.5rem;
      background: linear-gradient(135deg, #fff 0%, #a3a3a3 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    h1 span {
      background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .subtitle {
      font-size: 1.2rem;
      color: #737373;
      max-width: 600px;
      line-height: 1.6;
      margin-bottom: 3rem;
    }

    .input-group {
      display: flex;
      width: 100%;
      max-width: 700px;
      background: #171717;
      border: 1px solid #262626;
      border-radius: 16px;
      overflow: hidden;
      transition: border-color 0.2s;
    }

    .input-group:focus-within {
      border-color: #f97316;
    }

    .input-prefix {
      display: flex;
      align-items: center;
      padding: 0 0 0 1.25rem;
      color: #f97316;
      font-size: 0.95rem;
      font-weight: 600;
      white-space: nowrap;
      user-select: none;
    }

    .input-group input {
      flex: 1;
      padding: 1.1rem 1rem;
      background: transparent;
      border: none;
      outline: none;
      color: #e5e5e5;
      font-size: 0.95rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
    }

    .input-group input::placeholder {
      color: #525252;
    }

    .input-group button {
      padding: 0 1.5rem;
      background: #f97316;
      border: none;
      color: #fff;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.2s;
    }

    .input-group button:hover {
      background: #ea580c;
    }

    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
      width: 100%;
      max-width: 900px;
      margin-top: 4rem;
    }

    .feature {
      padding: 1.5rem;
      background: #171717;
      border: 1px solid #262626;
      border-radius: 12px;
    }

    .feature-icon {
      width: 40px;
      height: 40px;
      background: rgba(249, 115, 22, 0.1);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      margin-bottom: 1rem;
    }

    .feature h3 {
      font-size: 1rem;
      font-weight: 600;
      color: #e5e5e5;
      margin-bottom: 0.5rem;
    }

    .feature p {
      font-size: 0.85rem;
      color: #737373;
      line-height: 1.5;
    }

    .how-it-works {
      width: 100%;
      max-width: 900px;
      margin-top: 4rem;
    }

    .how-it-works h2 {
      font-size: 1.5rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 2rem;
      color: #e5e5e5;
    }

    .steps {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      justify-content: center;
    }

    .step {
      flex: 1;
      min-width: 200px;
      max-width: 280px;
      padding: 1.5rem;
      background: #171717;
      border: 1px solid #262626;
      border-radius: 12px;
      text-align: center;
    }

    .step-number {
      width: 32px;
      height: 32px;
      background: rgba(249, 115, 22, 0.15);
      color: #f97316;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }

    .step h3 {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .step p {
      font-size: 0.8rem;
      color: #737373;
      line-height: 1.5;
    }

    .example-box {
      margin-top: 3rem;
      width: 100%;
      max-width: 900px;
      padding: 1.5rem;
      background: #171717;
      border: 1px solid #262626;
      border-radius: 12px;
    }

    .example-box h3 {
      font-size: 0.85rem;
      color: #737373;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }

    .example-url {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85rem;
      color: #a3a3a3;
      padding: 1rem;
      background: #0a0a0a;
      border-radius: 8px;
      overflow-x: auto;
      cursor: pointer;
      transition: background 0.2s;
    }

    .example-url:hover {
      background: #1a1a1a;
    }

    .example-url .prefix {
      color: #f97316;
    }

    footer {
      text-align: center;
      padding: 2rem;
      color: #525252;
      font-size: 0.8rem;
    }

    footer a {
      color: #f97316;
      text-decoration: none;
    }

    .input-hint {
      margin-top: 0.75rem;
      font-size: 0.8rem;
      color: #525252;
    }

    @media (max-width: 640px) {
      .input-prefix { display: none; }
      .input-group input { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="hero">
    <div class="badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      Powered by Cloudflare Markdown for Agents
    </div>

    <h1>Any URL to <span>Markdown</span><br>in one click</h1>

    <p class="subtitle">
      Prepend <strong>${escapeHtml(host)}/</strong> to any URL and get clean, readable Markdown.
      Perfect for AI agents, LLMs, and developers.
    </p>

    <form class="input-group" id="urlForm" onsubmit="return handleSubmit(event)">
      <div class="input-prefix">${escapeHtml(host)}/</div>
      <input
        type="text"
        id="urlInput"
        placeholder="example.com or https://example.com/page"
        autocomplete="off"
        autofocus
      />
      <button type="submit">Convert</button>
    </form>
    <p class="input-hint">Supports bare domains, http:// and https:// URLs</p>

    <div class="features">
      <div class="feature">
        <div class="feature-icon">MD</div>
        <h3>Any Website</h3>
        <p>Works on every site. Uses native Markdown for Agents when available, falls back to Readability + Turndown.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">{}</div>
        <h3>API Ready</h3>
        <p>Add <code>?raw=true</code> or send <code>Accept: text/markdown</code> header to get raw markdown response.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">&lt;/&gt;</div>
        <h3>Zero Config</h3>
        <p>No API keys, no signup. Just prepend the URL and get markdown instantly.</p>
      </div>
    </div>

    <div class="how-it-works">
      <h2>How It Works</h2>
      <div class="steps">
        <div class="step">
          <div class="step-number">1</div>
          <h3>Prepend URL</h3>
          <p>Add <strong>${escapeHtml(host)}/</strong> before any URL you want to convert.</p>
        </div>
        <div class="step">
          <div class="step-number">2</div>
          <h3>We Fetch</h3>
          <p>We request the page with <code>Accept: text/markdown</code> header via Cloudflare edge.</p>
        </div>
        <div class="step">
          <div class="step-number">3</div>
          <h3>Get Markdown</h3>
          <p>Receive clean, formatted Markdown — rendered beautifully or as raw text.</p>
        </div>
      </div>
    </div>

    <div class="example-box">
      <h3>Try an example</h3>
      <div class="example-url" onclick="window.location.href='/https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/'">
        <span class="prefix">${escapeHtml(host)}/</span>https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
      </div>
    </div>
  </div>

  <footer>
    Built with Cloudflare Workers &mdash; <a href="https://blog.cloudflare.com/markdown-for-agents/" target="_blank">Learn about Markdown for Agents</a>
  </footer>

  <script>
    function handleSubmit(e) {
      e.preventDefault();
      const input = document.getElementById('urlInput').value.trim();
      if (!input) return false;
      // Support: "example.com", "http://example.com", "https://example.com"
      // Bare domains go directly to path — backend auto-prepends https://
      window.location.href = '/' + input;
      return false;
    }
  </script>
</body>
</html>`;
}

function renderedPageHTML(host: string, content: string, sourceUrl: string, tokenCount: string, method: "native" | "fallback" | "browser"): string {
  const escapedContent = escapeHtml(content);
  const statusLabels: Record<string, string> = {
    native: '<span class="status native">Native Markdown</span>',
    fallback: '<span class="status fallback">Converted via Readability + Turndown</span>',
    browser: '<span class="status browser">Rendered via Browser</span>',
  };
  const statusLabel = statusLabels[method];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MD - ${escapeHtml(sourceUrl)}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.8.1/github-markdown-dark.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      background: rgba(10, 10, 10, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid #262626;
    }

    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 1rem;
      min-width: 0;
    }

    .toolbar .logo {
      font-weight: 800;
      font-size: 1rem;
      color: #f97316;
      text-decoration: none;
      white-space: nowrap;
    }

    .toolbar .source-url {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      color: #737373;
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar .source-url:hover {
      color: #a3a3a3;
    }

    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    .status {
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .status.native {
      background: rgba(34, 197, 94, 0.1);
      color: #22c55e;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }

    .status.fallback {
      background: rgba(234, 179, 8, 0.1);
      color: #eab308;
      border: 1px solid rgba(234, 179, 8, 0.3);
    }

    .status.browser {
      background: rgba(99, 102, 241, 0.1);
      color: #818cf8;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }

    .token-count {
      font-size: 0.75rem;
      color: #525252;
      white-space: nowrap;
    }

    .btn {
      padding: 0.4rem 0.9rem;
      border-radius: 8px;
      border: 1px solid #333;
      background: #171717;
      color: #e5e5e5;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .btn:hover {
      background: #262626;
      border-color: #404040;
    }

    .btn-primary {
      background: #f97316;
      border-color: #f97316;
      color: #fff;
    }

    .btn-primary:hover {
      background: #ea580c;
    }

    .content-area {
      display: flex;
      min-height: calc(100vh - 52px);
    }

    .tab-bar {
      display: flex;
      gap: 0;
      padding: 1rem 2rem 0;
      background: #0a0a0a;
    }

    .tab {
      padding: 0.6rem 1.2rem;
      font-size: 0.85rem;
      color: #737373;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
    }

    .tab.active {
      color: #f97316;
      border-bottom-color: #f97316;
    }

    .tab:hover:not(.active) {
      color: #a3a3a3;
    }

    .panel {
      display: none;
      padding: 2rem;
      max-width: 900px;
      margin: 0 auto;
      width: 100%;
    }

    .panel.active {
      display: block;
    }

    .markdown-body {
      background: transparent !important;
      font-size: 15px;
    }

    .raw-content {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85rem;
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
      color: #a3a3a3;
      background: #171717;
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid #262626;
    }

    @media (max-width: 768px) {
      .toolbar { padding: 0.5rem 1rem; flex-wrap: wrap; }
      .toolbar .source-url { display: none; }
      .panel { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <a href="/" class="logo">${escapeHtml(host)}</a>
      <a href="${escapeHtml(sourceUrl)}" class="source-url" target="_blank">${escapeHtml(sourceUrl)}</a>
    </div>
    <div class="toolbar-right">
      ${statusLabel}
      ${tokenCount ? '<span class="token-count">' + escapeHtml(tokenCount) + ' tokens</span>' : ''}
      <button class="btn" onclick="copyRaw()">Copy Raw</button>
      <a href="/${escapeHtml(sourceUrl)}${sourceUrl.includes('?') ? '&' : '?'}raw=true" class="btn btn-primary" target="_blank">Raw API</a>
    </div>
  </div>

  <div class="tab-bar">
    <div class="tab active" onclick="switchTab('rendered')">Rendered</div>
    <div class="tab" onclick="switchTab('source')">Source</div>
  </div>

  <div class="panel active" id="rendered-panel">
    <div class="markdown-body" id="markdown-rendered"></div>
  </div>

  <div class="panel" id="source-panel">
    <div class="raw-content" id="raw-content">${escapedContent}</div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js"></script>
  <script>
    const rawContent = document.getElementById('raw-content').textContent;

    // Sanitize rendered HTML to prevent XSS from untrusted markdown/HTML
    document.getElementById('markdown-rendered').innerHTML = DOMPurify.sanitize(marked.parse(rawContent));

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

      if (tab === 'rendered') {
        document.querySelectorAll('.tab')[0].classList.add('active');
        document.getElementById('rendered-panel').classList.add('active');
      } else {
        document.querySelectorAll('.tab')[1].classList.add('active');
        document.getElementById('source-panel').classList.add('active');
      }
    }

    function copyRaw() {
      navigator.clipboard.writeText(rawContent).then(() => {
        const btn = document.querySelector('.btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Raw', 2000);
      });
    }
  </script>
</body>
</html>`;
}

function errorPageHTML(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .error-card {
      max-width: 500px;
      padding: 2.5rem;
      background: #171717;
      border: 1px solid #262626;
      border-radius: 16px;
      text-align: center;
    }
    .error-icon {
      width: 48px;
      height: 48px;
      background: rgba(239, 68, 68, 0.1);
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.75rem; }
    p { color: #737373; line-height: 1.6; margin-bottom: 1.5rem; }
    a {
      display: inline-block;
      padding: 0.6rem 1.5rem;
      background: #f97316;
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
    }
    a:hover { background: #ea580c; }
  </style>
</head>
<body>
  <div class="error-card">
    <div class="error-icon">!</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">Back to Home</a>
  </div>
</body>
</html>`;
}

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
};
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
}
