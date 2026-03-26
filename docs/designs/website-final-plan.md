# 官网重构最终方案：多 Tab 架构 + SEO/GEO

> 合并自 website-seo-geo-plan.md 和 website-restructure-plan.md
> Review 修订：修复 8 个问题（robots.txt 逻辑、Schema 占位符、CF WAF tradeoff 等）

## 现状诊断

### 严重问题

| # | 问题 | 影响 | 修复方式 |
|---|------|------|----------|
| 1 | 所有 AI 爬虫被 CF Bot Fight Mode 拦截 | AI 搜索引擎无法索引 | CF WAF 白名单规则 |
| 2 | 无 robots.txt 路由 | 爬虫无法获取规则 | 新 handler |
| 3 | 无 sitemap.xml | 搜索引擎无法发现页面 | 新 handler |
| 4 | HTML 无语义结构 | SEO 权重损失 | header/main/section/footer |
| 5 | 只有 1 个 Schema.org 类型 | Featured Snippets 无法触发 | 扩充到 4 类型 |
| 6 | 首页信息过载 | 像 README 不像产品 | 3 Tab 分流 |
| 7 | 无 hreflang | 多语言 SEO 缺失 | meta 标签 |
| 8 | 无 speakable 标记 | AI 语音不可读 | Schema 属性 |

### 已有基础
- ✅ Open Graph + Twitter Card
- ✅ llms.txt（/llms.txt + /.well-known/llms.txt）
- ✅ canonical URL
- ✅ 中英文双语
- ✅ Schema.org WebApplication（基础）

---

## 架构设计

### 设计原则

```
首页 → 「为什么用？」（价值、场景、信任）
文档 → 「怎么用？」（API、参数、curl）
集成 → 「怎么接入我的 Agent？」（Skills、MCP、llms.txt）
```

### 3 Tab 结构

用前端 JS tab 切换（不加路由），所有内容在同一 HTML 中。
- SEO 友好（爬虫可读全部内容）
- 零延迟切换
- URL hash 跳转（/#docs, /#integration）

```
┌──────────────────────────────────────────────────────┐
│  [Home]  [Docs]  [Integration]          [EN] [中文]   │
└──────────────────────────────────────────────────────┘
```

---

### Tab 1: Home（首页）

**目标：** 30 秒理解价值，立即试用。

