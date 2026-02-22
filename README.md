# URL to Markdown Converter

A Cloudflare Worker that converts **any** web page to clean Markdown. Supports three conversion paths — [Cloudflare Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/) (native), [Readability](https://github.com/mozilla/readability) + [Turndown](https://github.com/mixmark-io/turndown) (fallback), and [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) for anti-bot/JS-heavy pages.

Prepend your domain before any URL and get instant Markdown output. No signup required, and API auth is optional/configurable.

## How It Works

```
https://<your-worker-domain>/<target-url>
```

### Three-Tier Conversion Flow

```
Request
  │
  ▼
Fetch target with Accept: text/markdown
  │
  ├─ Response is text/markdown? ──▶ Path 1: Native Markdown
  │
  └─ Response is text/html?
       │
       ├─ Anti-bot / JS-required detected? ──▶ Path 3: Browser Rendering → Readability + Turndown
       │
       └─ Normal HTML ──▶ Path 2: Readability + Turndown
```

| Path | When | How | `X-Markdown-Method` |
|---|---|---|---|
| **Native** | Target site supports Markdown for Agents | Cloudflare edge converts via `Accept: text/markdown` content negotiation | `native` |
| **Fallback** | Normal HTML pages | Readability extracts main content → Turndown converts to Markdown | `readability+turndown` |
| **Browser** | Anti-bot pages, JS-rendered content | Headless Chrome renders the page → Readability + Turndown | `browser+readability+turndown` |

## API Usage

### Browser (URL bar)

```
# Full URL
https://md.genedai.me/https://example.com/page

# Bare domain (auto-prepends https://)
https://md.genedai.me/example.com/page
```

### Raw Markdown API

```bash
# Get raw Markdown via query param
curl "https://md.genedai.me/https://example.com/page?raw=true"

# Get raw Markdown via Accept header
curl https://md.genedai.me/https://example.com/page \
  -H "Accept: text/markdown"
```

### Optional API Token Protection

If `PUBLIC_API_TOKEN` is configured, API-style requests require a token:

```bash
# Header token
curl "https://md.genedai.me/https://example.com/page?raw=true" \
  -H "Authorization: Bearer <public-token>"

# Query token (useful for /api/stream EventSource)
curl "https://md.genedai.me/api/stream?url=https%3A%2F%2Fexample.com%2Fpage&token=<public-token>"
```

### Output Formats

```bash
# Markdown (default)
curl "https://md.genedai.me/https://example.com?format=markdown&raw=true"

# Clean HTML
curl "https://md.genedai.me/https://example.com?format=html&raw=true"

# Plain text (no formatting)
curl "https://md.genedai.me/https://example.com?format=text&raw=true"

# JSON (structured: url, title, markdown, method, timestamp)
curl "https://md.genedai.me/https://example.com?format=json&raw=true"
```

### CSS Selector Extraction

Extract specific page elements instead of the full article:

```bash
# Extract only the article body
curl "https://md.genedai.me/https://example.com?selector=.article-body&raw=true"

# Extract a specific section
curl "https://md.genedai.me/https://example.com?selector=%23main-content&raw=true"
```

> `selector` maximum length is `256` characters.

### Force Browser Rendering

```bash
curl "https://md.genedai.me/https://example.com/js-heavy-page?raw=true&force_browser=true"
```

### Cache Control

Results are cached in KV for fast repeat access. To bypass cache:

```bash
curl "https://md.genedai.me/https://example.com?raw=true&no_cache=true"
```

### Batch Conversion

Convert multiple URLs in a single request:

```bash
curl -X POST https://md.genedai.me/api/batch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com/page1",
      {
        "url": "https://example.com/page2",
        "format": "text",
        "selector": "article",
        "force_browser": false,
        "no_cache": true
      }
    ]
  }'
```

`urls` supports:
- String item: `"https://example.com/a"` (defaults to markdown)
- Object item: `{ "url": "...", "format?": "markdown|html|text|json", "selector?": "...", "force_browser?": boolean, "no_cache?": boolean }`

Response:
```json
{
  "results": [
    {
      "url": "...",
      "format": "markdown",
      "content": "...",
      "markdown": "...",
      "title": "...",
      "method": "...",
      "cached": false,
      "fallbacks": ["jsonld"]
    },
    {
      "url": "...",
      "format": "text",
      "content": "...",
      "title": "...",
      "method": "...",
      "cached": true
    }
  ]
}
```

### Supported Sites

Special adapters for optimal extraction on these platforms:

| Site | Features |
|---|---|
| **WeChat** (`mp.weixin.qq.com`) | MicroMessenger UA, image proxy for hotlink bypass |
| **Feishu/Lark** (`.feishu.cn`, `.larksuite.com`) | Virtual scroll handling, base64 image embedding, UI noise removal |
| **Zhihu** (`zhihu.com/p/`) | Login wall removal, lazy image swap |
| **Yuque** (`yuque.com`) | SPA rendering, sidebar/toc removal |
| **Notion** (`notion.site`, `notion.so`) | SPA rendering, lazy scroll loading |
| **Juejin** (`juejin.cn/post/`) | Login popup removal, code block expansion |
| **All other sites** | Generic mobile UA, lazy image handling |

### JavaScript / TypeScript

```ts
const res = await fetch(
  "https://md.genedai.me/https://example.com/page?raw=true"
);
const markdown = await res.text();
console.log(res.headers.get("X-Markdown-Method"));
console.log(res.headers.get("X-Cache-Status")); // "HIT" or "MISS"
```

### Python

```python
import requests

url = "https://md.genedai.me/https://example.com/page"
resp = requests.get(url, params={"raw": "true", "format": "json"})
data = resp.json()
print(data["title"], data["method"])
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Landing page with URL input form |
| `/<url>` | GET | Convert URL and render Markdown as HTML page |
| `/<url>?raw=true` | GET | Return raw Markdown as plain text |
| `/<url>?format=json` | GET | Return structured JSON (url, title, markdown, method) |
| `/<url>?format=html` | GET | Return cleaned HTML |
| `/<url>?format=text` | GET | Return plain text (no formatting) |
| `/<url>?selector=.class` | GET | Extract specific CSS selector |
| `/<url>?force_browser=true` | GET | Force browser rendering |
| `/<url>?no_cache=true` | GET | Bypass KV cache |
| `/api/stream?url=<encoded-url>` | GET | SSE conversion stream (`step`, `done`, `fail`) |
| `/api/batch` | POST | Batch convert multiple URLs (max 10) |
| `/img/<encoded-url>` | GET | Image proxy (bypasses hotlink protection) |
| `/r2img/<key>` | GET | Serve image from R2 storage |
| `/api/health` | GET | Health + runtime metrics + browser queue snapshot |

## Response Headers (Raw API)

| Header | Description |
|---|---|
| `Content-Type` | `text/markdown`, `application/json`, `text/html`, or `text/plain` |
| `X-Source-URL` | The original target URL |
| `X-Markdown-Tokens` | Token count (native Markdown for Agents only) |
| `X-Markdown-Native` | `"true"` when native, `"false"` otherwise |
| `X-Markdown-Method` | `"native"`, `"readability+turndown"`, or `"browser+readability+turndown"` |
| `X-Cache-Status` | `"HIT"` or `"MISS"` |
| `X-Markdown-Fallbacks` | Comma-separated fallback list (when used) |
| `X-Browser-Rendered` | `"true"` when browser rendering path was used |
| `X-Paywall-Detected` | `"true"` when paywall heuristics were triggered |
| `Retry-After` / `X-RateLimit-*` | Present on `429` responses |
| `Access-Control-Allow-Origin` | `*` — CORS enabled |

## Features

| Feature | Description |
|---|---|
| **Any Website** | Works on every site with three conversion paths |
| **Site Adapters** | Specialized extractors for WeChat, Feishu, Zhihu, Yuque, Notion, Juejin |
| **Anti-Bot Bypass** | Browser Rendering handles JS challenges, CAPTCHAs, and verification |
| **KV Cache** | Results cached for instant repeat access |
| **R2 Image Storage** | Images stored reliably, served via proxy URLs |
| **Multiple Formats** | Markdown, HTML, text, or structured JSON output |
| **CSS Selectors** | Target specific page elements for extraction |
| **Batch API v2** | Convert up to 10 URLs with per-item format/selector/browser/cache options |
| **Table Support** | Improved handling of simple and complex tables |
| **Smart Extraction** | Readability strips nav, ads, sidebars — extracts main article content |
| **Rendered View** | Dark-themed Markdown preview with GitHub CSS and tab switching |
| **SSRF Protection** | Blocks private IPs, IPv6 link-local, cloud metadata endpoints |
| **Timeout Protection** | Time-budgeted scrolling for Feishu virtual scroll documents |
| **Built-in Rate Limiting** | Per-IP limits for conversion, stream, and batch routes |
| **Runtime Paywall Rules** | Support dynamic paywall rule updates via env/KV JSON |
| **Operational Health** | `/api/health` exposes runtime counters and browser queue stats |

## Tech Stack

| Component | Role |
|---|---|
| [Cloudflare Workers](https://workers.cloudflare.com/) | Edge runtime — global deployment |
| [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) | Headless Chrome for JS-heavy/anti-bot pages |
| [Cloudflare KV](https://developers.cloudflare.com/kv/) | Edge key-value cache for converted content |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) | Object storage for images |
| [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/) | Native HTML→Markdown at edge |
| [@mozilla/readability](https://github.com/mozilla/readability) | Article content extraction (Firefox Reader View) |
| [Turndown](https://github.com/mixmark-io/turndown) | HTML→Markdown conversion |
| [@cloudflare/puppeteer](https://github.com/nichochar/puppeteer) | Puppeteer API for Browser Rendering |
| [LinkeDOM](https://github.com/WebReflection/linkedom) | Lightweight DOM for Workers |
| [Vitest](https://vitest.dev/) | Unit testing framework |

## Project Structure

```
md-genedai/
├── src/
│   ├── index.ts              # Worker entry: routing, fetch handler, batch API
│   ├── types.ts              # TypeScript interfaces (Env, SiteAdapter, etc.)
│   ├── config.ts             # Constants: timeouts, limits, UA strings
│   ├── security.ts           # SSRF validation, URL parsing, XSS escaping
│   ├── converter.ts          # Readability + Turndown conversion, image proxy
│   ├── browser/
│   │   ├── index.ts          # Browser launcher, adapter registry
│   │   └── adapters/
│   │       ├── feishu.ts     # Feishu/Lark: virtual scroll, image capture
│   │       ├── wechat.ts     # WeChat: MicroMessenger UA, lazy images
│   │       ├── zhihu.ts      # Zhihu: login wall removal
│   │       ├── yuque.ts      # Yuque: SPA rendering
│   │       ├── notion.ts     # Notion: SPA + lazy scroll
│   │       ├── juejin.ts     # Juejin: popup removal, code blocks
│   │       └── generic.ts    # Fallback for all other sites
│   ├── cache/
│   │   └── index.ts          # KV cache + R2 image storage
│   ├── templates/
│   │   ├── landing.ts        # Landing page HTML
│   │   ├── rendered.ts       # Markdown preview page HTML
│   │   └── error.ts          # Error page HTML
│   └── __tests__/
│       ├── security.test.ts  # SSRF, URL validation, escaping tests
│       ├── converter.test.ts # HTML→Markdown conversion tests
│       └── adapters.test.ts  # Site adapter matching tests
├── package.json
├── wrangler.toml             # Worker config: browser, KV, R2 bindings
├── tsconfig.json
├── vitest.config.ts
└── .gitignore
```

## Deployment

This project uses **Cloudflare Git Integration** — push to `main` and Cloudflare automatically builds and deploys.

### Setup (one-time)

1. Fork or push this repo to GitHub
2. Create required resources:
   ```bash
   # Create KV namespace
   wrangler kv namespace create CACHE_KV
   # Update the namespace ID in wrangler.toml

   # Create R2 bucket
   wrangler r2 bucket create md-images
   ```
3. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) > **Workers & Pages** > **Create** > **Import a Git repository**
4. Select the GitHub repo — Cloudflare will deploy automatically on every push to `main`

### Secrets / Runtime Variables

```bash
# Required for /api/batch
wrangler secret put API_TOKEN

# Optional: protect raw API and /api/stream
wrangler secret put PUBLIC_API_TOKEN

# Optional: dynamic paywall rules (JSON array)
wrangler secret put PAYWALL_RULES_JSON
```

Optional KV-driven paywall rule source:

- Set `PAYWALL_RULES_KV_KEY` (plain env var) to a KV key that stores JSON paywall rules.
- If both `PAYWALL_RULES_JSON` and KV key are configured, KV value takes precedence.

### Browser Rendering Binding

```toml
[browser]
binding = "MYBROWSER"
```

> **Note**: Browser Rendering requires a Workers Paid plan. It only works in deployed Workers or with `wrangler dev --remote`.

### Custom Domain

1. In Cloudflare Dashboard > Workers & Pages > your Worker > **Settings** > **Domains & Routes**
2. Add your custom domain (e.g. `md.example.com`)

### Local Development

```bash
npm install
npm run dev           # Local dev at http://localhost:8787
npm test              # Run unit tests
npm run test:watch    # Watch mode
```

## License

MIT
