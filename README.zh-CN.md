# URL to Markdown 转换器

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![Live API](https://img.shields.io/badge/API-md.genedai.me-22d3ee)](https://md.genedai.me)
[![npm](https://img.shields.io/npm/v/@digidai/mcp-website2markdown?label=MCP%20Server)](https://www.npmjs.com/package/@digidai/mcp-website2markdown)
[![Agent Skills](https://img.shields.io/badge/Skills-website2markdown--skills-blue?logo=github)](https://github.com/Digidai/website2markdown-skills)
[![License](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)
[![CI](https://github.com/Digidai/website2markdown/actions/workflows/ci.yml/badge.svg)](https://github.com/Digidai/website2markdown/actions/workflows/ci.yml)

把**任意网页**转换为干净的 Markdown —— JS 驱动的 SPA、付费墙内容、中国平台（微信、知乎、飞书）都能搞定。基于 Cloudflare Workers，5 层 fallback 管线 + 14 个站点适配器。

### 快速开始

```bash
# 把任意 URL 转为 Markdown（立即试试！）
curl -H "Accept: text/markdown" https://md.genedai.me/https://example.com

# 微信公众号文章
curl -H "Accept: text/markdown" "https://md.genedai.me/https://mp.weixin.qq.com/s/文章ID"

# JSON 格式输出（含元数据）
curl "https://md.genedai.me/https://example.com?format=json&raw=true"
```

或直接在浏览器打开：**[md.genedai.me/https://example.com](https://md.genedai.me/https://example.com)**

需要浏览器渲染的页面（微信公众号、飞书、JS 重度 SPA），或需要更高的配额？
去 **[md.genedai.me/portal/](https://md.genedai.me/portal/)** 领取免费 API key。

## 工作原理

```
https://md.genedai.me/<目标URL>
```

### 转换流程

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
| **Jina** | 显式指定 `engine=jina` 或最终兜底 | 通过 Jina Reader API 转换，同时保留相同的输出格式接口 | `jina` |

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

### API Key 与套餐

在 **[md.genedai.me/portal/](https://md.genedai.me/portal/)** 用邮箱注册领取
API key。无需密码，登录链接会发到你的邮箱。

| 套餐 | 月额度 | 浏览器渲染 | proxy / engine 选择 |
|------|--------|------------|---------------------|
| **匿名**（无 key） | — | ❌ 只有缓存 + readability | ❌ |
| **Free** | 1,000 credits | ✅ | ❌ |
| **Pro** | 50,000 credits | ✅ | ✅（`engine=`、`no_cache=`、`force_browser=`） |

Credit 成本按**请求类型固定计算**，而不是按实际转换路径计费（这样即使某个
站点悄悄地从静态 HTML 切换到需要浏览器渲染，你的账单依然可以预测）：

| 端点 | Credits |
|---|---|
| `GET /<url>` | 1 |
| `GET /api/stream` | 1 |
| `POST /api/batch`（每个 URL） | 1 |
| `POST /api/extract` | 3 |
| `POST /api/deepcrawl`（每个 URL） | 2 |

付费套餐的缓存命中仍计 1 credit。月度额度用完时，API 仍然会服务已缓存的
URL（带 `X-Quota-Exceeded: true` 头），只有 cache miss 的请求会返回 `429`。

#### 使用你的 key

```bash
# Bearer header（推荐）
curl "https://md.genedai.me/https://example.com/page?raw=true" \
  -H "Authorization: Bearer mk_..."

# 旧的 ?token= query 参数形式仍然支持 PUBLIC_API_TOKEN 部署，
# 但不支持 mk_ key。不要把真实 API key 放在 query string 里 —
# 日志、referrer、监控截图都会记录它。
```

每个认证响应都包含 per-key 限流头：

```
X-RateLimit-Limit:     50000
X-RateLimit-Remaining: 49993
X-Request-Cost:        1
```

#### Portal API（session cookie）

在 `/portal/` 登录后，以下端点可以用同一个 session cookie 调用：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/me` | GET | 当前账户信息（email、tier、account_id） |
| `/api/keys` | GET | 列出你的 key（只显示前缀，永远不含明文） |
| `/api/keys` | POST | 创建新 key，明文**只返回一次** |
| `/api/keys/:id` | DELETE | 吊销 key（60 秒内生效 — LRU 缓存） |
| `/api/usage` | GET | 用量数据（tier、配额、已用、每日历史） |
| `/api/auth/logout` | POST | 销毁 session，清理 cookie |

`/api/usage` 也接受 `Authorization: Bearer mk_...` header，便于 SDK 和 CLI
工具无需 session 也能查询用量。

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

### Jina Reader 引擎

使用 `engine=jina` 通过 [r.jina.ai](https://r.jina.ai) 转换，跳过内置流程。适用于浏览器渲染不可用时的 JS 重度页面。免费版限制：20 RPM、2 并发、按 IP 限流。

```bash
curl "https://md.genedai.me/https://example.com?raw=true&engine=jina"
```

> 当 Readability 提取内容极少且无浏览器/代理路径时，Jina 也会作为最后兜底自动触发。

### 缓存控制

结果会缓存到 KV。若需跳过缓存：

```bash
curl "https://md.genedai.me/https://example.com?raw=true&no_cache=true"
```

### 批量转换

```bash
curl -X POST https://md.genedai.me/api/batch \
  -H "Authorization: Bearer <api-token>" \
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
- 对象项：`{ "url": "...", "format?": "markdown|html|text|json", "selector?": "...", "force_browser?": boolean, "no_cache?": boolean, "engine?": "jina" }`

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

补充说明：

- 顶层可直接传 `url` / `html`，也支持嵌套的 `input.url` / `input.html`。
- `schema.fields[*].required` 会在必填字段缺失时直接报错。
- `options` 支持 `dedupe`、`includeEmpty`、`regexFlags`。
- `include_markdown: true` 会把转换后的 markdown 一并返回。

### Job API（创建 / 查询 / 流式 / 执行）

任务会先以 KV 记录形式排队；只有调用 `/run` 时才会真正执行：

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

Job API 补充：

- 同时支持 `type: "crawl"` 和 `type: "extract"`。
- `type: "crawl"` 支持字符串 URL，也支持带 `format`、`selector`、`force_browser`、`no_cache` 的对象任务。
- `type: "extract"` 直接复用 `/api/extract` 的单条任务结构。
- `Idempotency-Key` 同时绑定 header 值与请求体：同 key 且同 payload 会返回已有任务；同 key 但不同 payload 会返回 `409 Conflict`。
- `priority` 会被规范到 `1..100`（默认 `10`），`maxRetries` 会被规范到 `0..10`（默认 `2`）。
- 单个 job 最多支持 `100` 个任务。

### Deep Crawl API

运行 BFS/BestFirst deep crawl，支持过滤/打分，以及显式开启的 checkpoint 续跑。

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

Deep Crawl 还支持：

- `include_external` 控制是否抓取站外链接。
- `filters.url_patterns`、`filters.allow_domains`、`filters.block_domains`、`filters.content_types`。
- `scorer.keywords`、`scorer.weight`、`scorer.score_threshold`。
- `output.include_markdown` 为每个结果附带 markdown。
- `fetch.selector`、`fetch.force_browser`、`fetch.no_cache` 控制页面转换方式。
- `checkpoint.crawl_id`、`checkpoint.resume`、`checkpoint.snapshot_interval`、`checkpoint.ttl_seconds`。

### 支持站点

| 站点 | 特性 |
|---|---|
| **WeChat** (`mp.weixin.qq.com`) | MicroMessenger UA、图片代理绕过防盗链 |
| **飞书/Lark 文档**（`.feishu.cn` / `.larksuite.com` 下的文档路径，例如 `/wiki`、`/docx`、`/docs`） | 虚拟滚动处理、R2 图片存储、页面噪音清理 |
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
| `/<url>?format=html` | GET | 返回用于预览/基础渲染的 HTML 输出 |
| `/<url>?format=text` | GET | 返回纯文本（无格式） |
| `/<url>?selector=.class` | GET | 提取指定 CSS 选择器 |
| `/<url>?force_browser=true` | GET | 强制浏览器渲染 |
| `/<url>?engine=jina` | GET | 使用 Jina Reader API，并保留相同的输出格式接口 |
| `/<url>?no_cache=true` | GET | 跳过 KV 缓存 |
| `/api/stream?url=<encoded-url>` | GET | SSE 转换流（`step` / `done` / `fail`），支持 `selector` / `force_browser` / `no_cache` / `engine` / `token` |
| `/api/batch` | POST | 批量转换（最多 10 条） |
| `/api/extract` | POST | 结构化提取 API（`css` / `xpath` / `regex`） |
| `/api/jobs` | POST | 创建排队的 crawl/extract 任务记录 |
| `/api/jobs/:id` | GET | 查询任务状态 |
| `/api/jobs/:id/stream` | GET | SSE 任务状态流 |
| `/api/jobs/:id/run` | POST | 执行该任务中队列/失败项 |
| `/api/deepcrawl` | POST | Deep Crawl（BFS/BestFirst，流式/非流式，断点续跑） |
| `/api/og` | GET | landing/rendered 页面使用的动态分享图 |
| `/img/<encoded-url>` | GET | 图片代理（绕过防盗链） |
| `/r2img/<key>` | GET | 从 R2 返回图片 |
| `/api/health` | GET | 健康检查 + 运行态 + 运营指标 |

## 鉴权矩阵

托管版 `md.genedai.me` 使用 D1 支持的 API key + 套餐系统（见
[API Key 与套餐](#api-key-与套餐)）。自部署可以不配置 `AUTH_DB` binding，
fallback 到 legacy 的 `API_TOKEN` / `PUBLIC_API_TOKEN` 单 token 模式。

| 路由组 | 匿名 | Free (`mk_…`) | Pro (`mk_…`) |
|---|---|---|---|
| `GET /<url>` | ✅ 缓存 + readability | ✅ 完整管线 | ✅ + `engine`、`no_cache`、`force_browser` |
| `GET /api/stream` | ✅ 缓存 + readability | ✅ 完整管线 | ✅ + 参数 |
| `POST /api/batch` | ❌ 401 | ✅ | ✅ |
| `POST /api/extract` | ❌ 401 | ✅ | ✅ |
| `POST /api/deepcrawl` | ❌ 401 | ✅ | ✅ |
| `POST /api/jobs*` | ❌ 401 | ✅ | ✅ |
| `GET /api/me`、`/api/keys`、`/api/usage` | — | session cookie | session cookie 或 Bearer key |
| `POST /api/auth/magic-link`、`/auth/logout` | 公开 | 公开 | 公开 |
| `GET /api/auth/verify` | 公开（single-use token） | — | — |
| `GET /portal/`（SPA） | 公开 HTML | — | — |
| `GET /api/health`、`/llms.txt`、`/robots.txt`、`/sitemap.xml` | 公开 | 公开 | 公开 |

batch / extract / deepcrawl / jobs 端点始终需要认证，因为它们要么会 fan-out
出大量转换，要么直接触发 Browser Rendering。

## 响应头（Raw API）

| Header | 说明 |
|---|---|
| `Content-Type` | `text/markdown`、`application/json`、`text/html` 或 `text/plain` |
| `X-Source-URL` | 原始目标 URL |
| `X-Markdown-Tokens` | Token 数（仅原生 Markdown for Agents） |
| `X-Markdown-Native` | 原生路径为 `"true"`，否则 `"false"` |
| `X-Markdown-Method` | `"native"`、`"readability+turndown"`、`"browser+readability+turndown"`、`"jina"`、`"cf"` |
| `X-Cache-Status` | `"HIT"` 或 `"MISS"` |
| `X-Markdown-Fallbacks` | 逗号分隔的兜底链路（如有） |
| `X-Browser-Rendered` | 使用浏览器渲染时为 `"true"` |
| `X-Paywall-Detected` | 命中付费墙规则时为 `"true"` |
| `X-RateLimit-Limit` | 月度 credit 配额（仅认证请求） |
| `X-RateLimit-Remaining` | 本月剩余 credits |
| `X-Request-Cost` | 该请求类型的固定 credit 成本 |
| `X-Quota-Exceeded` | 配额用完但返回了缓存内容时为 `"true"` |
| `Retry-After` | 在 `429` 响应中出现（IP 限流或配额超限） |
| `Access-Control-Allow-Origin` | `*`，已启用 CORS |

## 功能特性

| 功能 | 说明 |
|---|---|
| **任意网站** | 四条转换路径覆盖更多页面类型 |
| **站点适配器** | WeChat / Feishu / Zhihu / Yuque / Notion / Juejin 专项提取 |
| **反爬绕过** | Browser Rendering 处理 JS 挑战与验证场景 |
| **3 层缓存** | 内存 hot cache → Cloudflare Cache API（per-colo 免费）→ KV（全球持久） |
| **Developer Portal** | 自助注册、API key 管理、实时用量仪表盘 |
| **套餐系统** | 匿名（只有缓存+readability）、Free（1k/月）、Pro（50k/月） |
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

## AI Agent 集成

三种方式将 Website2Markdown 接入 AI Agent：

### Agent Skills（Claude Code、OpenClaw、Claw）

一条命令安装，Agent 自动发现。包含完整使用模式、错误处理和 21 个平台适配器指南。

```bash
# Claude Code
git clone https://github.com/Digidai/website2markdown-skills ~/.claude/skills/website2markdown

# Codex CLI
git clone https://github.com/Digidai/website2markdown-skills ~/.codex/skills/website2markdown

# Gemini CLI
git clone https://github.com/Digidai/website2markdown-skills ~/.gemini/skills/website2markdown

# OpenClaw
npx clawhub@latest install website2markdown
```

一条命令安装，新会话自动发现。完整文档见 [website2markdown-skills](https://github.com/Digidai/website2markdown-skills) 仓库。

### MCP Server（Claude Desktop、Cursor IDE、Windsurf）

标准 MCP 协议，提供 `convert_url` 工具。

```bash
npm install -g @digidai/mcp-website2markdown
```

Claude Desktop 配置（`~/.claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "website2markdown": {
      "command": "mcp-website2markdown",
      "env": {
        "WEBSITE2MARKDOWN_API_URL": "https://md.genedai.me"
      }
    }
  }
}
```

### llms.txt

遵循 llms.txt 标准的机器可读 API 描述，AI 系统可自动发现：

```
https://md.genedai.me/llms.txt
```

### 如何选择？

| | Skills | MCP Server | llms.txt |
|---|---|---|---|
| **适用** | CLI 类 Agent（Claude Code、OpenClaw） | IDE 类 Agent（Claude Desktop、Cursor） | 任何有 Web 访问的 AI |
| **延迟** | 直接 HTTP（最快） | MCP 协议开销 | 直接 HTTP |
| **上下文** | 丰富（模式、错误处理、适配器） | 仅工具 schema | API 描述 |
| **安装** | `git clone`（一条命令） | `npm install -g` | 无需 |

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
│   └── __tests__/            # 37 test files
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
npm run build         # Dry-run 打包到 dist/
npm run typecheck     # 类型检查
npm test              # 运行单元测试
npm run test:watch    # watch 模式
npm run test:coverage # 覆盖率
npm run smoke:api     # API 冒烟测试（需 BASE_URL + API_TOKEN）
```

Checkpoint 行为：

- 只有在传入 `checkpoint` 选项（如 `crawl_id`、`resume`、`snapshot_interval`、`ttl_seconds`）时，Deep Crawl 才会持久化 checkpoint。
- 如果省略 `checkpoint`，API 仍会返回 `crawlId` 作为追踪标识，但不会写入 checkpoint 记录。
- `resume` 请求必须与原始 crawl 配置一致；若过滤器、打分器或抓取选项发生变化，会返回 `409 Conflict`。

冒烟测试示例：

```bash
BASE_URL="https://md.genedai.me" \
API_TOKEN="<api-token>" \
TARGET_URL="https://example.com" \
npm run smoke:api
```

### 验证流程（2026-03-06）

本地请优先使用 Node 22（见 [`.nvmrc`](./.nvmrc)），或直接依赖 GitHub Actions 工作流 [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)：

| 检查项 | 命令 |
|---|---|
| 类型安全 | `npm run typecheck` |
| 单元/集成测试 | `npm test` |
| 覆盖率 | `npm run test:coverage` |
| Worker dry-run 打包 | `npm run build` |
| 线上健康检查 | `curl https://website2markdown.genedai.workers.dev/api/health` |
| 线上公开转换 | `GET /https://website2markdown.genedai.workers.dev/https://example.com?raw=true` |

生产说明：

- 受保护写接口（`/api/extract`、`/api/jobs*`、`/api/deepcrawl`、`/api/batch`）需要 `API_TOKEN`。
- 若线上 Worker 未配置 `API_TOKEN`，这些端点会返回 `503`（`API_TOKEN not set`）。

## 许可证

MIT