```
<header>
  <nav> Tab 导航 + 语言切换 </nav>
</header>

<main>
  <section id="hero">
    Badge: "Open Source · Apache-2.0"
    h1: "Any URL to Markdown, instantly"
    subtitle: "For AI agents, LLMs, and developers"
    [输入框 + 转换按钮]
    hint: 支持格式/参数提示
  </section>

  <section id="why">
    "Why Website2Markdown"
    ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
    │ Works Where    │ │ AI-Native      │ │ Production     │
    │ Others Fail    │ │                │ │ Ready          │
    │                │ │ MCP Server,    │ │                │
    │ JS-heavy SPA,  │ │ Agent Skills,  │ │ 566 tests,     │
    │ paywalled,     │ │ llms.txt —     │ │ 5 fallback     │
    │ anti-bot. 21   │ │ your agent     │ │ layers, KV     │
    │ Chinese & intl │ │ just works.    │ │ cache, edge    │
    │ platforms.     │ │                │ │ deployed.      │
    └────────────────┘ └────────────────┘ └────────────────┘
  </section>

  <section id="use-cases">
    "Use Cases"
    6 卡片（2x3 grid，移动端 1 列）:

    [SVG icon] AI Agents Reading the Web
       Feed any web page to your LLM in clean Markdown.
       Works with Claude, GPT, Gemini, any agent.

    [SVG icon] Knowledge Base Building
       Crawl docs, wikis, blogs with deep crawl API.
       BFS or keyword-scored, with checkpoints.

    [SVG icon] Content Migration
       Move from any CMS to Markdown.
       Batch convert up to 10 URLs per request.

    [SVG icon] Research & Analysis
       Read any article — no login walls,
       no JS rendering headaches.

    [SVG icon] Chinese Web Content
       WeChat, Zhihu, Feishu, Yuque, Juejin,
       CSDN, 36Kr, Weibo — all supported.

    [SVG icon] Structured Data Extraction
       Extract title, price, author from any page.
       CSS selectors, XPath, or Regex.

    注：用 inline SVG 或 CSS 图标（Lucide/Feather 风格），不用 emoji。

    下方紧接平台列表条：
    "21 Platform Adapters"
    横向 wrap 展示（pill 标签风格）：
    WeChat · Zhihu · Feishu · Yuque · Juejin · CSDN ·
    36Kr · Toutiao · Weibo · NetEase · Twitter/X ·
    Reddit · Notion · GitHub · Substack · Medium · ...
  </section>

  <section id="how-it-works">
    "How it works"
    3 个 inline 步骤（紧凑横排，与 Why 区域同风格）：
    ① Prepend URL → ② Edge pipeline (5 layers) → ③ Clean output
    一行标题 + 步骤条，不展开详细解释
  </section>

  <section id="faq">
    "FAQ"
    可折叠问答（同时作为 FAQPage Schema，答案从 i18n 生成）:

    Q: What is Website2Markdown?
    A: A free, open-source API that converts any web page URL to clean
       Markdown. Built on Cloudflare Workers with 5-layer fallback:
       native edge Markdown → Readability → headless browser → CF REST
       API → Jina Reader.

    Q: Is it free?
    A: Yes, completely free and open source under Apache-2.0.
       Self-host or use the managed service at md.genedai.me.

    Q: Which platforms are supported?
    A: 21 built-in adapters: WeChat, Zhihu, Feishu/Lark, Yuque,
       Juejin, CSDN, 36Kr, Toutiao, Weibo, NetEase, Twitter/X,
       Reddit, Notion, and more. Any public URL works via generic
       fallback.

    Q: How does it handle JS-heavy pages?
    A: Automatic 5-layer fallback. If native extraction fails,
       it escalates to Readability, then headless Chrome via
       Cloudflare Browser Rendering, then Jina Reader as last resort.
       Use ?force_browser=true to skip straight to browser rendering.

    Q: How to integrate with my AI agent?
    A: Three ways: (1) Agent Skills for Claude Code/OpenClaw — one
       command install. (2) MCP Server for Claude Desktop/Cursor.
       (3) llms.txt for auto-discovery by any AI system.

    Q: How to use the API?
    A: Prepend md.genedai.me/ before any URL. For raw Markdown, add
       ?raw=true. Example: curl "https://md.genedai.me/https://example.com?raw=true"
       See the Docs tab for full API reference.
  </section>

  <section id="example">
    "Try an example"
    [可点击的示例 URL]
  </section>
</main>

<footer>
  GitHub · npm · Skills · llms.txt · Apache-2.0
  © 2026 Digidai
</footer>
```

### Tab 2: Docs（文档）

内容从当前首页的 API Reference 区域迁移过来，不需要新写。

```
<section id="docs">
  <section id="quickstart">
    "Quick Start"
    3 行 curl 示例（raw / json / batch）
  </section>

  <section id="api-ref">
    "API Reference"
    路由表（GET /{url}, /api/stream, /api/batch, ...）
  </section>

  <section id="params">
    "Query Parameters"
    参数表（raw, format, selector, force_browser, engine, no_cache, token）
  </section>

  <section id="auth">
    "Authentication"
    公开/私有端点说明
  </section>

  <section id="curl-examples">
    "curl Examples"
    5 个完整 curl 示例
  </section>

  <section id="response-headers">
    "Response Headers"
    X-Markdown-Method, X-Cache-Status, X-Source-URL
  </section>
</section>
```

### Tab 3: Integration（集成）

内容从当前的 AI Agent Integration 区域迁移 + 扩充。

