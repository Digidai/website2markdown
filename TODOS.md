# TODOS

Deferred work from CEO Review (2026-03-25).

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

### Paddle 运营 Runbook
**What:** Paddle 支付运营文档 — 退款流程、拒付处理、取消降级逻辑、对账检查清单。
**Why:** 代码好写，运营难做。Codex outside voice 指出没有 runbook 的支付集成是定时炸弹。
**Effort:** S (just a document)
**Priority:** P1 (Phase D 前置条件)
**Depends on:** Phase C (Developer Portal) 完成
**Source:** CEO Review 2026-04-10, outside voice finding.

### 匿名用户反滥用加固
**What:** 匿名用户反滥用措施 — 每 IP 日请求上限、cold URL 限流、CF WAF 规则配置。
**Why:** Phase A 限制匿名到 cache+readability，但攻击者仍可打大量冷门 URL 制造 miss、拉源站、耗 KV write。Codex outside voice 指出当前方案只修了"最贵路径"，不是"滥用面"。
**Effort:** S
**Priority:** P2 (在 Phase A 之后)
**Depends on:** Phase A 完成
**Source:** CEO Review 2026-04-10, outside voice finding.

## P3 — Future, Demand-Driven

### Docker / Non-Cloudflare Deployment
**What:** Provide a Docker version using Puppeteer + Redis/SQLite instead of CF bindings (MYBROWSER, KV, R2, Durable Object).
**Why:** Expands self-deployer user base. Currently CF-only limits adoption. Many developers prefer Docker for local/on-prem deployment.
**Effort:** XL (human 2-3 months / CC 2-3 weeks). This is an ocean, not a lake.
**Priority:** P3 — only pursue when there's clear demand signal (GitHub issues requesting it, users asking in discussions).
**Depends on:** Modularization of index.ts complete (Phase 1).
**Source:** CEO Review 2026-03-25, cherry-pick #4 (deferred).

## Completed

### MCP Monorepo Tooling (npm workspaces)
**Completed:** v1.0.0 (2026-03-26)
npm workspaces configured, packages/mcp/ with build/publish scripts, GitHub Actions publish-mcp.yml workflow. Tag `mcp-v*` triggers npm publish.
