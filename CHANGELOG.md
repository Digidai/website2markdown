# Changelog

## [1.1.0] - 2026-04-11

Three-phase auth, metering, and portal launch. Everything anonymous users
could break for free is now metered or gated behind an API key.

### Added
- **Developer Portal** at `/portal/` — single-page dashboard for signup, API
  key management, usage tracking, tier display. Static HTML served by the
  Worker, no build step, matches landing-page design system.
- **Magic Link auth** via Resend — passwordless email sign-in flow.
  Endpoints: `POST /api/auth/magic-link`, `GET /api/auth/verify`,
  `POST /api/auth/logout`. Tokens expire in 15 min, single-use, SHA-256
  hashed in D1, rate limited 3/hour/email via Cache API.
- **D1-backed API keys** with tier system. Keys are `mk_` + 32 random bytes,
  SHA-256 hashed in D1. Format: `Authorization: Bearer mk_...`. Three tiers:
  `anonymous` (cache + readability only), `free` (1,000 credits/month, full
  pipeline), `pro` (50,000 credits/month).
- **Portal API endpoints** (session-authenticated via `md_session` cookie):
  - `GET /api/me` — current account info
  - `GET /api/keys` — list keys (prefix only, never plaintext)
  - `POST /api/keys` — create new key (plaintext returned ONCE)
  - `DELETE /api/keys/:id` — revoke key
  - `GET /api/usage` — usage data (also accepts Bearer API key)
- **Cache API middle layer** between in-memory hot cache and KV. Cache API
  is free and per-colo; reduces KV operations by ~80% for repeat traffic.
  Unified URL-based cache key: `https://md-cache/v1/{format}/{engine}/{hash}`.
- **Usage metering** — in-memory counters flush to D1 via `ctx.waitUntil()`
  after every authenticated request. `usage_daily` table tracks requests,
  credits, browser calls, cache hits per key per day. `monthly_credits_used`
  denormalized on `accounts` for fast quota checks.
- **Per-request rate limit headers** on every authenticated response:
  `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-Request-Cost`. Cost is a
  fixed per-request-type value (convert=1, extract=3, deepcrawl=2) — not the
  actual pipeline cost, which would vary by site and confuse billing.
- **Graceful quota degradation** — when a paying user's monthly quota is
  exhausted, cached URLs still serve with `X-Quota-Exceeded: true`; only
  cache-miss requests return `429`.
- **D1 `AUTH_DB` binding** with 6 tables: `accounts`, `api_keys`,
  `usage_daily`, `sessions`, `magic_link_tokens`, `paddle_events`.
- **DESIGN.md** — design system tokens (fonts, colors, spacing, components)
  shared between landing page and portal.

### Changed
- Anonymous users can no longer trigger browser rendering. Previously a
  single crawler bot could burn through Cloudflare Browser Rendering minutes
  and KV quota. Now anonymous users get readability + cache only. Expensive
  parameters (`force_browser`, `engine`, `no_cache`) return `401` for
  anonymous and Free tier users.
- `/api/usage` now accepts either a Bearer API key (for SDK/CLI) or a portal
  session cookie (for the dashboard).
- Authentication logic consolidated into one place — `resolveAuth()` returns
  an `AuthContext`, `buildPolicy()` turns that into a `PolicyDecision` that
  every downstream handler consults. No more scattered token checks.
- `ctx: ExecutionContext` added to the `fetch` handler signature so usage
  flushes can run post-response via `ctx.waitUntil()`.

### Fixed
- KV incident from 2026-04-09 properly closed (anonymous abuse surface).
- `/api/usage` returned `401` for session users because it required a key
  id. Now derives tier and quota from the D1 `accounts` row.
- `FLUSH_THRESHOLD` was 100 — low-traffic deployments never flushed usage
  to D1, so `monthly_credits_used` stayed at 0 forever. Lowered to 1.
- `GET /api/auth/magic-link` and `GET /api/auth/logout` fell through to the
  URL-conversion path and returned the landing page. Now return `405`.
- Cache edge tests unblocked — previous fake-timer race with `setCache`.

### Security
- Session tokens stored as SHA-256 hash. Plaintext exists only in the
  `md_session` cookie. Cookie is `HttpOnly; Secure; SameSite=Lax`.
- API key values stored as SHA-256 hash. Plaintext shown once at creation
  and never again — lost keys must be revoked and regenerated.
- Magic link tokens: 15 min TTL, single-use (`used_at` set on verify), never
  stored plaintext, rate limited per email per hour.
- Portal endpoints reject CSRF via `SameSite=Lax` cookies and absence of
  `Access-Control-Allow-Credentials` in CORS.

## [1.0.0] - 2026-03-26

### Added
- **Modular architecture**: refactored monolithic index.ts (4995 lines) into 14 focused modules
- **MCP Server**: `@digidai/mcp-website2markdown` npm package with `convert_url` tool
- **Agent Skills**: [website2markdown-skills](https://github.com/Digidai/website2markdown-skills) repo for Claude Code, OpenClaw, and other agents
- **llms.txt**: AI discoverability at `/llms.txt` and `/.well-known/llms.txt` with KV cache
- **Adapter scaffold CLI**: `scripts/create-adapter.ts` generates adapter + test boilerplate
- **robots.txt + sitemap.xml**: SEO endpoints
- **Landing page redesign**: 3-tab architecture (Home/Docs/Integration), Cursor-style design, dark mode, bilingual EN/ZH, Schema.org FAQPage/HowTo/SoftwareApplication
- **npm publish workflow**: GitHub Actions on `mcp-v*` tag

### Fixed
- 3 pre-existing test failures (deepcrawl checkpoint, jobs idempotency, stale task)
- SSRF protection in `fetchTargetLlmsTxt` (redirect: error)
- Adapter scaffold URL pattern injection (JSON.stringify escaping)
- MCP SDK version compatibility (zod 4 alignment)
- Dark mode CSS variable leak via `data-theme` attribute on theme toggle buttons

### Changed
- `formatOutput()` consolidated from 4 scattered switch blocks into single helper
- Deep crawl checkpoint config no longer includes `maxDepth`/`maxPages` (operational limits)

### Security
- wrangler.toml KV namespace ID replaced with placeholder for open source
- MCP response body size limit (10MB)
- Negative llms.txt cache uses 1h TTL (vs 24h for positive) to recover from transient errors

## [0.x] - Pre-release

All development prior to open source launch. See [git history](https://github.com/Digidai/website2markdown/commits/main) for details.