```
<section id="integration">
  <section id="decision-tree">
    "Choose Your Integration"
    ┌─ 你的 Agent 有终端吗？
    │  YES → Agent Skills（最快，上下文最丰富）
    │  NO  → MCP Server
    └─ 所有 AI → llms.txt 自动发现
  </section>

  <section id="skills-install">
    "Agent Skills"
    适用：Claude Code, OpenClaw, Claw, Codex

    Claude Code:
    $ git clone ...skills ~/.claude/skills/website2markdown

    OpenClaw:
    $ npx clawhub@latest install website2markdown

    自动发现，无需额外配置。
  </section>

  <section id="mcp-install">
    "MCP Server"
    适用：Claude Desktop, Cursor IDE, Windsurf

    $ npm install -g @digidai/mcp-website2markdown

    Claude Desktop (~/.claude/claude_desktop_config.json):
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

    Cursor (Settings → MCP Servers → Add):
    command: mcp-website2markdown
  </section>

  <section id="llmstxt">
    "llms.txt"
    适用：任何有 web 访问的 AI 系统

    https://md.genedai.me/llms.txt
    遵循 llms.txt.org 标准
  </section>

  <section id="comparison">
    "Comparison"
    |            | Skills | MCP   | llms.txt |
    |------------|--------|-------|----------|
    | 延迟       | ★★★    | ★★    | ★★★      |
    | 上下文     | ★★★    | ★     | ★★       |
    | 安装       | 1 条命令 | 1 条命令 | 无需   |
    | 最适合     | CLI AI | IDE AI | 全部    |
  </section>
</section>
```

---

## SEO 实施

### robots.txt

新增 `src/handlers/seo.ts`，在 `src/index.ts` 注册路由。

```
User-agent: *
Allow: /
Allow: /llms.txt
Allow: /.well-known/llms.txt
Allow: /api/health
Disallow: /api/batch
Disallow: /api/extract
Disallow: /api/deepcrawl
Disallow: /api/jobs
Disallow: /api/stream
Disallow: /r2img/
Disallow: /img/

# AI crawlers — welcome on public pages, same Disallow rules apply
# (no separate Allow: / to avoid overriding Disallow on /api/* endpoints)

Sitemap: https://md.genedai.me/sitemap.xml
```

### sitemap.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://md.genedai.me/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://md.genedai.me/"/>
    <xhtml:link rel="alternate" hreflang="zh" href="https://md.genedai.me/?lang=zh"/>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://md.genedai.me/?lang=zh</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://md.genedai.me/llms.txt</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>
```

### Schema.org（4 类型，合并为 @graph）

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "name": "Website2Markdown",
      "alternateName": "md.genedai.me",
      "description": "Convert any URL to clean, readable Markdown...",
      "url": "https://md.genedai.me/",
      "applicationCategory": "DeveloperApplication",
      "operatingSystem": "Any",
      "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
      "featureList": [
        "URL to Markdown conversion",
        "21 platform adapters",
        "Batch API",
        "Structured extraction",
        "Deep crawl",
        "MCP Server",
        "Agent Skills",
        "llms.txt"
      ],
      "softwareVersion": "1.0.0",
      "license": "https://www.apache.org/licenses/LICENSE-2.0",
      "codeRepository": "https://github.com/Digidai/website2markdown",
      "sameAs": [
        "https://github.com/Digidai/website2markdown",
        "https://www.npmjs.com/package/@digidai/mcp-website2markdown",
        "https://github.com/Digidai/website2markdown-skills"
      ],
      "speakable": {
        "@type": "SpeakableSpecification",
        "cssSelector": ["h1", ".subtitle", "#faq"]
      }
    },
    {
      "@type": "Organization",
      "name": "Digidai",
      "url": "https://md.genedai.me",
      "sameAs": ["https://github.com/Digidai"]
    },
    {
      "@type": "FAQPage",
      "mainEntity": "<<< 实现时从 i18n FAQ 字符串动态生成 6 个 Question 对象 >>>"
      // 示例输出（实际由代码从 t.faqN_q / t.faqN_a 生成）：
      // [
      //   {"@type":"Question","name":"What is Website2Markdown?",
      //    "acceptedAnswer":{"@type":"Answer","text":"A free, open-source API..."}},
      //   ...共 6 条
      // ]
      // 保证 HTML FAQ 文本和 Schema text 字段来自同一 i18n 源
    },
    {
      "@type": "HowTo",
      "name": "How to convert a URL to Markdown",
      "step": [
        {"@type":"HowToStep","name":"Prepend URL","text":"Add md.genedai.me/ before any web address"},
        {"@type":"HowToStep","name":"Edge Fetch","text":"Processed at the Cloudflare edge through 5-layer pipeline"},
        {"@type":"HowToStep","name":"Get Output","text":"Receive clean Markdown, JSON, HTML, or plain text"}
      ]
    }
  ]
}
```

