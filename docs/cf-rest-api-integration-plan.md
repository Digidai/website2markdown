# Cloudflare Browser Rendering REST API 集成方案

> 日期：2026-03-12
> 状态：待实施
> 目标：将 CF Browser Rendering REST API 作为新引擎集成到 md-genedai，降低成本，同时保留对所有页面（含反爬页面）的 100% 覆盖能力。

---

## 第一部分：架构决策

**策略：新引擎 + 渐进切换（不替换现有模块）**

```
现有架构                          目标架构
─────────                        ─────────
engine=undefined (默认)           engine=undefined → 自动选择最优引擎（Week 4 起默认尝试 CF）
engine=jina                      engine=jina     (保留)
                                 engine=cf       (新增: 强制 CF /markdown)
                                 engine=local    (新增: 跳过 CF，走本地管线，deepcrawl 内部回退用)
                                 engine=cf_crawl (新增: CF /crawl，仅 deepcrawl 未来扩展)
```

### 核心理由

1. CF REST API **自报 bot 身份**（`CloudflareBrowserRenderingCrawler/1.0`）、**遵守 robots.txt**、**不绕过 CAPTCHA/Turnstile** — 对微信/知乎/飞书等中文站完全无效
2. CF `/markdown` 的转换质量未经验证，不能盲切
3. 我们的 14 个适配器 + paywall 模块是核心竞争力，必须保留
4. 渐进式切换允许 A/B 对比质量，按站点逐步迁移

### CF REST API 可用端点

| 端点 | 用途 | render:false 免费？ |
|---|---|---|
| `POST /markdown` | URL → Markdown | 是（beta 期间） |
| `POST /content` | URL → 渲染后 HTML | 是（beta 期间） |
| `POST /crawl` | 多页异步爬取（job 生命周期） | 是（beta 期间） |
| `POST /scrape` | CSS 选择器结构化提取 | 是（beta 期间） |
| `POST /links` | 链接提取 | 是（beta 期间） |

**API 基础路径：** `https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/`

### CF REST API 关键限制（必须牢记）

- **自报 bot 身份**：UA 为 `CloudflareBrowserRenderingCrawler/1.0`
- **遵守 robots.txt**：如果网站禁止爬虫，CF 不会抓取
- **不绕过反爬**：无法通过 CAPTCHA、Turnstile、Cloudflare Bot Management
- **不支持自定义 UA**：无法伪装身份
- **不支持代理出口**：无法使用 Bright Data 等代理

---

## 第二部分：反爬页面的 100% 覆盖策略

### 三层防护机制

#### 第一层：前置过滤（`isCfEligible()`）

已知会被 CF 阻拦的站点直接跳过：

```typescript
// 注意：genericAdapter 当前未从 ./browser 导出，需新增导出
// 在 src/browser/index.ts 中添加: export { genericAdapter } from "./adapters/generic";
// 然后在 src/index.ts 的 import 块中添加 genericAdapter:
//   import { fetchWithBrowser, alwaysNeedsBrowser, getAdapter, getBrowserCapacityStats, genericAdapter } from "./browser";

function isCfEligible(url: string, env: Env): boolean {
  // 1. CF REST API 必须已配置
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return false;

  // 2. 排除有专属适配器的站点（CF 的 bot UA 必然被拦）
  const adapter = getAdapter(url);
  if (adapter !== genericAdapter) return false;

  // 3. 排除已知付费墙站点（CF 自报 bot，拿不到内容）
  if (getPaywallRule(url)) return false;

  return true;
}
```

被排除的站点（直接走现有 Puppeteer + adapter）：
- 微信公众号、知乎、飞书、Notion、Reddit、Twitter/X
- CSDN、掘金、36氪、头条、网易、微博、语雀
- 所有命中 paywall 规则的 URL

#### 第二层：CF 结果质量检测 + 自动回退

对于通过 `isCfEligible()` 的普通站点，CF 仍可能失败（robots.txt 禁止、其他反爬机制等）：

