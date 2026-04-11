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
   +--> resolveAuth() — Bearer key → LRU cache → D1 lookup → AuthContext
   |
   +--> buildPolicy() — AuthContext → PolicyDecision (tier gate)
   |        (sole source of truth for what the request may use)
   |
   +--> checkPolicy() — reject expensive params if tier doesn't allow
   |
   +--> per-IP rate limit
   |
   +--> target URL extraction + validation
            |
            v
      SSRF guardrails in src/security.ts
            |
            v
      3-tier cache lookup in src/cache/index.ts
            |
            +--> hot_cache (in-memory, 15s, per-isolate)
            +--> Cache API (per-colo, free, Cloudflare-native)
            +--> CACHE_KV (global, persistent, paid per-op)
            |
            +--> hit: return cached result + policy headers
            |
            v
      conversion pipeline selection
            |   (browserAllowed comes from PolicyDecision —
            |    anonymous tier can never reach browser path)
            |
            +--> native markdown
            +--> CF REST markdown
            +--> static fetch + Readability/Turndown
            +--> browser adapter path              [if policy.browserAllowed]
            +--> proxy retry / pool                [if policy.proxyAllowed]
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
      cache store (3-tier fan-out)
            |
            v
      recordUsage() — buffer this request's credits in memory
            |
            v
      ctx.waitUntil(flushUsage(env)) — async D1 write after response
            |
            v
      response with X-RateLimit-*, X-Request-Cost headers
```

## Module Dependency Graph

`src/index.ts` is the orchestration root. Most runtime features hang off it.

```text
src/index.ts
├── config.ts
├── types.ts                    (AuthContext, PolicyDecision, Tier, TIER_QUOTAS)
├── security.ts
├── converter.ts
├── cf-rest.ts
├── jina.ts
├── proxy.ts
├── paywall.ts
├── cache/index.ts              (hot cache → Cache API → KV)
├── middleware/
│   ├── auth.ts                 (legacy single-token auth)
│   ├── auth-d1.ts              (resolveAuth — D1 + LRU cache)
│   ├── session.ts              (portal session cookies, D1-backed)
│   ├── tier-gate.ts            (buildPolicy, checkPolicy, policyHeaders)
│   └── rate-limit.ts           (per-IP anti-abuse)
├── handlers/
│   ├── convert.ts
│   ├── batch.ts, extract.ts, jobs.ts, deepcrawl.ts
│   ├── stream.ts
│   ├── auth.ts                 (magic link send/verify/logout)
│   ├── keys.ts                 (/api/keys CRUD, /api/me)
│   ├── usage.ts                (/api/usage, recordUsage, flushUsage)
│   └── health.ts, og-image.ts, llms-txt.ts, seo.ts
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
└── templates/
    ├── landing.ts              (public homepage)
    ├── loading.ts, rendered.ts, error.ts
    └── portal.ts               (developer portal SPA)
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
│   ├── conversion result cache (tier 3, global/persistent)
│   ├── CF blocked-domain negative cache
│   ├── paywall rule refresh source
│   └── job / crawl checkpoint persistence
├── IMAGE_BUCKET
│   └── R2 bucket for captured and proxied images
├── JOB_COORDINATOR
│   └── Durable Object used for job coordination
└── AUTH_DB
    ├── accounts            (email, tier, monthly_credits_used)
    ├── api_keys            (SHA-256 hashed, prefix, revoked_at)
    ├── sessions            (portal session cookies, SHA-256 hashed)
    ├── magic_link_tokens   (passwordless email sign-in, single-use)
    ├── usage_daily         (per-key per-day credit/request counters)
    └── paddle_events       (webhook dedup for future billing)
