# URL to Markdown Converter

A Cloudflare Worker that converts **any** web page to clean Markdown. Supports three conversion paths — [Cloudflare Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/) (native), [Readability](https://github.com/mozilla/readability) + [Turndown](https://github.com/mixmark-io/turndown) (fallback), and [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) for anti-bot/JS-heavy pages (e.g. WeChat articles).

Prepend your domain before any URL and get instant Markdown output. No API keys, no signup required.

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
| **Native** | Target site supports Markdown for Agents | Cloudflare edge converts via `Accept: text/markdown` content negotiation | _(not set)_ |
| **Fallback** | Normal HTML pages | Readability extracts main content → Turndown converts to Markdown | `readability+turndown` |
| **Browser** | Anti-bot pages, JS-rendered content (e.g. WeChat) | Headless Chrome renders the page → Readability + Turndown | `browser+readability+turndown` |

## API Usage

### Browser (URL bar)

```
# Full URL
https://md.genedai.me/https://example.com/page

# Bare domain (auto-prepends https://)
https://md.genedai.me/example.com/page
```

### Raw Markdown API

Append `?raw=true` or send `Accept: text/markdown` header to get plain Markdown text.

```bash
# Get raw Markdown via query param
curl "https://md.genedai.me/https://example.com/page?raw=true"

# Get raw Markdown via Accept header
curl https://md.genedai.me/https://example.com/page \
  -H "Accept: text/markdown"
```

### Force Browser Rendering

For pages that don't auto-trigger browser rendering but need it:

```bash
curl "https://md.genedai.me/https://example.com/js-heavy-page?raw=true&force_browser=true"
```

### WeChat Articles

WeChat articles (`mp.weixin.qq.com`) automatically use browser rendering. Images are proxied through `/img/` to bypass WeChat's hotlink protection.

```bash
curl "https://md.genedai.me/https://mp.weixin.qq.com/s/DAxmijabtwWmrPHeJ-OTFQ?raw=true"
```

### JavaScript / TypeScript

```ts
const res = await fetch(
  "https://md.genedai.me/https://example.com/page?raw=true"
);
const markdown = await res.text();
console.log(res.headers.get("X-Markdown-Method"));
// "readability+turndown" or "browser+readability+turndown"
```

### Python

```python
import requests

url = "https://md.genedai.me/https://example.com/page"
resp = requests.get(url, params={"raw": "true"})
markdown = resp.text
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Landing page with URL input form |
| `/<url>` | GET | Convert URL and render Markdown as HTML page |
| `/<url>?raw=true` | GET | Return raw Markdown as plain text |
| `/<url>?force_browser=true` | GET | Force browser rendering for the URL |
| `/img/<encoded-url>` | GET | Image proxy (bypasses hotlink protection) |
| `/api/health` | GET | Health check — `{"status":"ok","service":"<host>"}` |

## Response Headers (Raw API)

| Header | Description |
|---|---|
| `Content-Type` | `text/markdown; charset=utf-8` |
| `X-Source-URL` | The original target URL |
| `X-Markdown-Tokens` | Token count (native Markdown for Agents only) |
| `X-Markdown-Native` | `"false"` when using fallback/browser path |
| `X-Markdown-Method` | `"readability+turndown"` or `"browser+readability+turndown"` |
| `Access-Control-Allow-Origin` | `*` — CORS enabled |

## Features

| Feature | Description |
|---|---|
| **Any Website** | Works on every site with three conversion paths |
| **Anti-Bot Bypass** | Browser Rendering handles JS challenges, CAPTCHAs, and WeChat verification |
| **WeChat Support** | Full article extraction with image proxy for hotlink-protected images |
| **Smart Extraction** | Readability strips nav, ads, sidebars — extracts main article content |
| **Rendered View** | Dark-themed Markdown preview with GitHub CSS and tab switching |
| **Raw API** | `?raw=true` or `Accept: text/markdown` for plain Markdown text |
| **Flexible Input** | Accepts `https://`, `http://`, or bare domains |
| **Zero Config** | No API keys, no env vars — deploy and use immediately |

## Tech Stack

| Component | Role |
|---|---|
| [Cloudflare Workers](https://workers.cloudflare.com/) | Edge runtime — global deployment |
| [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) | Headless Chrome for JS-heavy/anti-bot pages |
| [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/) | Native HTML→Markdown at edge |
| [@mozilla/readability](https://github.com/mozilla/readability) | Article content extraction (Firefox Reader View algorithm) |
| [Turndown](https://github.com/mixmark-io/turndown) | HTML→Markdown conversion |
| [@cloudflare/puppeteer](https://github.com/nichochar/puppeteer) | Puppeteer API for Browser Rendering binding |
| [LinkeDOM](https://github.com/WebReflection/linkedom) | Lightweight DOM for Workers |

## Project Structure

```
md-genedai/
├── src/
│   └── index.ts          # Worker entry: routing, fetch, browser rendering, conversion, templates
├── package.json
├── wrangler.toml          # Worker config: nodejs_compat, browser binding
├── tsconfig.json
└── .gitignore
```

## Deployment

This project uses **Cloudflare Git Integration** for deployment — push to `main` and Cloudflare automatically builds and deploys.

### Setup (one-time)

1. Fork or push this repo to GitHub
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) > **Workers & Pages** > **Create** > **Import a Git repository**
3. Select the GitHub repo, set build settings:
   - **Build command**: _(leave empty — Cloudflare auto-detects from `wrangler.toml`)_
   - **Production branch**: `main`
4. Cloudflare will deploy automatically on every push to `main`

### Browser Rendering Binding

The `[browser]` binding in `wrangler.toml` is automatically configured:

```toml
[browser]
binding = "MYBROWSER"
```

> **Note**: Browser Rendering requires a Workers Paid plan. It only works in deployed Workers or with `wrangler dev --remote` — local dev without `--remote` will gracefully fall back to static fetch.

### Custom Domain

1. In Cloudflare Dashboard > Workers & Pages > your Worker > **Settings** > **Domains & Routes**
2. Add your custom domain (e.g. `md.example.com`)

Or uncomment and update in `wrangler.toml`:

```toml
routes = [
  { pattern = "md.example.com/*", zone_name = "example.com" }
]
```

### Local Development

```bash
npm install
npm run dev          # Local dev at http://localhost:8787
                     # Browser rendering won't work locally (use --remote)
```

## License

MIT