```typescript
// CF 尝试（在 convertUrl() 中，伪代码概览，完整实现见第四部分 Step 3）
if (await isCfEligible(url, env)) {
  try {
    const cfConfig = getCfRestConfig(env);
    const cfResult = await fetchViaCfMarkdown(url, cfConfig, {
      render: needsRender,
      signal: abortSignal,
    });
    if (cfResult.markdown && cfResult.markdown.length > 100) {
      // CF 成功，直接用
      return { content: cfResult.markdown, method: "cf", ... };
    }
    // CF 返回空/短内容 → 不 return，继续走后续管线
    fallbacks.add("cf_empty_fallthrough");
  } catch (e) {
    console.warn("CF REST API failed, falling through:", errorMessage(e));
    fallbacks.add("cf_error_fallthrough");
  }
}

// 后续：现有的 fetch → Readability+Turndown → Puppeteer → Jina 完整管线
```

**关键：CF 失败不中断流程**，代码直接 fall through 到后续阶段。

#### 第三层：现有管线完整保留

所有现有能力一个都不删：
- **Puppeteer（MYBROWSER binding）**：我们自己的无头浏览器，不受 robots.txt 限制，配合 stealth.ts 反指纹检测
- **14 个 site adapter**：针对性处理各大平台的登录墙/反爬
- **Paywall bypass**：Googlebot UA 伪装、referer 欺骗、Wayback/Archive.today 回退、AMP 剥离
- **Proxy retry**：通过 Bright Data 等代理池绕过 IP 封锁
- **Jina Reader API**：最终兜底

### 完整流程图

```
URL 进入
  │
  ├─ adapter 匹配？──→ 直接走 Puppeteer + adapter（跳过 CF）
  ├─ paywall 规则？──→ 直接走 paywall bypass（跳过 CF）
  │
  ├─ CF REST API 尝试
  │    ├─ 成功（内容 >100 字符）──→ 返回结果 ✓
  │    └─ 失败/空/被拦 ──→ 继续 ↓
  │
  ├─ fetch + Readability+Turndown
  │    ├─ 成功 ──→ 返回结果 ✓
  │    └─ 失败 ──→ 继续 ↓
  │
  ├─ Puppeteer + Readability+Turndown
  │    ├─ 成功 ──→ 返回结果 ✓
  │    └─ 失败 ──→ 继续 ↓
  │
  └─ Jina Reader API（最终兜底）──→ 返回结果 ✓
```

### 负缓存优化（可选增强）

避免对同一站点反复尝试 CF：

```typescript
const CF_BLOCKED_DOMAINS_TTL = 24 * 60 * 60; // 24h

// genericAdapter 需从 "./browser" 导入（见第四部分 Step 3 的 import 说明）
async function isCfEligible(url: string, env: Env): Promise<boolean> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return false;
  const adapter = getAdapter(url);
  if (adapter !== genericAdapter) return false;
  if (getPaywallRule(url)) return false;

  // 检查负缓存：该域名 CF 是否曾失败
  const domain = new URL(url).hostname;
  const blocked = await env.CACHE_KV.get(`cf_blocked:${domain}`);
  if (blocked) return false;

  return true;
}

// CF 失败时写入负缓存
if (!cfResult.markdown || cfResult.markdown.length <= 100) {
  await env.CACHE_KV.put(
    `cf_blocked:${domain}`, "1",
    { expirationTtl: CF_BLOCKED_DOMAINS_TTL }
  );
}
```

---

## 第三部分：测试计划

### Phase 1：CF REST API 基础可用性测试

**文件：`scripts/test-cf-api.ts`** — 独立脚本，不依赖 Worker 运行时

| 测试项 | 验证点 |
|---|---|
| /markdown 端点连通性 | Bearer token 认证、200 响应 |
| /markdown render:false | 返回 markdown 字符串、无 browser 计费 |
| /markdown render:true | 返回 markdown、X-Browser-Ms-Used 头 |
| /content 端点 | 返回完整渲染 HTML |
| /crawl 端点 job 生命周期 | POST→job_id, GET→running→completed |
| /crawl render:false | 不计费、快速返回 |
| /scrape CSS 选择器 | 返回 text/html/attributes |
| 错误处理 | 无效 URL、超时、认证失败 |
| 速率限制 | 连续请求后的 429 行为 |

### Phase 2：Markdown 质量对比测试（关键）

