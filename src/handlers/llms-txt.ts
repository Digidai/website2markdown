import { CORS_HEADERS } from "../config";

/**
 * Return the llms.txt content describing this API's capabilities.
 * Served at /llms.txt and /.well-known/llms.txt
 */
export function handleLlmsTxt(host: string): Response {
  const baseUrl = `https://${host}`;
  const content = `# ${host}

> URL-to-Markdown conversion API for AI agents and developers.
> Converts any web page to clean, structured Markdown with support for
> JavaScript-heavy sites, Chinese platforms, and paywalled content.

Converted pages on this host are temporary reading views of someone else's URL.
Cite the source URL. Do not cite ${baseUrl}/<url> as the original.

## Site
- Home: ${baseUrl}/
- Examples: ${baseUrl}/examples
- Docs: ${baseUrl}/docs
- Integrations: ${baseUrl}/integrations
- Machine-readable API card: ${baseUrl}/llms.txt
- Sitemap: ${baseUrl}/sitemap.xml

## API Endpoints

### Convert URL (GET)
GET ${baseUrl}/<url>
Preferred agent request:
  curl -H "Accept: text/markdown" ${baseUrl}/https://example.com
- Returns: Markdown content. Browsers that accept HTML get a reading page.
- The reading page is noindex. The canonical URL is the source.
- Params: ?format=markdown|html|text|json, ?selector=<css>, ?force_browser=true, ?no_cache=true, ?raw=true

### Streaming (GET)
GET ${baseUrl}/api/stream?url=<encoded-url>
- Returns: Server-Sent Events stream with conversion progress
- event: step  data: {"id": "fetch"|"analyze"|"browser"|"convert", "label": "<what is happening>"}. A retry can repeat an earlier step id.
- event: done  data: {"rawUrl", "title", "method", "tokenCount", "cached", "creditCost"}. GET rawUrl for the Markdown.
- event: fail  data: {"title", "message", "status", "code", "retryable", "hint"}
- The stream ends after done or fail. Do not let the client reconnect on its own: every connection starts a new conversion.

### Batch Convert (POST)
POST ${baseUrl}/api/batch
- Body: { "urls": ["url1", "url2", ...], "format": "markdown" }
- Returns: Array of conversion results

### Structured Extract (POST)
POST ${baseUrl}/api/extract
- Body: { "url": "...", "schema": { "fields": [...] } }
- Returns: Structured data extracted from the page

### Deep Crawl (POST)
POST ${baseUrl}/api/deepcrawl
- Body: { "seed": "https://example.com/docs", "max_depth": 3, "max_pages": 50, "stream": true }
- Returns: Crawled pages as Markdown. Requires an API key.

### Async Jobs (POST)
POST ${baseUrl}/api/jobs
- Body: { "tasks": [{ "url": "..." }] }
- Returns: Job ID for polling results

### Errors
A failed conversion returns JSON (send Accept: application/json or text/markdown):
  { "error": "Fetch Failed", "message": "...", "status": 502, "code": "target_not_found",
    "cause": "target", "retryable": false, "hint": "...", "target_status": 404 }
- cause: target (the link or the site), request (fix the request), account (key, quota, rate), service (our side; retry).
- retryable: whether the same request can succeed later. When false, change the URL instead of retrying.
- hint: what to try next. target_status: the site's own HTTP status, when it answered.
- Each failed batch result carries the same code, cause, retryable, and hint; extract results carry them under error, with the code in error.reason. Streaming sends them in its fail event.
- Codes:
  - target_not_found, target_gone: the page does not exist. Check the URL; do not retry.
  - target_forbidden: the site refused access (login, subscription, or no automated access).
  - target_blocked: the site refuses automated access. Retry later or use another source.
  - target_rate_limited: the site limits how often it can be read. Wait, then retry.
  - target_rejected: the site rejected this URL. Check its path and query parameters.
  - target_error, target_unreachable, target_timeout: the site is failing, down, or slow. Retry later.
  - target_unreadable: the page could not be read. Check it opens in a browser; retry later.
  - unsupported_content: not a web page (PDF, image, feed, API). Pass the page's URL. For PDF, Office, CSV, and image files, the hint points to DocParse (https://docparse.genedai.me/llms.txt), which converts the same URL to Markdown.
  - content_too_large: over 5 MB. Use a more specific URL.
  - no_content: the page has no readable text (empty, app shell, video).
  - invalid_request, blocked_address: fix the request; private addresses are not allowed.
  - auth_required, plan_required, quota_exceeded, rate_limited: account limits; see hint and Retry-After.
  - temporary_failure, internal_error: our side failed. Retry; report X-Request-ID if it persists.

### Health Check (GET)
GET ${baseUrl}/api/health
- Returns: Service status and metrics

### Usage (GET)
GET ${baseUrl}/api/usage
- Returns: Current tier, monthly quota, credits used, daily breakdown
- Auth: Bearer API key

## Developer Portal
Sign up at ${baseUrl}/portal/ with your email (passwordless Magic Link).
Manage API keys, track usage, see tier limits in real time.

## Supported Platforms
WeChat (微信公众号), Zhihu (知乎), Yuque (语雀), Feishu/Lark (飞书),
CSDN, Juejin (掘金), 36Kr, Toutiao (头条), NetEase (网易), Weibo (微博),
Reddit, Twitter/X, Notion, and any other public URL.

## Authentication and Tiers

Request an API key at ${baseUrl}/portal/. Authenticate with:
  Authorization: Bearer mk_...

Tiers:
- anonymous (no key): cache, direct fetch, and Readability. No browser and no extended fallbacks.
- free (1,000 credits/month): full pipeline, including extended fallbacks. A live browser render costs 3 credits. no_cache requires Pro.
- pro (50,000 credits/month): full pipeline plus more fallback paths, no_cache, and force_browser.

Credits: convert, stream, and batch are 1, or 3 when a live browser render succeeds. Cache hits stay at the route cost. Failures are not charged. Extract is priced at 3 and deepcrawl at 2 for the quota check; those routes do not write the monthly ledger.

Response headers on authenticated requests:
- X-RateLimit-Limit: monthly credit quota
- X-RateLimit-Remaining: credits left this period
- X-Request-Cost: credits this request consumed
- X-Quota-Exceeded: true when cached content is served past quota

## MCP Server
Install: npm install -g @digidai/mcp-website2markdown
Provides convert_url tool for Claude Desktop, Cursor, and other MCP clients.

## Source Code
Apache-2.0 licensed: https://github.com/Digidai/website2markdown
`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}

