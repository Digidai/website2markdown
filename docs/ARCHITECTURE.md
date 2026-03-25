# Architecture Overview

`md-genedai` is a Cloudflare Worker that converts a target URL into Markdown, plain text, HTML, or JSON. The core system is a layered retrieval and conversion pipeline wrapped by cache, auth, rate limiting, and job/deep-crawl features.

## High-Level Design

The conversion stack is best understood as a 5-layer capability ladder. Not every request goes through every layer; the worker short-circuits as soon as it gets a good enough result.

```text
                       md-genedai conversion pipeline

    cheapest / simplest                                      heaviest / last resort

    [1] Native Markdown
        Accept: text/markdown against the target origin
                |
                v
    [2] Cloudflare REST Markdown
        Browser Rendering REST API helpers in src/cf-rest.ts
                |
                v
    [3] Readability + Turndown
        Static fetch -> content extraction -> Markdown
                |
                v
    [4] Browser + Adapters
        Cloudflare Browser Rendering + 14 adapters
                |
                v
    [5] Jina
        Explicit engine or last-resort fallback
```

Notes:

- Layer 2 is only eligible when Cloudflare REST credentials are configured and the URL is suitable for the generic path.
- Layer 4 includes 14 adapters total: 13 site-specific adapters plus 1 generic fallback adapter.
- Layer 5 can be selected explicitly with `engine=jina`, or used as a fallback when normal extraction is too thin.

## Request Flow

```text
Client Request
   |
   v
Route parsing in src/index.ts
   |
   +--> auth check for protected routes
   |
   +--> per-IP rate limit
   |
   +--> target URL extraction + validation
            |
            v
      SSRF guardrails in src/security.ts
            |
            v
      cache lookup in CACHE_KV / hot cache
            |
            +--> hit: return cached result
            |
            v
      conversion pipeline selection
            |
            +--> native markdown
            +--> CF REST markdown
            +--> static fetch + Readability/Turndown
            +--> browser adapter path
            +--> proxy retry / pool when anti-bot recovery is needed
            +--> Jina fallback
            |
            v
      post-processing
            |
            +--> paywall cleanup / JSON-LD / archive fallbacks
            +--> image proxy rewriting
            +--> output format shaping
            |
            v
      cache store
            |
            v
        HTTP response
```

## Module Dependency Graph

`src/index.ts` is the orchestration root. Most runtime features hang off it.

```text
src/index.ts
├── config.ts
├── types.ts
├── security.ts
├── converter.ts
├── cf-rest.ts
├── jina.ts
├── proxy.ts
├── paywall.ts
├── cache/index.ts
├── browser/index.ts
│   ├── browser/stealth.ts
│   ├── browser/proxy-retry.ts
│   ├── browser/adapters/*.ts
│   └── session/profile.ts
├── extraction/strategies.ts
├── dispatcher/model.ts
├── dispatcher/runner.ts
├── deepcrawl/bfs.ts
├── deepcrawl/filters.ts
├── deepcrawl/scorers.ts
├── observability/metrics.ts
└── templates/{landing,loading,rendered,error}.ts
```

A second way to view the same system is by runtime responsibility:

```text
HTTP router / orchestration
   |
   +--> Security: auth, SSRF, rate limiting
   +--> Retrieval: native, CF REST, static fetch, browser, proxy, Jina
   +--> Conversion: Readability + Turndown + output shaping
   +--> Storage: KV cache, R2 images, session snapshots, job state
   +--> Async features: jobs, deep crawl, metrics
```

## Cloudflare Bindings

The worker uses these Cloudflare runtime bindings:

```text
Env
├── MYBROWSER
│   └── Cloudflare Browser Rendering binding used by @cloudflare/puppeteer
├── CACHE_KV
│   ├── conversion result cache
│   ├── rate-limit counters
│   ├── CF blocked-domain negative cache
│   ├── paywall rule refresh source
│   └── job / crawl checkpoint persistence
├── IMAGE_BUCKET
│   └── R2 bucket for captured and proxied images
└── JOB_COORDINATOR
    └── Durable Object used for job coordination
```

In `wrangler.toml`, these map to:

- `MYBROWSER` for browser rendering
- `CACHE_KV` for Cloudflare KV
- `IMAGE_BUCKET` for R2
- `JOB_COORDINATOR` for the Durable Object class `JobCoordinator`

## Adapter Layer

The browser adapter layer lives in `src/browser/adapters/`.

Current adapter count:

- 13 site-specific adapters: Feishu, WeChat, Zhihu, Yuque, Notion, Juejin, CSDN, 36Kr, Toutiao, NetEase, Weibo, Reddit, and Twitter/X
- 1 generic fallback adapter

Total: 14 adapters

Important implementation detail:

- `genericAdapter` must stay last in the adapter list
- Feishu participates in adapter matching, but its browser execution path is handled by dedicated logic in `src/browser/index.ts`

## Conversion Pipeline Details

### 1. Native Markdown

For normal fetches, the worker first prefers direct content negotiation by requesting the target with `Accept: text/markdown`. If the origin already supports Markdown for Agents, that result is returned immediately.

### 2. Cloudflare REST Markdown

When `CF_ACCOUNT_ID` and `CF_API_TOKEN` are configured, the worker can call Cloudflare Browser Rendering REST endpoints through `src/cf-rest.ts`. This is treated as an early fast path for eligible generic sites.

### 3. Readability + Turndown

For normal HTML pages, the worker fetches HTML, removes obviously useless payloads such as scripts and styles, then runs content extraction through the Readability/Turndown pipeline in `src/converter.ts`.

### 4. Browser + Adapters

If a site always needs browser rendering, or static HTML looks JS-heavy / anti-bot-protected, the worker uses Cloudflare Browser Rendering via `src/browser/index.ts`.

Adapters can:

- decide whether they match a URL
- force browser rendering
- configure the page
- extract HTML
- transform URLs
- fetch directly from a site-specific API
- post-process HTML before conversion

### 5. Jina

`src/jina.ts` provides the explicit Jina engine and the final fallback when local extraction yields too little useful content.

## Practical Data Flow

```text
URL
 |
 v
normalize + validate
 |
 v
retrieve source document
 |
 +--> markdown already available ----------> return markdown
 |
 +--> HTML available ---------------------> extract main content
 |
 +--> JS / anti-bot / challenge ----------> browser adapter / proxy recovery
 |
 +--> still too thin ---------------------> Jina fallback
 |
 v
final markdown
 |
 +--> optional html/text/json formatting
 +--> cache write
 v
response
```

## Why the Architecture Looks Like This

This worker is optimized for breadth of web coverage under edge-runtime constraints:

- prefer cheap paths first
- keep browser rendering for cases that actually need it
- isolate site-specific logic in adapters
- use Cloudflare primitives for cache, images, and coordination
- keep a final external fallback for hard pages instead of failing immediately