**文件：`scripts/quality-compare.ts`** — 对比 CF `/markdown` vs 我们的 Readability+Turndown

**测试 URL 矩阵（30 个代表性 URL）：**

| 类别 | URL 示例 | 测试要点 |
|---|---|---|
| 英文新闻 | bbc.com, reuters.com 文章 | 标题、正文完整性、图片保留 |
| 技术文档 | MDN, docs.python.org | 代码块保真度、表格、嵌套列表 |
| 博客 | medium.com, dev.to | 格式保留、代码高亮标记 |
| 中文站（render:false） | 简单博客、静态站 | 中文标题/正文、编码正确 |
| 表格密集型 | Wikipedia 信息框 | 表格 → markdown table 质量 |
| 代码密集型 | GitHub README | 围栏代码块、语言标记 |
| 长文章 | 3000+ 字文章 | 内容截断检查 |
| 极简页面 | 纯文本页面 | 不丢内容 |
| 复杂布局 | 多栏、侧边栏 | 主内容提取准确性 |
| SPA（render:true） | React/Vue 应用 | JS 渲染后内容完整性 |

**对比指标：**

1. **内容完整性**：字符数比值 (CF / 我们)，目标 ≥ 0.9
2. **标题提取**：完全匹配率
3. **结构保真度**：标题层级 (h1-h6) 数量匹配
4. **代码块保真度**：代码块数量 + 语言标记匹配
5. **链接保留率**：有效链接数量比
6. **表格保留**：表格行数匹配
7. **图片引用**：img markdown 数量匹配

**质量通过标准：**

- 内容完整性 ≥ 0.85 的 URL 占比 ≥ 80%
- 标题提取完全匹配 ≥ 90%
- 无任何 URL 返回空内容（CF 返回空时必须回退到我们的管线）

### Phase 3：性能与成本对比测试

| 测试项 | 指标 |
|---|---|
| render:false 延迟 | CF vs 我们的 fetch+Readability+Turndown (目标: CF ≤ 2x) |
| render:true 延迟 | CF vs 我们的 fetchWithBrowser (目标: CF ≤ 1.5x) |
| /crawl 10 页耗时 | CF async job vs 我们的同步 BFS |
| browser 时间计费 | X-Browser-Ms-Used 统计 |
| 并发吞吐 | 10 个并发 render:false 请求 |
| 大页面处理 | 5MB+ 页面的成功率 |

### Phase 4：集成测试（Worker 内）

**文件：`src/__tests__/cf-rest.test.ts`** 和 **`src/__tests__/cf-integration.test.ts`**

```typescript
// Mock CF REST API responses
describe("CF REST API engine", () => {
  describe("fetchViaCfMarkdown()", () => {
    it("returns markdown for simple HTML page")
    it("falls back to local conversion on CF API error")
    it("falls back to local conversion on empty CF response")
    it("falls back to local conversion on CF timeout")
    it("falls back to local conversion on CF rate limit (429)")
    it("respects abort signal")
    it("passes custom headers when configured")
    it("tracks browser seconds used in metrics")
  })

  describe("convertUrl() with engine=cf", () => {
    it("uses CF /markdown for eligible URLs")
    it("skips CF for adapter-matched URLs (wechat, zhihu, etc.)")
    it("skips CF for paywalled URLs")
    it("skips CF for negative-cached domains")
    it("caches CF results in KV")
    it("returns cached CF results on subsequent requests")
  })

  describe("deep crawl with CF /crawl", () => {
    it("submits crawl job and polls for results")
    it("maps CF results to our DeepCrawlNode format")
    it("handles CF job timeout gracefully")
    it("falls back to local crawl on CF error")
    it("respects includePatterns/excludePatterns mapping")
  })

  describe("batch with CF /markdown", () => {
    it("uses CF for eligible URLs in batch")
    it("mixes CF and local conversion in same batch")
    it("handles partial CF failures gracefully")
  })
})
```

### Phase 5：回归测试

```bash
npm run test          # 所有 ~40 个测试文件通过
npm run typecheck     # TypeScript 无错误
npm run build         # 构建成功
```

---

## 第四部分：实现步骤

