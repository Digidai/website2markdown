# URL to Markdown Converter

A Cloudflare Worker that converts **any** web page to clean Markdown. Works on every website — uses [Cloudflare Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/) when available, falls back to [Readability](https://github.com/mozilla/readability) + [Turndown](https://github.com/mixmark-io/turndown) for everything else.

Prepend your domain before any URL and get instant Markdown output. No API keys, no signup required.

## How It Works

```
https://<your-worker-domain>/<target-url>
```

```
Request
  │
  ▼
Fetch target with Accept: text/markdown
  │
  ├─ Response is text/markdown? ──▶ Native Markdown (Cloudflare edge conversion)
  │
  └─ Response is text/html? ──▶ Readability extracts main content
                                      │
                                      ▼
                                 Turndown converts HTML → Markdown
```

**Two conversion paths:**

| Path | When | How |
|---|---|---|
| **Native** | Target site uses Cloudflare + has Markdown for Agents enabled | Cloudflare edge converts HTML to Markdown via `Accept: text/markdown` content negotiation |
| **Fallback** | Any other website | [Readability](https://github.com/mozilla/readability) extracts the article content (strips nav, ads, sidebars), then [Turndown](https://github.com/mixmark-io/turndown) converts HTML to Markdown |

Both paths return clean Markdown. The response header `X-Markdown-Method` tells you which path was used.

## Usage

### Browser (URL bar)

```
# With full URL
https://<your-worker-domain>/https://example.com/page

# With http://
https://<your-worker-domain>/http://example.com/page

# Bare domain (auto-prepends https://)
https://<your-worker-domain>/example.com/page
```

### Homepage Input

Visit the root domain directly to see a landing page with an input box. You can type:

- `https://example.com/some-page` — full HTTPS URL
- `http://example.com/some-page` — full HTTP URL
- `example.com/some-page` — bare domain, automatically treated as HTTPS

### cURL

```bash
# Get rendered HTML page with Markdown preview
curl https://<your-worker-domain>/https://example.com/page

# Get raw Markdown
curl "https://<your-worker-domain>/https://example.com/page?raw=true"

# Or use Accept header
curl https://<your-worker-domain>/https://example.com/page \
  -H "Accept: text/markdown"
```

### JavaScript / TypeScript

```ts
const res = await fetch(
  "https://<your-worker-domain>/https://example.com/page?raw=true"
);
const markdown = await res.text();
console.log(res.headers.get("X-Markdown-Method")); // "native" or "readability+turndown"
```

### Python

```python
import requests

url = "https://<your-worker-domain>/https://example.com/page"
resp = requests.get(url, params={"raw": "true"})
markdown = resp.text
```

## Features

| Feature | Description |
|---|---|
| **Any Website** | Works on every site — native Markdown for Agents when available, Readability + Turndown fallback for everything else |
| **Smart Extraction** | Readability strips navigation, ads, sidebars and extracts the main article content before conversion |
| **Rendered View** | Beautiful dark-themed Markdown rendering with GitHub-style CSS and tab switching (Rendered / Source) |
| **Raw API** | Append `?raw=true` or send `Accept: text/markdown` to get plain Markdown text — ideal for LLMs and scripts |
| **Flexible Input** | Accepts `https://...`, `http://...`, or bare domains like `example.com` |
| **Copy Button** | One-click copy of the raw Markdown source |
| **Token Count** | Shows the `x-markdown-tokens` header when available (useful for LLM context window planning) |
| **Dynamic Domain** | No hardcoded domain — reads the hostname from the incoming request, works on any custom domain or localhost |
| **Zero Config** | No API keys, no environment variables, no database — deploy and use immediately |

## Response Headers (Raw API mode)

| Header | Description |
|---|---|
| `Content-Type` | `text/markdown; charset=utf-8` |
| `X-Source-URL` | The original target URL that was fetched |
| `X-Markdown-Tokens` | Estimated token count (only present for native Markdown for Agents responses) |
| `X-Markdown-Native` | `"false"` when using the Readability + Turndown fallback |
| `X-Markdown-Method` | `"readability+turndown"` when using the fallback path |
| `Access-Control-Allow-Origin` | `*` — CORS enabled for all origins |

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Landing page with URL input form |
| `/<url>` | GET | Convert URL and render Markdown as HTML page |
| `/<url>?raw=true` | GET | Return raw Markdown as plain text |
| `/api/health` | GET | Health check — returns `{"status":"ok","service":"<host>"}` |

## Tech Stack

| Component | Role |
|---|---|
| [Cloudflare Workers](https://workers.cloudflare.com/) | Edge runtime — global deployment, zero cold start |
| [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/) | Native HTML→Markdown at Cloudflare edge (when target site supports it) |
| [@mozilla/readability](https://github.com/mozilla/readability) | Extracts main article content from HTML (same algorithm as Firefox Reader View) |
| [Turndown](https://github.com/mixmark-io/turndown) | Converts HTML to Markdown with configurable rules |
| [LinkeDOM](https://github.com/WebReflection/linkedom) | Lightweight DOM implementation for Workers (no browser needed) |
| [marked](https://github.com/markedjs/marked) | Client-side Markdown→HTML rendering for the preview UI |

## Project Structure

```
md-genedai/
├── src/
│   └── index.ts          # Worker entry: routing, fetch proxy, conversion, HTML templates
├── package.json
├── wrangler.toml          # Cloudflare Worker config (nodejs_compat enabled)
├── tsconfig.json
└── .gitignore
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (for deployment)

### Install

```bash
npm install
```

### Local Development

```bash
npm run dev
```

Starts a local dev server at `http://localhost:8787`. All features work locally.

### Deploy

```bash
npm run deploy
```

Deploys to Cloudflare Workers. Access via the `*.workers.dev` subdomain assigned by Cloudflare.

### Custom Domain

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) > Workers & Pages > your Worker > Settings > Domains & Routes
2. Add your custom domain (e.g. `md.example.com`)
3. Or uncomment and update the `routes` in `wrangler.toml`:

```toml
routes = [
  { pattern = "md.example.com/*", zone_name = "example.com" }
]
```

The Worker automatically reads the hostname from each request — no code changes needed for different domains.

## License

MIT
