# TODOS

Deferred work from CEO Review (2026-03-25).

## P1 — Blocking

### MCP Monorepo Tooling (npm workspaces)
**What:** Configure npm workspaces so packages/mcp/ can build and publish independently to npm.
**Why:** Outside voice identified that monorepo tooling was completely unspecified. Without this, MCP Server cannot be published as an npm package.
**Effort:** S (CC 15 min). Add `"workspaces": ["packages/*"]` to root package.json, create packages/mcp/package.json with build/publish scripts.
**Priority:** P1 — blocks PR2 (MCP Server).
**Depends on:** PR1 complete.
**Source:** Eng Review 2026-03-25, outside voice finding #5.

## P2 — High Value, After Launch

### Public Success Rate Dashboard
**What:** Embed real-time operational metrics on the landing page (success rate, p95 latency, throughput).
**Why:** Turns "100% reliability" from a promise into verifiable evidence. Builds trust for paid tier conversion.
**Effort:** S (human 1 day / CC 1 hour). /api/health already has all the data.
**Priority:** P2
**Depends on:** Nothing — can be done anytime.
**Source:** CEO Review 2026-03-25, cherry-pick #2 (deferred).

### Cloudflare Platform Risk Contingency
**What:** Write a contingency plan for Cloudflare competition. What if CF adds Chinese platform support or changes Browser Rendering pricing?
**Why:** Outside voice identified this as the overlooked biggest threat — we depend on our own infrastructure provider. Need a plan for: (a) CF adds adapters to markdown.new, (b) CF changes render pricing, (c) CF deprecates Browser Rendering API.
**Effort:** S (just a document).
**Priority:** P2
**Depends on:** Nothing.
**Source:** CEO Review 2026-03-25, outside voice finding #5.

## P3 — Future, Demand-Driven

### Docker / Non-Cloudflare Deployment
**What:** Provide a Docker version using Puppeteer + Redis/SQLite instead of CF bindings (MYBROWSER, KV, R2, Durable Object).
**Why:** Expands self-deployer user base. Currently CF-only limits adoption. Many developers prefer Docker for local/on-prem deployment.
**Effort:** XL (human 2-3 months / CC 2-3 weeks). This is an ocean, not a lake.
**Priority:** P3 — only pursue when there's clear demand signal (GitHub issues requesting it, users asking in discussions).
**Depends on:** Modularization of index.ts complete (Phase 1).
**Source:** CEO Review 2026-03-25, cherry-pick #4 (deferred).