### Step 1：新增 CF REST API 客户端模块

**新建文件：`src/cf-rest.ts`（~200 行）**

```typescript
export interface CfRestConfig {
  accountId: string;
  apiToken: string;
  timeoutMs?: number;
}

export interface CfMarkdownResult {
  markdown: string;
  browserMsUsed?: number;
}

export interface CfCrawlJobResult {
  jobId: string;
  status: string;
  browserSecondsUsed: number;
  total: number;
  finished: number;
  records: CfCrawlRecord[];
  cursor?: number;
}

export interface CfCrawlRecord {
  url: string;
  status: string;
  markdown?: string;
  html?: string;
  metadata?: { status: number; title: string; url: string };
}

// POST /markdown — 单页 Markdown 转换
export async function fetchViaCfMarkdown(
  targetUrl: string,
  config: CfRestConfig,
  options?: {
    render?: boolean;
    waitForSelector?: string;
    userAgent?: string;
    rejectResourceTypes?: string[];
    gotoOptions?: { waitUntil?: string; timeout?: number };
    signal?: AbortSignal;
  },
): Promise<CfMarkdownResult>;

// POST /content — 获取渲染后 HTML
export async function fetchViaCfContent(
  targetUrl: string,
  config: CfRestConfig,
  options?: {
    render?: boolean;
    waitForSelector?: string;
    signal?: AbortSignal;
  },
): Promise<string>;

// POST /crawl — 发起爬取任务
export async function submitCfCrawlJob(
  seedUrl: string,
  config: CfRestConfig,
  options?: {
    limit?: number;
    depth?: number;
    formats?: string[];
    render?: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
    includeExternalLinks?: boolean;
    includeSubdomains?: boolean;
  },
): Promise<string>; // returns jobId

// GET /crawl/{jobId} — 查询爬取结果
export async function getCfCrawlResults(
  jobId: string,
  config: CfRestConfig,
  options?: { limit?: number; cursor?: number; status?: string },
): Promise<CfCrawlJobResult>;

// DELETE /crawl/{jobId} — 取消爬取
export async function cancelCfCrawlJob(
  jobId: string,
  config: CfRestConfig,
): Promise<void>;
```

### Step 2：扩展 Env 类型和 config

**修改 `src/types.ts`：**

```typescript
export interface Env {
  // ... 现有字段 ...
  /** Cloudflare Account ID for REST API calls */
  CF_ACCOUNT_ID?: string;
  /** Cloudflare API Token with Browser Rendering - Edit permission */
  CF_API_TOKEN?: string;
}

export type ConvertMethod =
  | "native"
  | "readability+turndown"
  | "browser+readability+turndown"
  | "jina"
  | "cf";  // 新增
```

**修改 `src/config.ts`：**

```typescript
export const CF_REST_TIMEOUT_MS = 30_000;
export const CF_CRAWL_POLL_INTERVAL_MS = 3_000;
export const CF_CRAWL_MAX_POLL_ATTEMPTS = 360; // 30 min max
export const CF_BLOCKED_DOMAINS_TTL = 24 * 60 * 60; // 24h negative cache
```

**修改 `wrangler.toml`：** 新增 secrets 注释

```toml
# Secrets (set via wrangler secret):
# API_TOKEN — Bearer token for POST /api/batch authentication
# PUBLIC_API_TOKEN — optional token for raw API + /api/stream
# CF_ACCOUNT_ID — Cloudflare account ID for Browser Rendering REST API
# CF_API_TOKEN — API token with Browser Rendering - Edit permission
```

### Step 3：在 convertUrl() 中集成 CF 引擎

**修改 `src/index.ts` 中的 `convertUrl()` 函数**

在 Phase 2a（Jina 快速路径，约 Line 800）之后，新增 Phase 2b：

