# URL to Markdown 转换器

[English](./README.md) | [简体中文](./README.zh-CN.md)

一个 Cloudflare Worker，可以把**任意网页**转换为干净、可读的 Markdown。
支持三条转换路径：[Cloudflare Markdown for Agents](https://blog.cloudflare.com/markdown-for-agents/)（原生）、[Readability](https://github.com/mozilla/readability) + [Turndown](https://github.com/mixmark-io/turndown)（兜底）、以及 [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/)（用于反爬/重 JS 页面）。

把你的域名前缀加在目标 URL 前即可直接获得 Markdown 输出。无需注册，API 鉴权可选。

## 工作原理

```
https://<your-worker-domain>/<target-url>
```

### 三层转换流程

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

| 路径 | 触发条件 | 转换方式 | `X-Markdown-Method` |
|---|---|---|---|
| **Native** | 目标站点支持 Markdown for Agents | 通过 `Accept: text/markdown` 在 Cloudflare 边缘协商原生 Markdown | `native` |
| **Fallback** | 普通 HTML 页面 | Readability 提取正文 → Turndown 转 Markdown | `readability+turndown` |
| **Browser** | 反爬或重 JS 页面 | 无头浏览器渲染后再走 Readability + Turndown | `browser+readability+turndown` |

## API 使用

### 浏览器地址栏

```
# 完整 URL
https://md.genedai.me/https://example.com/page

# 裸域名（自动补 https://）
https://md.genedai.me/example.com/page
```

### 原始 Markdown API

```bash
# 通过 query 获取 raw markdown
curl "https://md.genedai.me/https://example.com/page?raw=true"

# 通过 Accept 头获取 raw markdown
curl https://md.genedai.me/https://example.com/page \
  -H "Accept: text/markdown"
```

### 可选：API Token 保护

如果配置了 `PUBLIC_API_TOKEN`，API 风格请求会要求 token：

```bash
# Header token
curl "https://md.genedai.me/https://example.com/page?raw=true" \
  -H "Authorization: Bearer <public-token>"

# Query token（适用于 /api/stream EventSource）
curl "https://md.genedai.me/api/stream?url=https%3A%2F%2Fexample.com%2Fpage&token=<public-token>"
```

### 输出格式

```bash
# Markdown（默认）
curl "https://md.genedai.me/https://example.com?format=markdown&raw=true"

# Clean HTML
curl "https://md.genedai.me/https://example.com?format=html&raw=true"

# 纯文本（去格式）
curl "https://md.genedai.me/https://example.com?format=text&raw=true"

# JSON（结构化：url, title, markdown, method, timestamp）
curl "https://md.genedai.me/https://example.com?format=json&raw=true"
```

### CSS 选择器提取

```bash
# 仅提取文章主体
curl "https://md.genedai.me/https://example.com?selector=.article-body&raw=true"

# 提取指定区块
curl "https://md.genedai.me/https://example.com?selector=%23main-content&raw=true"
```

> `selector` 最大长度为 `256`。

### 强制浏览器渲染

```bash
curl "https://md.genedai.me/https://example.com/js-heavy-page?raw=true&force_browser=true"
```

### 缓存控制

结果会缓存到 KV。若需跳过缓存：

```bash
curl "https://md.genedai.me/https://example.com?raw=true&no_cache=true"
```

### 批量转换

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

`urls` 支持：
- 字符串项：`"https://example.com/a"`（默认 markdown）
- 对象项：`{ "url": "...", "format?": "markdown|html|text|json", "selector?": "...", "force_browser?": boolean, "no_cache?": boolean }`

### 结构化提取 API

```bash
curl -X POST https://md.genedai.me/api/extract \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "strategy": "css",
    "url": "https://example.com/article",
    "schema": {
      "fields": [
        { "name": "title", "selector": "h1", "type": "text", "required": true },
        { "name": "author", "selector": ".author", "type": "text" }
      ]
    },
    "include_markdown": true
  }'
```

同样支持批量提取（`items`，最多 10 条）。

### Job API（创建 / 查询 / 流式 / 执行）

```bash
# 1) 创建任务
curl -X POST https://md.genedai.me/api/jobs \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-job-1" \
  -d '{
    "type": "crawl",
    "tasks": [
      "https://example.com/a",
      "https://example.com/b"
    ],
    "priority": 10,
    "maxRetries": 2
  }'

# 2) 查询状态
curl -H "Authorization: Bearer <api-token>" \
  https://md.genedai.me/api/jobs/<job-id>

# 3) 订阅状态流（SSE）
curl -N -H "Authorization: Bearer <api-token>" \
  https://md.genedai.me/api/jobs/<job-id>/stream

# 4) 执行队列中的任务
curl -X POST -H "Authorization: Bearer <api-token>" \
  https://md.genedai.me/api/jobs/<job-id>/run
```

### Deep Crawl API

```bash
# non-stream
curl -X POST https://md.genedai.me/api/deepcrawl \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "seed": "https://example.com/docs",
    "max_depth": 2,
    "max_pages": 20,
    "strategy": "best_first",
    "filters": {
      "allow_domains": ["example.com"],
      "url_patterns": ["https://example.com/docs/*"]
    },
    "scorer": {
      "keywords": ["api", "reference"],
      "weight": 2
    },
    "checkpoint": {
      "crawl_id": "docs-crawl-001",
      "snapshot_interval": 5
    }
  }'

# stream mode（SSE: start/node/done/fail）
curl -N -X POST https://md.genedai.me/api/deepcrawl \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "seed": "https://example.com/docs",
    "stream": true
  }'
```

### 支持站点

| 站点 | 特性 |
|---|---|
| **WeChat** (`mp.weixin.qq.com`) | MicroMessenger UA、图片代理绕过防盗链 |
| **Feishu/Lark** (`.feishu.cn`, `.larksuite.com`) | 虚拟滚动处理、R2 图片存储、页面噪音清理 |
| **Zhihu** (`zhihu.com/p/`) | 登录墙处理、懒加载图片修复、混合代理绕过 |
| **Yuque** (`yuque.com`) | SPA 渲染、侧边栏/目录清理 |
| **Notion** (`notion.site`, `notion.so`) | SPA 渲染、懒加载滚动 |
| **Juejin** (`juejin.cn/post/`) | 登录弹窗处理、代码块展开 |
| **Twitter/X** (`twitter.com`, `x.com`) | 隐身渲染、登录墙绕过 |
| **Reddit** (`reddit.com`) | 自动转 old.reddit.com、正文提取 |
| **CSDN** (`csdn.net`) | 登录弹窗处理、代码块展开 |
| **36Kr** (`36kr.com`) | 隐身渲染、正文提取 |
| **Toutiao** (`toutiao.com`) | 隐身渲染、正文提取 |
| **NetEase** (`163.com`) | 正文提取 |
| **Weibo** (`weibo.com`) | 隐身渲染、混合代理绕过 |
| **其他站点** | 通用移动端 UA、懒加载图片处理 |

### JavaScript / TypeScript

```ts
const res = await fetch(
  "https://md.genedai.me/https://example.com/page?raw=true"
);
const markdown = await res.text();
console.log(res.headers.get("X-Markdown-Method"));
console.log(res.headers.get("X-Cache-Status")); // "HIT" 或 "MISS"
```

### Python

```python
import requests

url = "https://md.genedai.me/https://example.com/page"
resp = requests.get(url, params={"raw": "true", "format": "json"})
data = resp.json()
print(data["title"], data["method"])
```

## API 端点

| Endpoint | Method | 说明 |
|---|---|---|
| `/` | GET | 带 URL 输入框的首页 |
| `/<url>` | GET | 转换 URL 并渲染 Markdown HTML 页面 |
| `/<url>?raw=true` | GET | 返回原始 Markdown 纯文本 |
| `/<url>?format=json` | GET | 返回结构化 JSON（url/title/markdown/method） |
| `/<url>?format=html` | GET | 返回清洗后的 HTML |
| `/<url>?format=text` | GET | 返回纯文本（无格式） |
| `/<url>?selector=.class` | GET | 提取指定 CSS 选择器 |
| `/<url>?force_browser=true` | GET | 强制浏览器渲染 |
| `/<url>?no_cache=true` | GET | 跳过 KV 缓存 |
| `/api/stream?url=<encoded-url>` | GET | SSE 转换流（`step` / `done` / `fail`） |
| `/api/batch` | POST | 批量转换（最多 10 条） |
| `/api/extract` | POST | 结构化提取 API（`css` / `xpath` / `regex`） |
| `/api/jobs` | POST | 创建排队爬取/提取任务 |
| `/api/jobs/:id` | GET | 查询任务状态 |
| `/api/jobs/:id/stream` | GET | SSE 任务状态流 |
| `/api/jobs/:id/run` | POST | 执行该任务中队列/失败项 |
| `/api/deepcrawl` | POST | Deep Crawl（BFS/BestFirst，流式/非流式，断点续跑） |
| `/img/<encoded-url>` | GET | 图片代理（绕过防盗链） |
| `/r2img/<key>` | GET | 从 R2 返回图片 |
| `/api/health` | GET | 健康检查 + 运行态 + 运营指标 |

## 鉴权矩阵

| 路由组 | Token 要求 | 说明 |
|---|---|---|
| `/<url>` 及其查询变体 | 默认不需要 | 若配置 `PUBLIC_API_TOKEN`，API 风格请求需 token |
| `/api/stream` | 默认不需要 | 若配置 `PUBLIC_API_TOKEN`，需 token |
| `/api/batch` | `Authorization: Bearer <API_TOKEN>` | 若未配置 `API_TOKEN`，返回 `503`（`API_TOKEN not set`） |
| `/api/extract` | `Authorization: Bearer <API_TOKEN>` | 若未配置 `API_TOKEN`，返回 `503` |
| `/api/jobs*` | `Authorization: Bearer <API_TOKEN>` | 包含 create/query/stream/run |
| `/api/deepcrawl` | `Authorization: Bearer <API_TOKEN>` | 流式和非流式都要求 `API_TOKEN` |
| `/api/health` | 公开 | 运营可观测性端点 |

## 响应头（Raw API）

| Header | 说明 |
|---|---|
| `Content-Type` | `text/markdown`、`application/json`、`text/html` 或 `text/plain` |
| `X-Source-URL` | 原始目标 URL |
| `X-Markdown-Tokens` | Token 数（仅原生 Markdown for Agents） |
| `X-Markdown-Native` | 原生路径为 `"true"`，否则 `"false"` |
| `X-Markdown-Method` | `"native"`、`"readability+turndown"`、`"browser+readability+turndown"` |
| `X-Cache-Status` | `"HIT"` 或 `"MISS"` |
| `X-Markdown-Fallbacks` | 逗号分隔的兜底链路（如有） |
| `X-Browser-Rendered` | 使用浏览器渲染时为 `"true"` |
| `X-Paywall-Detected` | 命中付费墙规则时为 `"true"` |
| `Retry-After` / `X-RateLimit-*` | 在 `429` 响应中出现 |
| `Access-Control-Allow-Origin` | `*`，已启用 CORS |

## 功能特性

| 功能 | 说明 |
|---|---|
| **任意网站** | 三条转换路径覆盖更多页面类型 |
| **站点适配器** | WeChat / Feishu / Zhihu / Yuque / Notion / Juejin 专项提取 |
| **反爬绕过** | Browser Rendering 处理 JS 挑战与验证场景 |
| **KV 缓存** | 重复请求快速返回 |
| **R2 图片存储** | 图片稳定保存并通过代理地址交付 |
| **多输出格式** | Markdown、HTML、Text、JSON |
| **CSS 选择器** | 精准提取指定页面区域 |
| **Batch API v2** | 单次最多 10 条，并支持逐条参数 |
| **结构化提取** | `/api/extract` 支持 CSS/XPath/Regex + 可选 markdown 附带 |
| **任务调度器** | `/api/jobs/*` 支持排队、执行、重试、监控 |
| **Deep Crawl** | BFS + BestFirst、过滤器/评分器、流式、断点续跑 |
| **表格支持** | 提升简单/复杂表格转换质量 |
| **智能正文提取** | Readability 过滤导航、广告、侧栏 |
| **渲染预览** | 暗色 Markdown 预览页，支持标签切换 |
| **会话档案** | 持久化/回放 cookie 与 localStorage |
| **代理池回退** | 多代理 + UA/Header 轮换策略 |
| **SSRF 防护** | 阻断私网 IP、IPv6 link-local、云元数据地址 |
| **超时保护** | Feishu 虚拟滚动文档采用时间预算滚动 |
| **内置限流** | 按 IP 对转换、流式、批量接口限流 |
| **动态付费墙规则** | 支持 env/KV 动态更新规则 |
| **运行健康指标** | `/api/health` 提供吞吐/成功率/重试/积压/P50/P95 |

## 技术栈

| 组件 | 角色 |
|---|---|
| [Cloudflare Workers](https://workers.cloudflare.com/) | 边缘运行时（全球部署） |
| [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) | 无头 Chrome（应对重 JS/反爬页面） |
| [Cloudflare KV](https://developers.cloudflare.com/kv/) | 边缘键值缓存 |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) | 图片对象存储 |
| [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/) | 边缘原生 HTML→Markdown |
| [@mozilla/readability](https://github.com/mozilla/readability) | 文章正文提取 |
| [Turndown](https://github.com/mixmark-io/turndown) | HTML→Markdown 转换 |
| [@cloudflare/puppeteer](https://github.com/nichochar/puppeteer) | Browser Rendering 的 Puppeteer API |
| [LinkeDOM](https://github.com/WebReflection/linkedom) | Workers 轻量 DOM |
| [Vitest](https://vitest.dev/) | 单元测试框架 |

## 项目结构

```text
md-genedai/
├── src/
│   ├── index.ts              # Router + conversion + extraction + job/deepcrawl endpoints
│   ├── types.ts              # Shared TS types (Env, extraction/job payloads, adapters)
│   ├── config.ts             # Limits, timeouts, UA and parser constants
│   ├── utils.ts              # Shared helpers (headers, parsing, formatting)
│   ├── converter.ts          # Readability + Turndown pipeline and content shaping
│   ├── security.ts           # SSRF guardrails, retry wrappers, safe fetch helpers
│   ├── paywall.ts            # Paywall heuristics + runtime rule updates
│   ├── proxy.ts              # Forward proxy + pool parsing/selection
│   ├── browser/
│   │   ├── index.ts          # Browser rendering orchestrator and capacity control
│   │   ├── stealth.ts        # Anti-detection hardening
│   │   └── adapters/         # 14 site-specific browser adapters
│   ├── cache/
│   │   └── index.ts          # KV conversion cache + R2 image storage
│   ├── extraction/
│   │   └── strategies.ts     # CSS/XPath/Regex structured extraction
│   ├── dispatcher/
│   │   ├── model.ts          # Job schema + KV persistence/idempotency
│   │   └── runner.ts         # Job execution and retry orchestration
│   ├── deepcrawl/
│   │   ├── bfs.ts            # BFS/BestFirst traversal core
│   │   ├── filters.ts        # Crawl filters (domains, patterns, content hints)
│   │   └── scorers.ts        # Keyword/domain scoring for BestFirst strategy
│   ├── session/
│   │   └── profile.ts        # Session profile capture/replay (cookie/localStorage)
│   ├── observability/
│   │   └── metrics.ts        # Throughput/success/retry/backlog/latency snapshots
│   ├── templates/
│   │   ├── landing.ts        # Landing page HTML
│   │   ├── rendered.ts       # Markdown preview page HTML
│   │   ├── loading.ts        # SSE loading/progress page HTML
│   │   └── error.ts          # Error page HTML
│   └── __tests__/            # 34 test files
├── docs/
│   └── slo-reference.md      # SLO targets used by /api/health operational metrics
├── scripts/
│   └── smoke-api.sh          # End-to-end API smoke checks for deployed/local worker
├── package.json
├── wrangler.toml             # Worker config: browser, KV, R2 bindings
├── tsconfig.json
├── vitest.config.ts
└── .gitignore
```

## 部署

项目使用 **Cloudflare Git Integration**：推送到 `main` 后会自动构建并发布。

### 一次性初始化

1. Fork 或推送本仓库到 GitHub。
2. 创建依赖资源：
   ```bash
   # 创建 KV namespace
   wrangler kv namespace create CACHE_KV
   # 把 namespace ID 写入 wrangler.toml

   # 创建 R2 bucket
   wrangler r2 bucket create md-images
   ```
3. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) > **Workers & Pages** > **Create** > **Import a Git repository**。
4. 选择对应 GitHub 仓库。之后每次推送到 `main` 都会自动部署。

### Secrets / 运行时变量

```bash
# 必需：受保护写接口的 Bearer 鉴权
# 用于：/api/batch, /api/extract, /api/jobs, /api/deepcrawl
wrangler secret put API_TOKEN

# 可选：保护 raw convert API + /api/stream
wrangler secret put PUBLIC_API_TOKEN

# 可选：动态 paywall 规则（JSON 数组）
wrangler secret put PAYWALL_RULES_JSON

# 可选：单一上游代理（格式：username:password@host:port）
wrangler secret put PROXY_URL

# 可选：代理池轮换/回退（逗号或换行分隔）
wrangler secret put PROXY_POOL
```

可选 KV 规则源：

- 通过普通 env 变量 `PAYWALL_RULES_KV_KEY` 指向 KV 中保存 paywall 规则 JSON 的 key。
- 若同时配置 `PAYWALL_RULES_JSON` 和 KV key，则 KV 值优先。

`wrangler.toml` 示例：

```toml
[vars]
PAYWALL_RULES_KV_KEY = "paywall:rules:v1"
```

### Browser Rendering 绑定

```toml
[browser]
binding = "MYBROWSER"
```

> 注意：Browser Rendering 需要 Workers 付费计划，仅在已部署 Worker 或 `wrangler dev --remote` 下可用。

### 自定义域名

1. Cloudflare Dashboard > Workers & Pages > 你的 Worker > **Settings** > **Domains & Routes**。
2. 添加自定义域名（例如 `md.example.com`）。

### 本地开发

```bash
npm install
npm run dev           # 本地开发：http://localhost:8787
npx tsc --noEmit      # 类型检查
npm test              # 运行单元测试
npm run test:watch    # watch 模式
npx vitest run --coverage
npm run smoke:api     # API 冒烟测试（需 BASE_URL + API_TOKEN）
```

冒烟测试示例：

```bash
BASE_URL="https://md.genedai.me" \
API_TOKEN="<api-token>" \
TARGET_URL="https://example.com" \
npm run smoke:api
```

### 准确测试基线（2026-02-23）

基于 **2026 年 2 月 23 日**的验证结果：

| 检查项 | 命令 | 结果 |
|---|---|---|
| 类型安全 | `npx tsc --noEmit` | Pass |
| 单元/集成测试 | `npm test` | Pass（`34` files, `376` tests） |
| 覆盖率 | `npx vitest run --coverage` | Pass（`Statements 86.29%`, `Branch 73.41%`, `Functions 93.36%`, `Lines 88.60%`） |
| 线上健康检查 | `curl https://website2markdown.genedai.workers.dev/api/health` | Pass（`HTTP 200`, `status=ok`） |
| 线上公开转换 | `GET /https://example.com?raw=true` | Pass（`HTTP 200`，返回 markdown） |

生产说明：

- 受保护写接口（`/api/extract`、`/api/jobs*`、`/api/deepcrawl`、`/api/batch`）需要 `API_TOKEN`。
- 若线上 Worker 未配置 `API_TOKEN`，这些端点会返回 `503`（`API_TOKEN not set`）。

## 许可证

MIT