const LLMSTXT_CACHE_TTL = 86400; // 24 hours
const LLMSTXT_NEGATIVE_CACHE_TTL = 3600; // 1 hour for negative/error results
const LLMSTXT_FETCH_TIMEOUT = 5000; // 5 seconds

/**
 * Fetch and cache a target site's llms.txt. Returns the content or null.
 * Uses KV cache to avoid repeated fetches. Negative results are cached as "NONE".
 */
export async function fetchTargetLlmsTxt(
  kv: KVNamespace,
  targetUrl: string,
): Promise<string | null> {
  let domain: string;
  try {
    domain = new URL(targetUrl).hostname;
  } catch {
    return null;
  }

  const cacheKey = `llmstxt:${domain}`;

  // Check cache first
  const cached = await kv.get(cacheKey, "text");
  if (cached !== null) {
    return cached === "NONE" ? null : cached;
  }

  // Fetch from target domain
  const origin = new URL(targetUrl).origin;
  const urls = [
    `${origin}/llms.txt`,
    `${origin}/.well-known/llms.txt`,
  ];

  for (const llmsUrl of urls) {
    try {
      const resp = await fetch(llmsUrl, {
        headers: { "User-Agent": "website2markdown/1.0 (llms.txt discovery)" },
        signal: AbortSignal.timeout(LLMSTXT_FETCH_TIMEOUT),
        redirect: "error",
      });
      if (resp.ok) {
        const contentType = resp.headers.get("Content-Type") || "";
        if (contentType.includes("text/")) {
          const text = await resp.text();
          if (text.length > 0 && text.length < 100_000) {
            // Cache positive result
            await kv.put(cacheKey, text, { expirationTtl: LLMSTXT_CACHE_TTL });
            return text;
          }
        }
      }
    } catch {
      // Timeout or network error — continue to next URL
    }
  }

  // Cache negative result with shorter TTL to recover from transient errors
  await kv.put(cacheKey, "NONE", { expirationTtl: LLMSTXT_NEGATIVE_CACHE_TTL });
  return null;
}