```typescript
// 2b. CF Markdown fast path
// Week 1-3: 仅 engine=cf 显式请求进入
// Week 4: 改为默认也进入（!engine 条件），即 engine 为 undefined 时也自动尝试 CF
if (engine === "cf" || ((!engine || engine === "auto") && await isCfEligible(targetUrl, env))) {
  const cfConfig = getCfRestConfig(env);
  if (cfConfig) {
    await progress("fetch", "Converting via Cloudflare");
    try {
      const needsRender = forceBrowser || alwaysNeedsBrowser(targetUrl);
      const cfResult = await fetchViaCfMarkdown(targetUrl, cfConfig, {
        render: needsRender,
        signal: abortSignal,
      });

      if (cfResult.markdown && cfResult.markdown.length > 100) {
        const cfTitle = extractTitleFromCfMarkdown(cfResult.markdown);
        sourceContentType = "text/markdown";

        // 按 format 输出（同 Jina 路径的 switch 逻辑）
        let output: string;
        switch (format) {
          case "html":
            output = markdownToBasicHtml(cfResult.markdown);
            break;
          case "text":
            output = markdownToPlainText(cfResult.markdown);
            break;
          case "json":
            output = JSON.stringify({
              url: targetUrl, title: cfTitle, markdown: cfResult.markdown,
              method: "cf", timestamp: new Date().toISOString(),
            });
            break;
          default:
            output = cfResult.markdown;
        }

        if (!noCache) {
          await setCache(env, targetUrl, format, {
            content: output, method: "cf", title: cfTitle, sourceContentType,
          }, selector, undefined, engine);
        }

        return {
          content: output,
          title: cfTitle,
          method: "cf" as ConvertMethod,
          tokenCount: "",
          sourceContentType,
          cached: false,
          diagnostics: {
            cacheHit: false,
            browserRendered: false,
            paywallDetected: false,
            fallbacks: [],
          },
        };
      }
      // CF 返回空/短内容 → 落入后续路径
      fallbacks.add("cf_empty_fallthrough");
      // 写入负缓存
      const domain = new URL(targetUrl).hostname;
      await env.CACHE_KV.put(
        `cf_blocked:${domain}`, "1",
        { expirationTtl: CF_BLOCKED_DOMAINS_TTL }
      ).catch(() => {}); // 静默失败
    } catch (e) {
      console.warn("CF REST API failed, falling through:", errorMessage(e));
      fallbacks.add("cf_error_fallthrough");
    }
  }
}
```

**新增辅助函数：**

```typescript
function getCfRestConfig(env: Env): CfRestConfig | null {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;
  return { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN };
}

// 从 CF 返回的 markdown 中提取标题（取第一个 # 开头的行）
// 注意：项目中不存在此函数，需新建
function extractTitleFromCfMarkdown(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

// 需在 src/browser/index.ts 新增导出: export { genericAdapter } from "./adapters/generic";
// 需在 src/index.ts import 块新增: genericAdapter (从 "./browser" 导入)
async function isCfEligible(url: string, env: Env): Promise<boolean> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return false;

  const adapter = getAdapter(url);
  if (adapter !== genericAdapter) return false;

  if (getPaywallRule(url)) return false;

  // 检查负缓存
  const domain = new URL(url).hostname;
  const blocked = await env.CACHE_KV.get(`cf_blocked:${domain}`);
  if (blocked) return false;

  return true;
}
```

### Step 4：Deep Crawl 集成 CF

**在 `src/index.ts` 的 `executeDeepCrawl()` 中修改 `fetchPage` 回调**

不替换现有 BFS/Best-First 引擎，而是让 fetchPage 优先使用 CF `/content`（需要 HTML 做链接发现）：

```typescript
const fetchPage = async (url, context) => {
  if (!isValidUrl(url) || !isSafeUrl(url)) {
    throw new Error("Invalid or blocked URL.");
  }

  // 优先尝试 CF /content（返回 HTML，可用于链接发现）
  const cfConfig = getCfRestConfig(env);
  if (cfConfig && await isCfEligible(url, env)) {
    try {
      const cfHtml = await fetchViaCfContent(url, cfConfig, {
        render: false,
        signal: context.signal,
      });
      if (cfHtml && cfHtml.length > 200) {
        // 用 htmlToMarkdown 同时获取 title 和 markdown
        const parsed = htmlToMarkdown(cfHtml, url, payload.selector);
        return {
          url,
          html: cfHtml, // 用于 extractLinksFromHtml() 链接提取
          markdown: payload.includeMarkdown ? parsed.markdown : undefined,
          title: parsed.title,
          method: "cf",
        };
      }
    } catch { /* fall through to convertUrl */ }
  }

  // 回退到原有 convertUrl 路径
  // 传 engine="local" 跳过 CF（避免上面已试过 CF 的重复调用）
  const converted = await convertUrlWithMetrics(
    url, env, host, "html",
    payload.selector, payload.forceBrowser, payload.noCache,
    undefined, context.signal,
    "local", // 跳过 CF，直接走 fetch→Readability→Puppeteer→Jina
  );

  let markdown: string | undefined;
  if (payload.includeMarkdown) {
    const md = htmlToMarkdown(converted.content, url, payload.selector);
    markdown = md.markdown;
  }

  return {
    url,
    html: converted.content,
    markdown,
    title: converted.title,
    method: converted.method,
    contentType: converted.sourceContentType || undefined,
  };
};
```