### HTML meta 标签（新增）

```html
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta name="author" content="Digidai">
<link rel="alternate" hreflang="en" href="https://md.genedai.me/">
<link rel="alternate" hreflang="zh" href="https://md.genedai.me/?lang=zh">
<link rel="alternate" hreflang="x-default" href="https://md.genedai.me/">
```

---

## GEO（Generative Engine Optimization）

### AI 爬虫访问（最高优先级）

**Cloudflare Dashboard 操作（需手动）：**

Security → WAF → Custom Rules → 新建规则：

```
Rule name: Allow AI Crawlers
If: (http.user_agent contains "GPTBot") or
    (http.user_agent contains "ChatGPT-User") or
    (http.user_agent contains "ClaudeBot") or
    (http.user_agent contains "Claude-Web") or
    (http.user_agent contains "PerplexityBot") or
    (http.user_agent contains "Applebot") or
    (http.user_agent contains "Google-Extended") or
    (http.user_agent contains "Googlebot") or
    (http.user_agent contains "Bingbot")
Then: Skip (all remaining custom rules + Bot Fight Mode)
```

这是整个方案中**最关键的一步**。不做这个，其他 SEO/GEO 优化全部无效——AI 爬虫根本读不到内容。

**Tradeoff：** 跳过 Bot Fight Mode 意味着伪装 AI 爬虫 UA 的攻击者也能绕过 challenge。风险可控——API 端点已有独立的 rate limiting + auth，landing page 是纯静态 HTML 无敏感数据。收益远大于风险。

### 可引用性

- FAQ section 用清晰的 Q&A 格式，AI 搜索引擎直接引用
- 每个 FAQ answer 开头用一句话定义（适合摘录）
- speakable Schema 标记关键内容区域
- llms.txt 已有（保持）

---

## 实施步骤

| # | 任务 | 文件 | 估时 |
|---|------|------|------|
| 1 | 新增 seo.ts（robots.txt + sitemap.xml handler） | `src/handlers/seo.ts` + `src/index.ts` 路由 | 5 min |
| 2 | landing.ts 重构：Tab 架构 + JS 切换 | `src/templates/landing.ts` | 10 min |
| 3 | Tab 1 Home：优势卡片 + Use Cases + Platforms + FAQ | `src/templates/landing.ts` | 15 min |
| 4 | Tab 2 Docs：从现有 API Reference 迁移 | `src/templates/landing.ts` | 10 min |
| 5 | Tab 3 Integration：决策树 + 安装命令 + 对比表 | `src/templates/landing.ts` | 10 min |
| 6 | Schema.org @graph（4 类型）+ hreflang + meta | `src/templates/landing.ts` | 10 min |
| 7 | 语义化 HTML（header/main/section/footer） | `src/templates/landing.ts` | 5 min |
| 8 | 双语 i18n 完整 | `src/templates/landing.ts` | 10 min |
| 9 | 测试 + 部署 | — | 5 min |
| 10 | **CF WAF 爬虫白名单（你手动）** | CF Dashboard | 5 min |

**总估时：** CC ~80 min + 你手动 5 min

---

## 验证清单

部署后验证：

- [ ] Tab 切换正常（Home / Docs / Integration）
- [ ] URL hash 跳转（/#docs, /#integration）
- [ ] 中英文双语完整
- [ ] GET /robots.txt 返回正确内容
- [ ] GET /sitemap.xml 返回有效 XML
- [ ] Schema.org 验证通过（Google Rich Results Test）
- [ ] FAQ 可折叠展开
- [ ] 移动端响应式布局正常
- [ ] AI 爬虫可访问（CF WAF 配置后）
- [ ] 566 测试仍全部通过
- [ ] "How it works" 保留在首页（轻量版）
- [ ] Schema FAQ 答案与 HTML FAQ 内容一致（非占位符）
- [ ] MCP 配置示例完整（Claude Desktop JSON + Cursor）
- [ ] Use Cases 用 SVG 图标而非 emoji
- [ ] Tab hidden 内容可被 Google 索引（验证 display:none 处理）