```

In `wrangler.toml`, these map to:

- `MYBROWSER` for browser rendering
- `CACHE_KV` for Cloudflare KV
- `IMAGE_BUCKET` for R2
- `JOB_COORDINATOR` for the Durable Object class `JobCoordinator`
- `AUTH_DB` for the D1 SQLite database (`md-auth`)

## Auth, Tier, and Metering

The auth layer is layered deliberately: the only thing handlers see is a
`PolicyDecision`, which is computed once at the top of the request by
`buildPolicy(resolveAuth(request, env))`. Downstream code never touches
Bearer headers, session cookies, or D1 directly.

```text
Request
   │
   ▼
 resolveAuth()
   │  1. parse Authorization: Bearer mk_…
   │  2. sha256(token) → key hash
   │  3. LRU cache hit? → return cached AuthContext
   │  4. miss → D1 query (api_keys JOIN accounts)
   │  5. D1 fail → fall back to stale LRU (preserves paid tier during D1 blip)
   │  6. unknown or no key → anonymous AuthContext
   ▼
 AuthContext { tier, accountId, keyId, quotaLimit, quotaUsed }
   │
   ▼
 buildPolicy(auth, route)
   │  Translates tier → capabilities. Fixed-price per-route credit cost.
   ▼
 PolicyDecision {
   browserAllowed,
   proxyAllowed,
   engineSelectionAllowed,
   noCacheAllowed,
   quotaRemaining,
   creditCost,
 }
   │
   ▼
 checkPolicy(policy, {forceBrowser, noCache, engine})
   │  401 if tier can't use a requested parameter
   ▼
 convertUrl(…, browserAllowed: policy.browserAllowed, …)
```

**Tiers and quotas** (from `TIER_QUOTAS` in `src/types.ts`):

| Tier | Quota/mo | browser | proxy | engine= | no_cache | force_browser |
|------|---------:|:-------:|:-----:|:-------:|:--------:|:-------------:|
| anonymous | 0 | — | — | — | — | — |
| free | 1,000 | ✅ | — | — | — | — |
| pro | 50,000 | ✅ | ✅ | ✅ | ✅ | ✅ |

**Usage metering**: `recordUsage()` mutates an in-memory buffer keyed by
`{keyId}:{date}`. `ctx.waitUntil(flushUsage(env))` runs after the response
is sent and writes the accumulated batch to D1 with `INSERT … ON CONFLICT
UPDATE`, also bumping `accounts.monthly_credits_used` (the denormalized
column used for fast quota checks). Threshold is 1 so the flush runs on
every authenticated request; natural batching happens when multiple
concurrent requests hit the same isolate before `waitUntil` fires.

**D1 failure mode**: If D1 is briefly unreachable, the LRU cache keeps
serving paid tier access for known keys until its 60s TTL expires. Only
fully unknown keys degrade to anonymous. This prevents a D1 blip from
turning into a paying-customer outage.

## Developer Portal

The portal at `/portal/` is a single HTML file served by the Worker (no
build step, no framework, no `<script src>`). It fetches `/api/me`,
`/api/keys`, and `/api/usage` client-side and renders a Stripe/Linear-style
dashboard.

**Auth flow** (Magic Link):

```text
POST /api/auth/magic-link { email }
   │  1. validate email
   │  2. rate limit 3/hour/email via Cache API
   │  3. generate random 32-byte hex token
   │  4. SHA-256 hash → magic_link_tokens row (15 min TTL)
   │  5. send Resend email with link to /api/auth/verify?token=<token>
   │  6. return 200 (never leak whether email exists)
   ▼
User clicks link → GET /api/auth/verify?token=<token>
   │  1. hash token, look up magic_link_tokens row
   │  2. check not expired, not already used
   │  3. mark used_at to prevent replay
   │  4. find-or-create accounts row by email
   │  5. createSession() → new session row (token hash stored)
   │  6. 302 redirect to /portal/ with Set-Cookie: md_session=<token>
   ▼
Portal loads → JS calls /api/me with session cookie
```

Portal API (session cookie required): `GET /api/me`, `GET /api/keys`,
`POST /api/keys`, `DELETE /api/keys/:id`, `GET /api/usage`,
`POST /api/auth/logout`. `/api/usage` also accepts `Authorization: Bearer`
so SDKs can poll usage without a session.

**Session security**: 32-byte random token in an `HttpOnly; Secure;
SameSite=Lax` cookie. D1 only stores the SHA-256 hash, so leaking the
sessions table does not grant access. CSRF is blocked by SameSite=Lax and
the absence of `Access-Control-Allow-Credentials` in CORS headers.

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