**重要说明：**
- Deep crawl 使用 CF `/content`（返回 HTML）而非 `/markdown`，因为 `extractLinksFromHtml()` 需要 HTML 来发现链接
- CF `/markdown` 不返回 HTML，会导致链接发现失败

**可选未来增强：** 可以添加 `strategy: "cf_crawl"` 使用 CF `/crawl` 端点完全替代 BFS/Best-First，适合不需要 SSE 流式输出或自定义评分的简单场景。

### Step 5：Batch 集成

**修改 `handleBatch()` 中的任务执行逻辑：**

```typescript
// 修改 handleBatch() 中 items.map 内的 convertUrlWithMetrics 调用（约 Line 4719）
// 将 item.engine 替换为 effectiveEngine
const effectiveEngine = item.engine ||
  (await isCfEligible(item.url, env) ? "cf" : undefined);
const result = await convertUrlWithMetrics(
  item.url,
  env,
  host,
  item.format,
  item.selector,
  item.forceBrowser,
  item.noCache,
  undefined,
  request.signal,     // 注意：不是 signal，是 request.signal
  effectiveEngine,    // 原为 item.engine
);
// 注：Week 4 开启 !engine 默认条件后，此修改可选移除（convertUrl 内部会自动检测）
```

---

## 第五部分：文件变更清单

| 操作 | 文件 | 变更说明 |
|---|---|---|
| **新建** | `src/cf-rest.ts` | CF REST API 客户端（~200 行） |
| **新建** | `src/__tests__/cf-rest.test.ts` | CF 客户端单元测试 |
| **新建** | `src/__tests__/cf-integration.test.ts` | CF 集成到 convertUrl/deepcrawl/batch 的测试 |
| **新建** | `scripts/quality-compare.ts` | 质量对比脚本 |
| **新建** | `scripts/test-cf-api.ts` | CF API 可用性测试脚本 |
| **修改** | `src/types.ts` | 添加 `CF_ACCOUNT_ID`, `CF_API_TOKEN` 到 Env；`ConvertMethod` 加 `"cf"` |
| **修改** | `src/config.ts` | 添加 CF 相关常量 |
| **修改** | `src/index.ts` | convertUrl() 加 CF 路径；deepcrawl fetchPage 加 CF 优先；新增 isCfEligible()、getCfRestConfig()、extractTitleFromCfMarkdown() |
| **修改** | `src/browser/index.ts` | 新增 `export { genericAdapter }` 导出（供 isCfEligible 使用） |
| **修改** | `wrangler.toml` | 注释标注新 secrets |
| **不动** | `src/converter.ts` | 保留，作为 CF 不可用时的回退 |
| **不动** | `src/browser/adapters/*` | 保留全部 14 个适配器 |
| **不动** | `src/paywall.ts` | 保留，CF 无法绕过付费墙 |
| **不动** | `src/proxy.ts` | 保留，CF 无自定义出口代理 |
| **不动** | `src/deepcrawl/*` | 保留 BFS/Best-First/filters/scorers |
| **不动** | `src/jina.ts` | 保留作为另一个引擎选项 |

---

## 第六部分：实施路线图

```
Week 1 — 基础 + 质量验证
  ├─ Day 1-2: 实现 src/cf-rest.ts + 单元测试
  ├─ Day 3:   实现 scripts/quality-compare.ts
  ├─ Day 4-5: 跑质量对比（30 URL × 2 引擎），产出对比报告
  └─ 决策门：质量达标 → 继续；否则 → 等 CF 改进

Week 2 — 集成 + 回归
  ├─ Day 1-2: convertUrl() 中集成 engine=cf 路径
  ├─ Day 3:   deepcrawl fetchPage 集成 CF /content
  ├─ Day 4:   batch 集成 + 集成测试
  └─ Day 5:   全量回归测试 (npm test + npm run typecheck)

Week 3 — 部署 + 观测
  ├─ Day 1:   设置 CF_ACCOUNT_ID + CF_API_TOKEN secrets (wrangler secret put)
  ├─ Day 2:   部署，engine=cf 仅对显式请求生效
  ├─ Day 3-5: 监控 /api/health 中的 CF 引擎指标
  └─ 决策门：成功率 ≥ 95% → 继续；否则 → 调优

Week 4 — 渐进切换
  ├─ Day 1:   对 genericAdapter 匹配的 URL 默认启用 CF（engine=auto）
  ├─ Day 2-3: 监控 fallback 率（cf_empty_fallthrough, cf_error_fallthrough）
  └─ Day 4-5: 调优 isCfEligible() 规则，负缓存生效，稳定后完成
```

---

## 第七部分：成本收益预估

| 项目 | 当前 | 集成 CF 后 | 节省 |
|---|---|---|---|
| **普通 HTML 转换** | 自有 CPU（Readability+Turndown） | CF render:false（beta 免费） | CPU 时间 ↓ |
| **浏览器渲染（通用站）** | Puppeteer 绑定：时间 + 并发费 | CF REST API：仅时间费 | **$2/额外并发 → $0** |
| **深度爬虫 per-page** | 每页独立 Puppeteer session | CF render:false（beta 免费） | 浏览器时间 ↓↓ |
| **代码维护** | converter.ts 维护负担 | CF 作为主路径，本地作为 fallback | 渐进减负 |
| **不变的** | 适配器站、付费墙站、代理站 | 完全不变 | — |

**保守估计：** 对于无需专属适配器的通用站点（约占流量 40-60%），浏览器时间成本可降低 **60-80%**（render:false 免费 + 无并发费）。适配器站的成本不变。

**render:false 定价：** Beta 期间免费，beta 结束后走 Workers 定价（约 $0.30/百万请求），仍然极便宜。

---

## 第八部分：关键风险与缓解

| 风险 | 概率 | 缓解措施 |
|---|---|---|
| CF markdown 质量不达标 | 中 | Phase 2 质量对比前置；不达标则不切 |
| CF API 延迟过高 | 低 | 同在 CF 网络内，延迟应可控；设 30s 超时 |
| CF render:false beta 突然结束 | 低 | 结束后走 Workers 定价（~$0.30/百万请求），仍很便宜 |
| CF API 限流影响可用性 | 中 | 所有 CF 调用有 fallback 到本地管线 |
| CF `/crawl` 不返回 HTML 导致链接发现失败 | — | deepcrawl 用 `/content` 而非 `/markdown` |
| 部分通用站点也拦截 bot UA | 中 | 负缓存 24h + 自动 fallback 到 Puppeteer |

---

## 参考链接

- CF Browser Rendering REST API 文档：`https://developers.cloudflare.com/browser-rendering/rest-api/`
- CF /markdown 端点文档：`https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/`
- CF /content 端点文档：`https://developers.cloudflare.com/browser-rendering/rest-api/content-endpoint/`
- CF /crawl 端点文档：`https://developers.cloudflare.com/browser-rendering/rest-api/crawl-endpoint/`
- CF /scrape 端点文档：`https://developers.cloudflare.com/browser-rendering/rest-api/scrape-endpoint/`
- CF /links 端点文档：`https://developers.cloudflare.com/browser-rendering/rest-api/links-endpoint/`
- CF Browser Rendering 定价：`https://developers.cloudflare.com/browser-rendering/platform/pricing/`
- 2026-03-10 changelog：`https://developers.cloudflare.com/changelog/post/2026-03-10-br-crawl-endpoint/`
