import { escapeHtml } from "../security";

type LandingLang = "en" | "zh";

export function landingPageHTML(host: string, lang: LandingLang = "en"): string {
  const h = escapeHtml(host);
  const isZh = lang === "zh";
  const t = isZh
    ? {
        htmlLang: "zh-CN",
        locale: "zh_CN",
        pageTitle: "任意 URL 转 Markdown",
        schemaDescription: "将任意 URL 即时转换为干净、可读的 Markdown。适用于 AI Agent、LLM 和开发者。",
        metaDescription:
          "把任意网页转换为干净、可读的 Markdown，并支持 SSE 流式转换、批量转换、结构化提取、任务编排和 Deep Crawl。适用于 AI Agent、LLM 和开发者。",
        shareDescription: `在任意 URL 前加上 ${h}/，即可快速获得干净、可读的 Markdown，并使用 stream / batch / extract / jobs / deepcrawl API。基于 Cloudflare Workers。`,
        langSwitchAria: "选择语言",
        // Header
        tabHome: "首页",
        tabDocs: "文档",
        tabIntegration: "集成",
        // Hero
        heroTitleHtml: "任意 URL 转 <em>Markdown</em>，即刻完成",
        heroSubtitle: "将任意网页转为干净 Markdown，为 AI Agent、LLM 与开发者而生。开源、边缘部署、21 个平台适配器。",
        inputPlaceholder: "粘贴任意 URL...",
        convertButton: "转换",
        convertingButton: "转换中",
        hintKeys: "format &middot; selector &middot; force_browser &middot; raw &middot; engine",
        // Why cards
        why1Title: "其他工具搞不定的，我们行",
        why1Desc: "JS 驱动的 SPA、付费墙内容、反爬网站。21 个适配器覆盖国内外主流平台。",
        why2Title: "天生为 AI 而造",
        why2Desc: "MCP Server、Agent Skills、llms.txt 开箱即用。你的 AI Agent 直接就能用，不需要胶水代码。",
        why3Title: "生产环境就绪",
        why3Desc: "568 项测试、5 层 fallback 管线、KV 缓存，部署在 Cloudflare Workers 边缘。",
        // Use cases
        useCasesTitle: "覆盖每种工作流",
        uc1Title: "AI Agent",
        uc1Desc: "把任意网页内容以干净 Markdown 喂给 LLM",
        uc2Title: "知识库构建",
        uc2Desc: "用深爬 API 抓取文档、Wiki、博客",
        uc3Title: "内容迁移",
        uc3Desc: "批量转换，一次最多 10 个 URL",
        uc4Title: "研究分析",
        uc4Desc: "任意文章，无需登录、无 JS 渲染困扰",
        uc5Title: "中文网站",
        uc5Desc: "微信公众号、知乎、飞书、语雀、CSDN...",
        uc6Title: "结构化提取",
        uc6Desc: "CSS 选择器、XPath 或正则表达式",
        platformsTitle: "21 个平台适配器",
        // How it works
        howTitle: "工作原理",
        step1Title: "添加前缀",
        step1Desc: "在任意网址前加上 md.genedai.me/",
        step2Title: "边缘处理",
        step2Desc: "5 层 fallback：原生 &rarr; Readability &rarr; 浏览器 &rarr; CF REST &rarr; Jina",
        step3Title: "干净输出",
        step3Desc: "Markdown、JSON、HTML 或纯文本",
        // FAQ
        faqTitle: "常见问题",
        faq1Q: "什么是 Website2Markdown？",
        faq1A: "一个免费、开源的 API，可将任意网页 URL 转为干净、可读的 Markdown。基于 Cloudflare Workers，5 层 fallback 管线：原生边缘 Markdown &rarr; Readability &rarr; 无头浏览器 &rarr; CF REST API &rarr; Jina Reader。",
        faq2Q: "它是免费的吗？",
        faq2A: "是的，完全免费并以 Apache-2.0 开源。你可以自行部署，也可以使用 md.genedai.me 的托管服务。",
        faq3Q: "支持哪些平台？",
        faq3A: "21 个内置适配器：微信公众号、知乎、飞书/Lark、语雀、掘金、CSDN、36氪、头条、微博、网易、Twitter/X、Reddit、Notion 等。任何公开 URL 都可通过通用 fallback 处理。",
        faq4Q: "如何处理 JS 渲染密集型页面？",
        faq4A: "自动 5 层 fallback。原生提取失败后，依次升级到 Readability、Cloudflare 无头 Chrome 浏览器渲染，最后 Jina Reader 兜底。使用 ?force_browser=true 可直接跳到浏览器渲染。",
        faq5Q: "如何与 AI Agent 集成？",
        faq5A: "三种方式：(1) Agent Skills——Claude Code/OpenClaw 一条命令安装。(2) MCP Server——Claude Desktop、Cursor IDE。(3) llms.txt——所有 AI 系统自动发现。",
        faq6Q: "如何使用 API？",
        faq6A: "在任意 URL 前加上 md.genedai.me/。获取原始 Markdown 加 ?raw=true。示例：curl \"https://md.genedai.me/https://example.com?raw=true\"。完整 API 参考见文档标签页。",
        // CTA
        ctaTitle: "立即试试。",
        // Docs tab
        quickStartTitle: "快速开始",
        curlRawComment: "# 获取原始 Markdown",
        curlJsonComment: "# 获取 JSON 输出",
        curlBatchComment: "# 批量转换",
        apiTitle: "API 参考",
        apiRouteTitle: "路由",
        apiGetDesc: "将单个 URL 转为 Markdown",
        streamDesc: "单 URL SSE 转换进度（step / done / fail）",
        batchDesc: "最多转换 10 个 URL（需要 API_TOKEN）",
        extractDesc: "结构化提取（css / xpath / regex）",
        jobsDesc: "任务创建、查询、状态流与执行",
        deepcrawlDesc: "BFS / BestFirst 深爬，支持过滤与打分",
        healthDesc: "健康检查与运营指标",
        ogDesc: "分享图生成",
        llmsTxtRouteDesc: "AI 可读的 API 描述",
        queryParamsTitle: "查询参数",
        rawDesc: "返回原始 Markdown（不包裹 HTML）",
        formatDesc: "输出格式",
        selectorDesc: "仅提取匹配的 CSS 选择器",
        forceBrowserDesc: "强制使用无头浏览器渲染",
        engineDesc: "使用指定引擎转换（jina / cf）",
        noCacheDesc: "绕过缓存，抓取最新内容",
        tokenDesc: "公开 API 令牌",
        authTitle: "鉴权",
        publicAuthDesc: "单 URL 转换与 /api/stream 支持 Bearer 或 ?token=...",
        privateAuthDesc: "/api/batch、/api/extract、/api/jobs*、/api/deepcrawl 需要 API_TOKEN",
        curlExamplesTitle: "curl 示例",
        curlRaw: "# 获取原始 markdown",
        curlJson: "# 获取 JSON 输出",
        curlBatch: "# 批量转换",
        curlExtract: "# 结构化提取",
        curlCrawl: "# Deep Crawl",
        responseHeadersTitle: "响应头",
        sourceUrlDesc: "原始目标 URL",
        bodyLabel: "请求体",
        returnsLabel: "返回",
        // Integration tab
        integrationTitle: "AI Agent 集成",
        decisionTreeTitle: "选择你的集成方式",
        decisionSkills: "你的 Agent 有终端吗？",
        decisionYes: "是 &rarr; Agent Skills（最快，上下文最丰富）",
        decisionNo: "否 &rarr; MCP Server",
        decisionAll: "所有 AI &rarr; llms.txt 自动发现",
        skillTitle: "Agent Skills",
        skillDesc: "一条命令安装，Agent 自动发现。包含完整使用模式、错误处理和 21 个平台适配器指南。",
        skillFor: "适用：Claude Code、OpenClaw、Claw、Codex",
        skillClaudeCode: "Claude Code",
        skillClaudeCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.claude/skills/website2markdown",
        skillOpenClaw: "OpenClaw",
        skillOpenClawCmd: "npx clawhub@latest install website2markdown",
        skillNote: "安装后在新会话中自动可用，无需额外配置",
        mcpTitle: "MCP Server",
        mcpDesc: "标准 MCP 协议，提供 convert_url 工具。",
        mcpFor: "适用：Claude Desktop、Cursor IDE、Windsurf",
        mcpCmd: "npm install -g @digidai/mcp-website2markdown",
        mcpConfigTitle: "Claude Desktop 配置",
        llmsTxtTitle: "llms.txt",
        llmsTxtDesc: "遵循 llms.txt 标准的机器可读 API 描述。AI 系统访问此端点即可了解所有能力。",
        llmsTxtFor: "适用：任何有 Web 访问的 AI 系统",
        comparisonTitle: "对比",
        compLatency: "延迟",
        compContext: "上下文",
        compInstall: "安装",
        compBestFor: "最适合",
        compSkillsInstall: "1 条命令",
        compMcpInstall: "1 条命令",
        compLlmsInstall: "无需",
        compSkillsBest: "CLI AI",
        compMcpBest: "IDE AI",
        compLlmsBest: "全部",
        // Footer
        footerProduct: "产品",
        footerIntegration: "集成",
        footerOpenSource: "开源",
        footerContributing: "贡献指南",
        footerSecurity: "安全",
        footerThemeLight: "浅色",
        footerThemeDark: "深色",
        footerThemeSystem: "跟随系统",
        mobilePlaceholder: "https://example.com/article",
        exampleLabel: "试一个示例",
      }
    : {
        htmlLang: "en",
        locale: "en_US",
        pageTitle: "Convert Any URL to Markdown",
        schemaDescription: "Convert any URL to clean, readable Markdown instantly. For AI agents, LLMs, and developers.",
        metaDescription:
          "Convert any URL to clean, readable Markdown instantly, with SSE streaming, batch conversion, structured extraction, queued jobs, and deep crawl APIs.",
        shareDescription: `Prepend ${h}/ before any URL. Clean, readable Markdown plus stream, batch, extract, jobs, and deep crawl APIs. Powered by Cloudflare Workers.`,
        langSwitchAria: "Language selector",
        // Header
        tabHome: "Home",
        tabDocs: "Docs",
        tabIntegration: "Integration",
        // Hero
        heroTitleHtml: "Any URL to <em>Markdown</em>, instantly",
        heroSubtitle: "Convert any web page to clean Markdown for AI agents, LLMs, and developers. Open source, edge-deployed, 21 platform adapters.",
        inputPlaceholder: "paste any url...",
        convertButton: "Convert",
        convertingButton: "Converting",
        hintKeys: "format &middot; selector &middot; force_browser &middot; raw &middot; engine",
        // Why cards
        why1Title: "Works where others fail",
        why1Desc: "JS-heavy SPAs, paywalled content, anti-bot sites. 21 adapters for Chinese &amp; international platforms.",
        why2Title: "AI-native from day one",
        why2Desc: "MCP Server, Agent Skills, llms.txt built-in. Your AI agent just works -- no glue code needed.",
        why3Title: "Production ready",
        why3Desc: "568 tests, 5-layer fallback pipeline, KV cache, edge-deployed on Cloudflare Workers.",
        // Use cases
        useCasesTitle: "Built for every workflow",
        uc1Title: "AI Agents",
        uc1Desc: "Feed web content to LLMs in clean Markdown",
        uc2Title: "Knowledge Base",
        uc2Desc: "Crawl docs, wikis, blogs with deep crawl",
        uc3Title: "Content Migration",
        uc3Desc: "Batch convert up to 10 URLs",
        uc4Title: "Research",
        uc4Desc: "Read any article, no login walls",
        uc5Title: "Chinese Web",
        uc5Desc: "WeChat, Zhihu, Feishu, Yuque, CSDN...",
        uc6Title: "Data Extraction",
        uc6Desc: "CSS selectors, XPath, or Regex",
        platformsTitle: "21 Platform Adapters",
        // How it works
        howTitle: "How it works",
        step1Title: "Prepend URL",
        step1Desc: "Add md.genedai.me/ before any web address",
        step2Title: "Edge Pipeline",
        step2Desc: "5-layer fallback: Native &rarr; Readability &rarr; Browser &rarr; CF REST &rarr; Jina",
        step3Title: "Clean Output",
        step3Desc: "Markdown, JSON, HTML, or plain text",
        // FAQ
        faqTitle: "Frequently asked questions",
        faq1Q: "What is Website2Markdown?",
        faq1A: "A free, open-source API that converts any web page URL to clean Markdown. Built on Cloudflare Workers with 5-layer fallback: native edge Markdown &rarr; Readability &rarr; headless browser &rarr; CF REST API &rarr; Jina Reader.",
        faq2Q: "Is it free?",
        faq2A: "Yes, completely free and open source under Apache-2.0. Self-host or use the managed service at md.genedai.me.",
        faq3Q: "Which platforms are supported?",
        faq3A: "21 built-in adapters: WeChat, Zhihu, Feishu/Lark, Yuque, Juejin, CSDN, 36Kr, Toutiao, Weibo, NetEase, Twitter/X, Reddit, Notion, and more. Any public URL works via generic fallback.",
        faq4Q: "How does it handle JS-heavy pages?",
        faq4A: "Automatic 5-layer fallback. If native extraction fails, it escalates to Readability, then headless Chrome via Cloudflare Browser Rendering, then Jina Reader as last resort. Use ?force_browser=true to skip straight to browser rendering.",
        faq5Q: "How to integrate with my AI agent?",
        faq5A: "Three ways: (1) Agent Skills for Claude Code/OpenClaw -- one command install. (2) MCP Server for Claude Desktop/Cursor. (3) llms.txt for auto-discovery by any AI system.",
        faq6Q: "How to use the API?",
        faq6A: "Prepend md.genedai.me/ before any URL. For raw Markdown, add ?raw=true. Example: curl \"https://md.genedai.me/https://example.com?raw=true\". See the Docs tab for full API reference.",
        // CTA
        ctaTitle: "Try it now.",
        // Docs tab
        quickStartTitle: "Quick Start",
        curlRawComment: "# Get raw Markdown",
        curlJsonComment: "# Get JSON output",
        curlBatchComment: "# Batch conversion",
        apiTitle: "API Reference",
        apiRouteTitle: "Routes",
        apiGetDesc: "Convert a single URL to Markdown",
        streamDesc: "SSE progress for single-URL conversion (step / done / fail)",
        batchDesc: "Convert up to 10 URLs (requires API_TOKEN)",
        extractDesc: "Structured extraction (css / xpath / regex)",
        jobsDesc: "Create, query, stream, and run jobs",
        deepcrawlDesc: "BFS / BestFirst deep crawl with filters and scoring",
        healthDesc: "Health check and operational metrics",
        ogDesc: "Share-image generator",
        llmsTxtRouteDesc: "AI-readable API description",
        queryParamsTitle: "Query Parameters",
        rawDesc: "Return raw Markdown (no HTML wrapper)",
        formatDesc: "Output format",
        selectorDesc: "Extract only matching CSS selector",
        forceBrowserDesc: "Force headless browser rendering",
        engineDesc: "Convert via specific engine (jina / cf)",
        noCacheDesc: "Bypass cache, fetch fresh content",
        tokenDesc: "Public API token",
        authTitle: "Authentication",
        publicAuthDesc: "Single-URL convert and /api/stream accept Bearer or ?token=...",
        privateAuthDesc: "/api/batch, /api/extract, /api/jobs*, and /api/deepcrawl require API_TOKEN",
        curlExamplesTitle: "curl Examples",
        curlRaw: "# Get raw markdown",
        curlJson: "# Get JSON output",
        curlBatch: "# Batch conversion",
        curlExtract: "# Structured extraction",
        curlCrawl: "# Deep crawl",
        responseHeadersTitle: "Response Headers",
        sourceUrlDesc: "The original target URL",
        bodyLabel: "Body",
        returnsLabel: "Returns",
        // Integration tab
        integrationTitle: "AI Agent Integration",
        decisionTreeTitle: "Choose Your Integration",
        decisionSkills: "Does your agent have a terminal?",
        decisionYes: "YES &rarr; Agent Skills (fastest, richest context)",
        decisionNo: "NO &rarr; MCP Server",
        decisionAll: "All AI &rarr; llms.txt auto-discovery",
        skillTitle: "Agent Skills",
        skillDesc: "One command to install, auto-discovered by your agent. Includes full usage patterns, error handling, and guides for all 21 platform adapters.",
        skillFor: "For: Claude Code, OpenClaw, Claw, Codex",
        skillClaudeCode: "Claude Code",
        skillClaudeCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.claude/skills/website2markdown",
        skillOpenClaw: "OpenClaw",
        skillOpenClawCmd: "npx clawhub@latest install website2markdown",
        skillNote: "Auto-available in new sessions -- no extra configuration needed",
        mcpTitle: "MCP Server",
        mcpDesc: "Standard MCP protocol with convert_url tool.",
        mcpFor: "For: Claude Desktop, Cursor IDE, Windsurf",
        mcpCmd: "npm install -g @digidai/mcp-website2markdown",
        mcpConfigTitle: "Claude Desktop config",
        llmsTxtTitle: "llms.txt",
        llmsTxtDesc: "Machine-readable API description following the llms.txt standard. Any AI system can discover all capabilities from this endpoint.",
        llmsTxtFor: "For: any AI system with web access",
        comparisonTitle: "Comparison",
        compLatency: "Latency",
        compContext: "Context",
        compInstall: "Install",
        compBestFor: "Best for",
        compSkillsInstall: "1 command",
        compMcpInstall: "1 command",
        compLlmsInstall: "None",
        compSkillsBest: "CLI AI",
        compMcpBest: "IDE AI",
        compLlmsBest: "All",
        // Footer
        footerProduct: "Product",
        footerIntegration: "Integration",
        footerOpenSource: "Open Source",
        footerContributing: "Contributing",
        footerSecurity: "Security",
        footerThemeLight: "Light",
        footerThemeDark: "Dark",
        footerThemeSystem: "System",
        mobilePlaceholder: "https://example.com/article",
        exampleLabel: "Try an example",
      };

  /* ---- Schema.org @graph (4 types) ---- */
  const faqEntities = [
    { q: t.faq1Q, a: t.faq1A },
    { q: t.faq2Q, a: t.faq2A },
    { q: t.faq3Q, a: t.faq3A },
    { q: t.faq4Q, a: t.faq4A },
    { q: t.faq5Q, a: t.faq5A },
    { q: t.faq6Q, a: t.faq6A },
  ];
  const schemaJson = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Website2Markdown",
        alternateName: host,
        description: t.schemaDescription,
        url: `https://${host}/`,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [
          "URL to Markdown conversion",
          "21 platform adapters",
          "Batch API",
          "Structured extraction",
          "Deep crawl",
          "MCP Server",
          "Agent Skills",
          "llms.txt",
        ],
        softwareVersion: "1.0.0",
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        codeRepository: "https://github.com/Digidai/website2markdown",
        sameAs: [
          "https://github.com/Digidai/website2markdown",
          "https://www.npmjs.com/package/@digidai/mcp-website2markdown",
          "https://github.com/Digidai/website2markdown-skills",
        ],
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["h1", ".hero-subtitle", "#faq"],
        },
      },
      {
        "@type": "Organization",
        name: "Digidai",
        url: `https://${host}`,
        sameAs: ["https://github.com/Digidai"],
      },
      {
        "@type": "FAQPage",
        mainEntity: faqEntities.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a.replace(/&rarr;/g, "->").replace(/&amp;/g, "&") },
        })),
      },
      {
        "@type": "HowTo",
        name: "How to convert a URL to Markdown",
        step: [
          { "@type": "HowToStep", name: "Prepend URL", text: "Add md.genedai.me/ before any web address" },
          { "@type": "HowToStep", name: "Edge Fetch", text: "Processed at the Cloudflare edge through 5-layer pipeline" },
          { "@type": "HowToStep", name: "Get Output", text: "Receive clean Markdown, JSON, HTML, or plain text" },
        ],
      },
    ],
  })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  /* ---- SVG Icons (Lucide/Feather style) ---- */
  const iconBot = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg>`;
  const iconBook = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`;
  const iconRefresh = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`;
  const iconSearch = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  const iconGlobe = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`;
  const iconTable = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`;
  const iconGithub = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`;

  const platforms = ["WeChat", "Zhihu", "Feishu", "Yuque", "Juejin", "CSDN", "36Kr", "Toutiao", "Weibo", "NetEase", "Twitter/X", "Reddit", "Notion", "GitHub", "Substack", "Medium"];

  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${h} - ${t.pageTitle}</title>
  <meta name="description" content="${t.metaDescription}">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <meta name="author" content="Digidai">
  <link rel="canonical" href="https://${h}/">
  <link rel="alternate" hreflang="en" href="https://${h}/">
  <link rel="alternate" hreflang="zh" href="https://${h}/?lang=zh">
  <link rel="alternate" hreflang="x-default" href="https://${h}/">
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${h} — ${t.pageTitle}">
  <meta property="og:description" content="${t.shareDescription}">
  <meta property="og:url" content="https://${h}/">
  <meta property="og:site_name" content="${h}">
  <meta property="og:image" content="https://${h}/api/og">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${t.locale}">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${h} — ${t.pageTitle}">
  <meta name="twitter:description" content="${t.shareDescription}">
  <meta name="twitter:image" content="https://${h}/api/og">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    /* ---- Color System ---- */
    :root {
      --bg: #f7f7f4;
      --bg-surface: #f2f1ed;
      --bg-elevated: #eae9e4;
      --text-primary: #26251e;
      --text-secondary: rgba(38,37,30,0.6);
      --text-muted: rgba(38,37,30,0.3);
      --accent: #22d3ee;
      --accent-hover: #06b6d4;
      --accent-text: #0e7490;
      --border: rgba(0,0,0,0.06);
      --font-display: 'Instrument Serif', Georgia, serif;
      --font-body: 'DM Sans', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
      --radius: 4px;
      --max-w: 1280px;
      color-scheme: light dark;
    }

    [data-theme="dark"], .dark {
      --bg: #14120b;
      --bg-surface: #1c1a14;
      --bg-elevated: #191b22;
      --text-primary: #edecec;
      --text-secondary: rgba(237,236,236,0.6);
      --text-muted: rgba(237,236,236,0.3);
      --accent: #22d3ee;
      --accent-hover: #06b6d4;
      --accent-text: #22d3ee;
      --border: rgba(255,255,255,0.06);
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #14120b;
        --bg-surface: #1c1a14;
        --bg-elevated: #191b22;
        --text-primary: #edecec;
        --text-secondary: rgba(237,236,236,0.6);
        --text-muted: rgba(237,236,236,0.3);
        --accent: #22d3ee;
        --accent-hover: #06b6d4;
        --accent-text: #22d3ee;
        --border: rgba(255,255,255,0.06);
      }
    }

    /* ---- Reset ---- */
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--text-primary);
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* ---- Utility ---- */
    .container { max-width: var(--max-w); margin: 0 auto; padding: 0 20px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }

    /* ---- Scrollbar ---- */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--text-muted); border-radius: 3px; }

    /* ---- Animations ---- */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
    .reveal.visible { opacity: 1; transform: translateY(0); }
    .reveal-stagger > * { opacity: 0; transform: translateY(16px); transition: opacity 0.5s ease, transform 0.5s ease; }
    .reveal-stagger.visible > * { opacity: 1; transform: translateY(0); }
    .reveal-stagger.visible > *:nth-child(1) { transition-delay: 0s; }
    .reveal-stagger.visible > *:nth-child(2) { transition-delay: 0.08s; }
    .reveal-stagger.visible > *:nth-child(3) { transition-delay: 0.16s; }
    .reveal-stagger.visible > *:nth-child(4) { transition-delay: 0.2s; }
    .reveal-stagger.visible > *:nth-child(5) { transition-delay: 0.24s; }
    .reveal-stagger.visible > *:nth-child(6) { transition-delay: 0.28s; }

    /* ---- Header ---- */
    .site-header {
      position: sticky; top: 0; z-index: 100; height: 52px;
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      background: color-mix(in srgb, var(--bg) 80%, transparent);
      transition: box-shadow 0.3s ease;
    }
    .site-header.scrolled { box-shadow: 0 1px 0 var(--border); }
    .header-inner {
      max-width: var(--max-w); margin: 0 auto; padding: 0 20px;
      height: 100%; display: flex; align-items: center; justify-content: space-between;
    }
    .site-name {
      font-family: var(--font-mono); font-size: 14px; font-weight: 500;
      color: var(--accent-text); text-decoration: none; letter-spacing: -0.3px;
    }
    .header-nav { display: flex; align-items: center; gap: 2px; }
    .tab-btn {
      background: none; border: none; cursor: pointer;
      font-family: var(--font-body); font-size: 13px; font-weight: 500;
      color: var(--text-secondary); padding: 6px 14px; border-radius: 999px;
      transition: all 0.2s ease;
    }
    .tab-btn:hover { color: var(--text-primary); background: var(--bg-surface); }
    .tab-btn.active { color: var(--text-primary); background: var(--bg-surface); }
    .header-right { display: flex; align-items: center; gap: 8px; }
    .lang-switch {
      display: inline-flex; gap: 2px; padding: 3px;
      background: var(--bg-surface); border-radius: 999px;
    }
    .lang-link {
      color: var(--text-secondary); text-decoration: none; font-size: 13px; font-weight: 500;
      padding: 5px 14px; border-radius: 999px; transition: all 0.2s ease; letter-spacing: 0.02em;
    }
    .lang-link:hover { color: var(--text-primary); background: rgba(0,0,0,0.04); }
    .lang-link.active { color: #fff; background: var(--accent); font-weight: 600; }
    .github-link {
      display: flex; align-items: center; color: var(--text-secondary);
      transition: color 0.2s; padding: 4px;
    }
    .github-link:hover { color: var(--text-primary); }
    .mobile-menu-btn {
      display: none; background: none; border: none; cursor: pointer;
      color: var(--text-secondary); padding: 4px;
    }

    /* ---- Tab Content ---- */
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* ---- Section spacing ---- */
    .section { padding: 44.8px 0; }
    .section-title {
      font-family: var(--font-display); font-size: 26px; font-weight: 400;
      letter-spacing: -0.325px; margin-bottom: 32px; color: var(--text-primary);
    }
    .section-title-center { text-align: center; }

    /* ---- Hero ---- */
    .hero { padding: 80px 0 44.8px; text-align: center; }
    .hero h1 {
      font-family: var(--font-display); font-size: clamp(26px, 5vw, 42px);
      font-weight: 400; letter-spacing: -0.325px; line-height: 1.15;
      margin-bottom: 16px; color: var(--text-primary);
    }
    .hero h1 em {
      font-style: italic;
      background: linear-gradient(135deg, var(--accent) 0%, #67e8f9 50%, var(--accent-hover) 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .hero-subtitle {
      font-size: 16px; color: var(--text-secondary); max-width: 560px;
      margin: 0 auto 40px; line-height: 1.6; font-weight: 400;
    }

    /* ---- Input Form ---- */
    .input-wrapper {
      max-width: 640px; margin: 0 auto 12px; border-radius: var(--radius);
      background: var(--bg-surface); overflow: hidden;
      transition: box-shadow 0.3s ease;
    }
    .input-wrapper:focus-within {
      box-shadow: 0 0 0 2px var(--accent), 0 4px 24px rgba(34,211,238,0.08);
    }
    .input-group { display: flex; width: 100%; }
    .input-prefix {
      display: flex; align-items: center; padding: 0 0 0 16px;
      color: var(--accent-text); font-family: var(--font-mono);
      font-size: 12px; font-weight: 500; white-space: nowrap;
      user-select: none; opacity: 0.8;
    }
    .input-group input {
      flex: 1; padding: 14px 12px; background: transparent; border: none; outline: none;
      color: var(--text-primary); font-size: 14px; font-family: var(--font-mono); font-weight: 400;
      min-width: 0;
    }
    .input-group input::placeholder { color: var(--text-muted); }
    .convert-btn {
      padding: 0 24px; background: var(--text-primary); border: none;
      color: var(--bg); font-weight: 600; font-size: 13px;
      font-family: var(--font-body); cursor: pointer; border-radius: 999px;
      margin: 6px; transition: opacity 0.2s; white-space: nowrap;
    }
    .convert-btn:hover { opacity: 0.85; }
    .convert-btn:disabled { opacity: 0.5; cursor: wait; }
    .btn-spinner {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: var(--bg);
      border-radius: 50%; animation: spin 0.6s linear infinite;
      vertical-align: middle; margin-right: 4px;
    }
    .input-hint {
      font-size: 12px; color: var(--text-muted); text-align: center;
      font-family: var(--font-mono);
    }

    /* ---- Cards ---- */
    .card {
      background: var(--bg-surface); border-radius: var(--radius);
      padding: 28px 24px; transition: background 0.2s ease;
    }
    .card:hover { background: var(--bg-elevated); }
    .card-title {
      font-family: var(--font-display); font-size: 18px; font-weight: 400;
      margin-bottom: 8px; color: var(--text-primary);
    }
    .card-desc {
      font-size: 14px; color: var(--text-secondary); line-height: 1.6; font-weight: 400;
    }

    /* ---- Why Grid (3 cols) ---- */
    .why-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
    }

    /* ---- Use Cases Grid (2x3) ---- */
    .uc-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
    }
    .uc-card { display: flex; flex-direction: column; min-height: 140px; }
    .uc-icon { color: var(--accent-text); margin-bottom: 16px; opacity: 0.8; }

    /* ---- Platform strip ---- */
    .platforms { margin-top: 32px; text-align: center; }
    .platforms-title {
      font-size: 13px; font-weight: 500; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 16px;
    }
    .platform-pills {
      display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;
    }
    .platform-pill {
      font-size: 12px; font-weight: 500; color: var(--text-secondary);
      background: var(--bg-surface); padding: 5px 12px; border-radius: 999px;
      white-space: nowrap;
    }

    /* ---- Steps (3 col) ---- */
    .steps-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
    }
    .step-card { text-align: center; }
    .step-num {
      font-family: var(--font-display); font-size: 32px; font-style: italic;
      color: var(--accent-text); opacity: 0.4; margin-bottom: 12px; line-height: 1;
    }
    .step-title {
      font-size: 15px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary);
    }
    .step-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }

    /* ---- FAQ ---- */
    .faq-list { max-width: 720px; margin: 0 auto; }
    .faq-item {
      border-bottom: 1px solid var(--border);
    }
    .faq-item summary {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 0; cursor: pointer; font-size: 15px; font-weight: 500;
      color: var(--text-primary); list-style: none;
    }
    .faq-item summary::-webkit-details-marker { display: none; }
    .faq-item summary::after {
      content: '+'; font-size: 20px; font-weight: 300; color: var(--text-muted);
      transition: transform 0.2s;
    }
    .faq-item[open] summary::after { content: '-'; }
    .faq-answer {
      padding: 0 0 20px; font-size: 14px; color: var(--text-secondary); line-height: 1.7;
    }

    /* ---- CTA ---- */
    .cta-section { padding: 80px 0; text-align: center; }
    .cta-title {
      font-family: var(--font-display); font-size: clamp(32px, 5vw, 56px);
      font-weight: 400; letter-spacing: -0.5px; margin-bottom: 40px;
      color: var(--text-primary);
    }

    /* ---- Docs tab ---- */
    .docs-section { max-width: 840px; margin: 0 auto; }
    .code-block {
      background: var(--bg-surface); border-radius: var(--radius);
      padding: 16px 20px; font-family: var(--font-mono); font-size: 12px;
      line-height: 1.8; color: var(--text-secondary); overflow-x: auto;
      margin-bottom: 12px;
    }
    .code-block code { font-family: inherit; font-size: inherit; }
    .code-comment { color: var(--text-muted); }
    .code-hl { color: var(--accent-text); }
    .doc-card {
      background: var(--bg-surface); border-radius: var(--radius);
      padding: 28px 24px; margin-bottom: 12px;
    }
    .doc-card h3 {
      font-family: var(--font-display); font-size: 20px; font-weight: 400;
      margin-bottom: 16px; color: var(--text-primary);
    }
    .route-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .route-table th {
      text-align: left; padding: 8px 12px; font-weight: 600; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }
    .route-table td {
      padding: 10px 12px; border-bottom: 1px solid var(--border);
      color: var(--text-secondary); vertical-align: top;
    }
    .route-table code {
      font-family: var(--font-mono); font-size: 12px; color: var(--accent-text);
      background: rgba(34,211,238,0.06); padding: 2px 6px; border-radius: 3px;
    }
    .param-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .param-table th {
      text-align: left; padding: 8px 12px; font-weight: 600; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }
    .param-table td {
      padding: 10px 12px; border-bottom: 1px solid var(--border);
      color: var(--text-secondary); vertical-align: top;
    }
    .param-table code {
      font-family: var(--font-mono); font-size: 12px; color: var(--accent-text);
      background: rgba(34,211,238,0.06); padding: 2px 6px; border-radius: 3px;
    }

    /* ---- Integration tab ---- */
    .integration-section { max-width: 840px; margin: 0 auto; }
    .decision-tree {
      background: var(--bg-surface); border-radius: var(--radius);
      padding: 28px 24px; margin-bottom: 24px;
    }
    .decision-tree h3 {
      font-family: var(--font-display); font-size: 20px; font-weight: 400;
      margin-bottom: 16px; color: var(--text-primary);
    }
    .decision-item {
      font-size: 14px; color: var(--text-secondary); padding: 6px 0 6px 20px;
      border-left: 2px solid var(--border); margin-left: 8px;
    }
    .decision-item strong { color: var(--text-primary); }
    .int-card {
      background: var(--bg-surface); border-radius: var(--radius);
      padding: 28px 24px; margin-bottom: 12px;
    }
    .int-card h3 {
      font-family: var(--font-display); font-size: 20px; font-weight: 400;
      margin-bottom: 4px; color: var(--text-primary);
    }
    .int-card .for-line {
      font-size: 12px; color: var(--text-muted); margin-bottom: 12px;
    }
    .int-card p {
      font-size: 14px; color: var(--text-secondary); line-height: 1.6;
      margin-bottom: 16px;
    }
    .cmd-block {
      font-family: var(--font-mono); font-size: 12px; display: block;
      padding: 10px 14px; background: var(--bg-elevated); border-radius: var(--radius);
      color: var(--accent-text); word-break: break-all; line-height: 1.6;
      margin-bottom: 8px;
    }
    .cmd-label {
      font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);
      margin-bottom: 4px; margin-top: 12px;
    }
    .config-block {
      font-family: var(--font-mono); font-size: 11px; display: block;
      padding: 14px; background: var(--bg-elevated); border-radius: var(--radius);
      color: var(--text-secondary); white-space: pre; overflow-x: auto;
      line-height: 1.7; margin-top: 8px;
    }
    .comp-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
    .comp-table th {
      text-align: left; padding: 10px 14px; font-weight: 600; font-size: 12px;
      color: var(--text-muted); border-bottom: 1px solid var(--border);
    }
    .comp-table td {
      padding: 10px 14px; border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
    }
    .int-note {
      font-size: 12px; color: var(--text-muted); font-style: italic; margin-top: 8px;
    }
    .accent-link {
      color: var(--accent-text); text-decoration: none;
    }
    .accent-link:hover { text-decoration: underline; text-underline-offset: 4px; }

    /* ---- Footer ---- */
    .site-footer { background: var(--bg-surface); padding: 48px 0 24px; margin-top: 44.8px; }
    .footer-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px;
      margin-bottom: 40px;
    }
    .footer-col-title {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 16px;
    }
    .footer-col a {
      display: block; font-size: 14px; color: var(--text-secondary);
      text-decoration: none; padding: 3px 0; transition: color 0.2s;
    }
    .footer-col a:hover { color: var(--text-primary); }
    .footer-bottom {
      display: flex; align-items: center; justify-content: space-between;
      padding-top: 24px; border-top: 1px solid var(--border);
      font-size: 12px; color: var(--text-muted);
    }
    .theme-toggle {
      display: inline-flex; gap: 2px; padding: 3px;
      background: var(--bg); border-radius: 999px;
    }
    .theme-btn {
      background: none; border: none; cursor: pointer; font-size: 11px;
      font-family: var(--font-body); color: var(--text-muted);
      padding: 4px 10px; border-radius: 999px; transition: all 0.2s;
    }
    .theme-btn:hover { color: var(--text-secondary); }
    .theme-btn.active { color: var(--text-primary); background: var(--bg-surface); }

    /* ---- Example link ---- */
    .example-link {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: var(--font-mono); font-size: 13px;
      color: var(--text-secondary); text-decoration: none;
      padding: 12px 20px; background: var(--bg-surface);
      border-radius: var(--radius); transition: all 0.2s;
    }
    .example-link:hover { background: var(--bg-elevated); color: var(--text-primary); }
    .example-link .hl { color: var(--accent-text); }

    /* ---- Browser Mockup Window ---- */
    .mockup-window {
      border-radius: 10px; overflow: hidden;
      background: var(--bg-surface);
      box-shadow: rgba(0,0,0,0.14) 0px 28px 70px 0px, rgba(0,0,0,0.1) 0px 14px 32px 0px, rgba(0,0,0,0.1) 0px 4px 12px 0px;
      transition: transform 0.3s ease;
    }
    .mockup-window:hover { transform: translateY(-2px); }
    .mockup-titlebar {
      height: 28px; display: flex; align-items: center; padding: 0 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-elevated);
    }
    .mockup-dots { display: flex; gap: 6px; }
    .mockup-dot { width: 9px; height: 9px; border-radius: 50%; }
    .mockup-dot-red { background: #ff5f57; }
    .mockup-dot-yellow { background: #febc2e; }
    .mockup-dot-green { background: #28c840; }
    .mockup-addressbar {
      flex: 1; margin: 0 12px; height: 20px; border-radius: 4px;
      background: rgba(0,0,0,0.04); padding: 0 8px; font-size: 11px;
      font-family: var(--font-body); color: var(--text-secondary);
      display: flex; align-items: center; overflow: hidden;
      white-space: nowrap; text-overflow: ellipsis;
    }
    [data-theme="dark"] .mockup-addressbar,
    .dark .mockup-addressbar { background: rgba(255,255,255,0.06); }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .mockup-addressbar { background: rgba(255,255,255,0.06); }
    }
    .mockup-addressbar .hl { color: var(--accent-text); font-weight: 500; }
    .mockup-body {
      padding: 16px; font-family: var(--font-mono); font-size: 12px;
      line-height: 1.7; color: var(--text-secondary); overflow: hidden;
    }
    .mockup-prompt { color: var(--accent); font-weight: 500; }
    .mockup-muted { color: var(--text-muted); font-size: 11px; }
    .mockup-heading { color: var(--text-primary); font-weight: 600; }
    .mockup-accent { color: var(--accent-text); }
    .mockup-success { color: #22c55e; }
    .mockup-warn { color: #f59e0b; }

    /* ---- Hero Stage: overlapping browser windows ---- */
    .hero-stage {
      position: relative; border-radius: 12px; overflow: hidden;
      background: linear-gradient(135deg, #f0eeea 0%, #e6e4df 50%, #dbd8d2 100%);
      height: clamp(400px, 48vw, 560px); margin-top: 56px;
      box-shadow: 0 0 0 1px var(--border);
    }
    [data-theme="dark"] .hero-stage,
    .dark .hero-stage {
      background: linear-gradient(135deg, #1a1812 0%, #15130c 50%, #1e1c15 100%);
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .hero-stage {
        background: linear-gradient(135deg, #1a1812 0%, #15130c 50%, #1e1c15 100%);
      }
    }
    .hero-stage::before {
      content: ""; position: absolute; inset: 0;
      background: radial-gradient(circle at 40% 50%, rgba(34,211,238,0.04) 0%, transparent 60%);
    }
    .hero-back-window {
      position: absolute; top: 28px; left: 5%; width: 56%; max-width: 520px;
      border-radius: 10px; overflow: hidden;
      background: var(--bg-surface); opacity: 0.88;
      box-shadow: rgba(0,0,0,0.1) 0px 20px 60px;
      z-index: 1;
    }
    .hero-front-window {
      position: absolute; top: 48px; right: 5%; width: 56%; max-width: 520px;
      border-radius: 10px; overflow: hidden;
      background: var(--bg-surface);
      box-shadow: rgba(0,0,0,0.18) 0px 28px 70px, rgba(0,0,0,0.12) 0px 14px 32px, rgba(34,211,238,0.15) 0px 0px 30px;
      z-index: 2;
    }
    .hero-back-window .mockup-body { filter: saturate(0.7); }

    /* ---- Feature split browser ---- */
    .browser-split {
      display: grid; grid-template-columns: 1fr 1fr; min-height: 280px;
    }
    .browser-split-left {
      background: color-mix(in srgb, #ef4444 6%, var(--bg));
      border-right: 1px solid var(--border);
      padding: 20px; position: relative; overflow: hidden;
    }
    .browser-split-right {
      background: color-mix(in srgb, #22c55e 5%, var(--bg));
      padding: 20px; position: relative;
    }
    .split-badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 9px; font-family: var(--font-mono);
      background: rgba(34,197,94,0.1); color: #16a34a;
      padding: 3px 8px; border-radius: 999px;
      margin-top: 12px;
    }
    .split-divider-arrow {
      position: absolute; right: -12px; top: 50%; transform: translateY(-50%);
      z-index: 2; width: 24px; height: 24px; border-radius: 50%;
      background: var(--accent); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; box-shadow: 0 2px 8px rgba(34,211,238,0.3);
    }

    /* ---- AI Chat mockup ---- */
    .chat-body { padding: 0; }
    .chat-msg {
      padding: 14px 20px; font-size: 12px; line-height: 1.7;
      font-family: var(--font-body);
    }
    .chat-msg-user {
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border);
    }
    .chat-msg-ai {
      background: var(--bg);
    }
    .chat-sender {
      font-size: 10px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px;
    }
    .chat-tool-call {
      margin: 10px 0; padding: 10px 14px;
      background: var(--bg-elevated); border-radius: 6px;
      font-family: var(--font-mono); font-size: 11px;
      border-left: 3px solid var(--accent);
    }

    /* ---- Pipeline visualization ---- */
    .pipeline-body {
      padding: 24px; background: var(--bg); font-family: var(--font-mono); font-size: 11px;
    }
    .pipeline-request {
      text-align: center; padding: 8px 16px; margin-bottom: 16px;
      font-size: 11px; color: var(--text-secondary);
    }
    .pipeline-request code { color: var(--accent-text); font-family: var(--font-mono); }
    .pipeline-layer {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; border-radius: 6px;
      margin-bottom: 4px; transition: all 0.2s;
    }
    .pipeline-layer-fast { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.15); }
    .pipeline-layer-medium { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.15); }
    .pipeline-layer-slow { background: rgba(156,163,175,0.08); border: 1px solid rgba(156,163,175,0.15); }
    .pipeline-layer-active {
      box-shadow: 0 0 0 2px var(--accent), 0 0 12px rgba(34,211,238,0.15);
      border-color: var(--accent);
    }
    .pipeline-layer-name { font-weight: 600; color: var(--text-primary); flex: 1; }
    .pipeline-layer-detail { font-size: 10px; color: var(--text-secondary); }
    .pipeline-layer-speed { font-size: 10px; color: var(--text-muted); white-space: nowrap; }
    .pipeline-connector {
      display: flex; justify-content: center; padding: 2px 0;
      color: var(--text-muted); font-size: 10px;
    }
    .pipeline-result {
      text-align: center; margin-top: 16px; padding: 10px;
      font-size: 12px; color: var(--text-primary); font-weight: 500;
    }
    .pipeline-result .mockup-success { font-weight: 700; }

    /* ---- Feature Sections (alternating text + mockup) ---- */
    .feature-section { padding: 32px 0; }
    .feature-grid {
      display: grid; grid-template-columns: 1fr 1.4fr; gap: 64px; align-items: center;
    }
    .feature-grid.reverse { grid-template-columns: 1.4fr 1fr; }
    .feature-text {}
    .feature-text .card-title {
      font-family: var(--font-display); font-size: 28px; font-weight: 400;
      margin-bottom: 16px; color: var(--text-primary); letter-spacing: -0.4px;
    }
    .feature-text .card-desc {
      font-size: 16px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 0;
    }

    /* Mockup divider */
    .mockup-divider {
      border: none; border-top: 1px solid var(--border); margin: 8px 0;
    }

    /* ---- Responsive ---- */
    @media (max-width: 768px) {
      .why-grid, .uc-grid, .steps-grid { grid-template-columns: 1fr; }
      .feature-grid, .feature-grid.reverse { grid-template-columns: 1fr; gap: 24px; }
      .feature-grid.reverse .feature-mockup { order: 2; }
      .feature-grid.reverse .feature-text { order: 1; }
      .hero-stage { display: none !important; }
      .feature-mockup { display: none !important; }
      .footer-grid { grid-template-columns: 1fr; gap: 24px; }
      .header-nav { display: none; }
      .header-nav.open {
        display: flex; flex-direction: column; position: absolute;
        top: 52px; left: 0; right: 0; background: var(--bg);
        border-bottom: 1px solid var(--border); padding: 8px 20px 16px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      }
      .mobile-menu-btn { display: block; }
      .input-prefix { display: none; }
      .hero { padding: 48px 0 32px; }
      .footer-bottom { flex-direction: column; gap: 12px; }
    }

    @media (min-width: 769px) and (max-width: 1024px) {
      .uc-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <!-- ===== HEADER ===== -->
  <header class="site-header" id="siteHeader">
    <div class="header-inner">
      <a href="/" class="site-name">${h}</a>
      <nav class="header-nav" id="headerNav" aria-label="Main navigation">
        <button class="tab-btn active" data-tab="home" onclick="switchTab('home')">${t.tabHome}</button>
        <button class="tab-btn" data-tab="docs" onclick="switchTab('docs')">${t.tabDocs}</button>
        <button class="tab-btn" data-tab="integration" onclick="switchTab('integration')">${t.tabIntegration}</button>
      </nav>
      <div class="header-right">
        <nav class="lang-switch" aria-label="${t.langSwitchAria}">
          <a class="lang-link ${isZh ? "" : "active"}" href="/?lang=en">EN</a>
          <a class="lang-link ${isZh ? "active" : ""}" href="/?lang=zh">中文</a>
        </nav>
        <a href="https://github.com/Digidai/website2markdown" target="_blank" class="github-link" aria-label="GitHub">${iconGithub}</a>
        <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu" onclick="toggleMobileMenu()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
    </div>
  </header>

  <main>
    <!-- ==================== TAB 1: HOME ==================== -->
    <div class="tab-content active" id="tab-home">

      <!-- Hero -->
      <section class="hero">
        <div class="container">
          <h1 class="reveal">${t.heroTitleHtml}</h1>
          <p class="hero-subtitle reveal">${t.heroSubtitle}</p>
          <div class="input-wrapper reveal">
            <form class="input-group" id="urlForm" onsubmit="return handleSubmit(event)">
              <div class="input-prefix">${h}/</div>
              <input type="text" id="urlInput" placeholder="${t.inputPlaceholder}" autocomplete="off" autofocus />
              <button type="submit" class="convert-btn">${t.convertButton}</button>
            </form>
          </div>
          <p class="input-hint reveal">${t.hintKeys}</p>

          <!-- Hero: Overlapping browser windows -->
          <div class="hero-stage reveal">
            <!-- Back window: "Before" — messy WeChat page -->
            <div class="hero-back-window">
              <div class="mockup-titlebar">
                <div class="mockup-dots"><div class="mockup-dot mockup-dot-red"></div><div class="mockup-dot mockup-dot-yellow"></div><div class="mockup-dot mockup-dot-green"></div></div>
                <div class="mockup-addressbar">mp.weixin.qq.com/s/abc123def</div>
              </div>
              <div class="mockup-body" style="padding:0; text-align:left; font-family:var(--font-body); background:var(--bg);">
                <!-- WeChat header bar -->
                <div style="padding:10px 16px; background:var(--bg-elevated); display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border);">
                  <span style="font-size:12px; font-weight:600; color:var(--text-secondary);">&#128241; 微信公众号</span>
                  <span style="font-size:9px; padding:3px 10px; border-radius:999px; background:rgba(34,197,94,0.12); color:#16a34a;">关注公众号</span>
                </div>
                <!-- Article title -->
                <div style="padding:14px 16px 8px;">
                  <div style="font-size:14px; font-weight:700; color:var(--text-primary); line-height:1.4;">深度解析：大模型在企业的落地实践</div>
                  <div style="font-size:9px; color:var(--text-muted); margin-top:6px;">张三 | 2026-03-25</div>
                </div>
                <!-- Blocking modal overlay -->
                <div style="margin:8px 16px; padding:20px; background:var(--bg-elevated); border-radius:8px; text-align:center; border:1px solid var(--border);">
                  <div style="font-size:16px; margin-bottom:8px;">&#9888;&#65039;</div>
                  <div style="font-size:11px; font-weight:600; color:var(--text-primary); margin-bottom:4px;">此内容需要在微信客户端中打开</div>
                  <div style="font-size:9px; color:var(--text-muted); margin-bottom:10px;">长按识别二维码</div>
                  <div style="width:48px; height:48px; margin:0 auto 10px; background:var(--bg-surface); border:1px solid var(--border); border-radius:4px; display:flex; align-items:center; justify-content:center;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="color:var(--text-muted);opacity:0.4"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="4" height="4" rx="0.5"/><rect x="18" y="18" width="4" height="4" rx="0.5"/></svg>
                  </div>
                  <div style="display:inline-block; font-size:10px; padding:5px 14px; background:#07c160; color:#fff; border-radius:4px;">在微信中打开</div>
                </div>
                <!-- Recommended / Ads -->
                <div style="padding:8px 16px 12px;">
                  <div style="font-size:10px; color:var(--text-muted); margin-bottom:6px;">推荐阅读 &#9660;</div>
                  <div style="display:flex; gap:6px;">
                    <div style="flex:1; height:36px; background:var(--bg-elevated); border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:8px; color:var(--text-muted);">Ad</div>
                    <div style="flex:1; height:36px; background:var(--bg-elevated); border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:8px; color:var(--text-muted);">Ad</div>
                    <div style="flex:1; height:36px; background:var(--bg-elevated); border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:8px; color:var(--text-muted);">Ad</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Front window: "After" — clean Markdown output -->
            <div class="hero-front-window">
              <div class="mockup-titlebar">
                <div class="mockup-dots"><div class="mockup-dot mockup-dot-red"></div><div class="mockup-dot mockup-dot-yellow"></div><div class="mockup-dot mockup-dot-green"></div></div>
                <div class="mockup-addressbar"><span class="hl">${h}/</span>mp.weixin.qq.com/s/abc123def</div>
              </div>
              <div class="mockup-body" style="padding:20px; text-align:left; font-size:12px; background:var(--bg);">
<div style="font-size:16px; font-weight:700; color:var(--text-primary); font-family:var(--font-body); margin-bottom:10px;"># 深度解析：大模型在企业的落地实践</div>
<div style="font-size:11px; color:var(--accent-text); margin-bottom:14px; font-style:italic;">&gt; 作者：张三 | 发布于 2026-03-25</div>
<div style="font-size:13px; font-weight:600; color:var(--text-primary); font-family:var(--font-body); margin-bottom:8px;">## 核心观点</div>
<div style="font-size:11px; color:var(--text-secondary); line-height:1.8; margin-bottom:12px;">1. 大模型的应用场景正在从实验室走向生产环境<br>2. RAG 架构成为企业级应用的首选方案<br>3. Agent 工作流将重新定义软件开发流程</div>
<div style="font-size:13px; font-weight:600; color:var(--text-primary); font-family:var(--font-body); margin-bottom:6px;">## 背景</div>
<div style="font-size:11px; color:var(--text-secondary); line-height:1.8; margin-bottom:12px;">随着 GPT-4、Claude 等模型的发布，企业开始认真考虑将大语言模型集成到核心业务流程中...</div>
<div style="background:var(--bg-elevated); border-radius:4px; padding:10px 12px; font-family:var(--font-mono); font-size:10px; color:var(--accent-text); margin-bottom:14px; line-height:1.6;"><span style="color:var(--text-muted);">\`\`\`python</span><br>from langchain import ChatOpenAI<br>llm = ChatOpenAI(model=<span style="color:#f59e0b;">"gpt-4"</span>)<br><span style="color:var(--text-muted);">\`\`\`</span></div>
<div style="font-size:9px; color:var(--text-muted); border-top:1px solid var(--border); padding-top:8px; text-align:center; font-family:var(--font-mono);">
  <span class="mockup-success">&#10003;</span> X-Method: browser+readability &middot; 2.1s &middot; cached
</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Why — Feature 1: Works where others fail (left text, right mockup) -->
      <section class="feature-section">
        <div class="container">
          <div class="feature-grid reveal">
            <div class="feature-text">
              <div class="card-title">${t.why1Title}</div>
              <div class="card-desc">${t.why1Desc}</div>
            </div>
            <div class="feature-mockup">
              <div class="mockup-window">
                <div class="mockup-titlebar">
                  <div class="mockup-dots"><div class="mockup-dot mockup-dot-red"></div><div class="mockup-dot mockup-dot-yellow"></div><div class="mockup-dot mockup-dot-green"></div></div>
                  <div class="mockup-addressbar">zhihu.com/p/123456789</div>
                </div>
                <div class="browser-split">
                  <!-- Left: blocked Zhihu page -->
                  <div class="browser-split-left" style="font-family:var(--font-body); text-align:left;">
                    <div class="split-divider-arrow">&rarr;</div>
                    <!-- Zhihu nav -->
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:12px;">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent-text)" style="opacity:0.5;"><circle cx="12" cy="12" r="10"/><text x="6" y="17" font-size="12" fill="#fff" font-weight="bold">Z</text></svg>
                      <span style="font-size:10px; color:var(--text-muted);">知乎 - 有问题，就会有答案</span>
                    </div>
                    <!-- Content behind blur -->
                    <div style="filter:blur(3px); opacity:0.5; font-size:10px; color:var(--text-secondary); line-height:1.6; margin-bottom:12px;">
                      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">如何评价大模型在企业中的落地？</div>
                      近年来，随着大语言模型技术的突破性进展，越来越多的企业开始探索将 AI 融入核心业务...
                    </div>
                    <!-- Login modal overlay -->
                    <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:8px; padding:16px; text-align:center; box-shadow:0 4px 16px rgba(0,0,0,0.08);">
                      <div style="font-size:12px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">登录后查看完整内容</div>
                      <div style="font-size:10px; color:var(--text-muted); margin-bottom:10px;">Login to view full content</div>
                      <div style="display:flex; gap:8px; justify-content:center;">
                        <span style="font-size:9px; padding:4px 12px; background:#0066ff; color:#fff; border-radius:4px;">登录</span>
                        <span style="font-size:9px; padding:4px 12px; border:1px solid var(--border); border-radius:4px; color:var(--text-secondary);">注册</span>
                      </div>
                    </div>
                  </div>
                  <!-- Right: clean Markdown output -->
                  <div class="browser-split-right" style="font-family:var(--font-mono); text-align:left; font-size:11px; line-height:1.7;">
                    <div style="font-size:14px; font-weight:700; color:var(--text-primary); font-family:var(--font-body); margin-bottom:8px;"># 如何评价大模型在企业中的落地？</div>
                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:10px;">近年来，随着大语言模型技术的突破性进展，越来越多的企业开始探索将 AI 融入核心业务流程。</div>
                    <div style="font-size:12px; font-weight:600; color:var(--text-primary); font-family:var(--font-body); margin-bottom:6px;">## 三大趋势</div>
                    <div style="font-size:11px; color:var(--text-secondary); line-height:1.8;">
                      - 多模态能力成为标配<br>
                      - 私有化部署需求增长<br>
                      - Agent 框架百花齐放
                    </div>
                    <div class="split-badge"><span class="mockup-success">&#10003;</span> Extracted via browser rendering</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Why — Feature 2: AI-native (right text, left mockup) -->
      <section class="feature-section">
        <div class="container">
          <div class="feature-grid reverse reveal">
            <div class="feature-mockup">
              <div class="mockup-window">
                <div class="mockup-titlebar">
                  <div class="mockup-dots"><div class="mockup-dot mockup-dot-red"></div><div class="mockup-dot mockup-dot-yellow"></div><div class="mockup-dot mockup-dot-green"></div></div>
                  <div class="mockup-addressbar" style="justify-content:center;">Claude</div>
                </div>
                <div class="chat-body" style="text-align:left;">
                  <!-- User message -->
                  <div class="chat-msg chat-msg-user">
                    <div class="chat-sender">User</div>
                    <div style="color:var(--text-primary); font-size:12px; line-height:1.6;">
                      读一下这篇文章，总结核心观点<br>
                      <span style="color:var(--accent-text); font-family:var(--font-mono); font-size:11px;">https://mp.weixin.qq.com/s/abc123</span>
                    </div>
                  </div>
                  <!-- AI message -->
                  <div class="chat-msg chat-msg-ai">
                    <div class="chat-sender">Claude</div>
                    <div class="chat-tool-call">
                      <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                        <span style="font-size:10px; font-weight:600; color:var(--text-muted);">&#9881; convert_url</span>
                      </div>
                      <div style="font-size:10px; color:var(--text-secondary);">url: <span style="color:var(--accent-text);">"https://mp.weixin.qq.com/s/..."</span></div>
                      <div style="font-size:10px; margin-top:4px;"><span class="mockup-success">&#10003;</span> <span style="color:var(--text-muted);">3,421 chars &middot; 2.1s</span></div>
                    </div>
                    <div style="color:var(--text-primary); font-size:12px; line-height:1.7; margin-top:10px;">
                      这篇文章的核心观点：
                    </div>
                    <div style="color:var(--text-secondary); font-size:12px; line-height:1.8; margin-top:6px; padding-left:4px;">
                      1. 大模型正在从实验走向生产<br>
                      2. RAG 是当前最实用的架构<br>
                      3. Agent 将改变软件开发方式
                    </div>
                    <div style="color:var(--text-secondary); font-size:12px; line-height:1.7; margin-top:8px;">
                      文章还提到了一个有趣的案例...
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="feature-text">
              <div class="card-title">${t.why2Title}</div>
              <div class="card-desc">${t.why2Desc}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Why — Feature 3: Production ready (left text, right mockup) -->
      <section class="feature-section">
        <div class="container">
          <div class="feature-grid reveal">
            <div class="feature-text">
              <div class="card-title">${t.why3Title}</div>
              <div class="card-desc">${t.why3Desc}</div>
            </div>
            <div class="feature-mockup">
              <div class="mockup-window">
                <div class="mockup-titlebar">
                  <div class="mockup-dots"><div class="mockup-dot mockup-dot-red"></div><div class="mockup-dot mockup-dot-yellow"></div><div class="mockup-dot mockup-dot-green"></div></div>
                  <div class="mockup-addressbar" style="justify-content:center;">5-Layer Fallback Pipeline</div>
                </div>
                <div class="pipeline-body" style="text-align:left;">
                  <div class="pipeline-request">Request: <code>https://example.com/article</code></div>

                  <div class="pipeline-layer pipeline-layer-fast pipeline-layer-active">
                    <span class="pipeline-layer-name">Layer 1 &mdash; Native Markdown</span>
                    <span class="pipeline-layer-detail">Cloudflare edge</span>
                    <span class="pipeline-layer-speed">&#9889; 0.1s &nbsp;<span class="mockup-success">&#10003;</span></span>
                  </div>
                  <div class="pipeline-connector">&#9474; fail?</div>

                  <div class="pipeline-layer pipeline-layer-fast">
                    <span class="pipeline-layer-name">Layer 2 &mdash; Readability + Turndown</span>
                    <span class="pipeline-layer-detail">HTML parsing</span>
                    <span class="pipeline-layer-speed">&#9889; 0.5s</span>
                  </div>
                  <div class="pipeline-connector">&#9474; fail?</div>

                  <div class="pipeline-layer pipeline-layer-medium">
                    <span class="pipeline-layer-name">Layer 3 &mdash; Browser Rendering</span>
                    <span class="pipeline-layer-detail">Headless Chrome</span>
                    <span class="pipeline-layer-speed">&#9889; 2-5s</span>
                  </div>
                  <div class="pipeline-connector">&#9474; fail?</div>

                  <div class="pipeline-layer pipeline-layer-medium">
                    <span class="pipeline-layer-name">Layer 4 &mdash; CF REST API</span>
                    <span class="pipeline-layer-detail">Browser Rendering</span>
                    <span class="pipeline-layer-speed">&#9889; 1-3s</span>
                  </div>
                  <div class="pipeline-connector">&#9474; fail?</div>

                  <div class="pipeline-layer pipeline-layer-slow">
                    <span class="pipeline-layer-name">Layer 5 &mdash; Jina Reader</span>
                    <span class="pipeline-layer-detail">External fallback</span>
                    <span class="pipeline-layer-speed">&#9889; 2-4s</span>
                  </div>

                  <div class="pipeline-result">
                    Result: Clean Markdown &middot; <span class="mockup-success">99.2% success rate</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Use Cases -->
      <section class="section">
        <div class="container">
          <h2 class="section-title section-title-center reveal">${t.useCasesTitle}</h2>
          <div class="uc-grid reveal-stagger" id="ucGrid">
            <div class="card uc-card">
              <div class="uc-icon">${iconBot}</div>
              <div class="card-title">${t.uc1Title}</div>
              <div class="card-desc">${t.uc1Desc}</div>
            </div>
            <div class="card uc-card">
              <div class="uc-icon">${iconBook}</div>
              <div class="card-title">${t.uc2Title}</div>
              <div class="card-desc">${t.uc2Desc}</div>
            </div>
            <div class="card uc-card">
              <div class="uc-icon">${iconRefresh}</div>
              <div class="card-title">${t.uc3Title}</div>
              <div class="card-desc">${t.uc3Desc}</div>
            </div>
            <div class="card uc-card">
              <div class="uc-icon">${iconSearch}</div>
              <div class="card-title">${t.uc4Title}</div>
              <div class="card-desc">${t.uc4Desc}</div>
            </div>
            <div class="card uc-card">
              <div class="uc-icon">${iconGlobe}</div>
              <div class="card-title">${t.uc5Title}</div>
              <div class="card-desc">${t.uc5Desc}</div>
            </div>
            <div class="card uc-card">
              <div class="uc-icon">${iconTable}</div>
              <div class="card-title">${t.uc6Title}</div>
              <div class="card-desc">${t.uc6Desc}</div>
            </div>
          </div>
          <div class="platforms reveal">
            <div class="platforms-title">${t.platformsTitle}</div>
            <div class="platform-pills">${platforms.map((p) => `<span class="platform-pill">${p}</span>`).join("")}</div>
          </div>
        </div>
      </section>

      <!-- How it works -->
      <section class="section">
        <div class="container">
          <h2 class="section-title section-title-center reveal">${t.howTitle}</h2>
          <div class="steps-grid reveal-stagger" id="stepsGrid">
            <div class="card step-card">
              <div class="step-num">i</div>
              <div class="step-title">${t.step1Title}</div>
              <div class="step-desc">${t.step1Desc}</div>
            </div>
            <div class="card step-card">
              <div class="step-num">ii</div>
              <div class="step-title">${t.step2Title}</div>
              <div class="step-desc">${t.step2Desc}</div>
            </div>
            <div class="card step-card">
              <div class="step-num">iii</div>
              <div class="step-title">${t.step3Title}</div>
              <div class="step-desc">${t.step3Desc}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- FAQ -->
      <section class="section" id="faq">
        <div class="container">
          <h2 class="section-title section-title-center reveal">${t.faqTitle}</h2>
          <div class="faq-list reveal">
            <details class="faq-item">
              <summary>${t.faq1Q}</summary>
              <div class="faq-answer">${t.faq1A}</div>
            </details>
            <details class="faq-item">
              <summary>${t.faq2Q}</summary>
              <div class="faq-answer">${t.faq2A}</div>
            </details>
            <details class="faq-item">
              <summary>${t.faq3Q}</summary>
              <div class="faq-answer">${t.faq3A}</div>
            </details>
            <details class="faq-item">
              <summary>${t.faq4Q}</summary>
              <div class="faq-answer">${t.faq4A}</div>
            </details>
            <details class="faq-item">
              <summary>${t.faq5Q}</summary>
              <div class="faq-answer">${t.faq5A}</div>
            </details>
            <details class="faq-item">
              <summary>${t.faq6Q}</summary>
              <div class="faq-answer">${t.faq6A}</div>
            </details>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="cta-section">
        <div class="container">
          <h2 class="cta-title reveal">${t.ctaTitle}</h2>
          <div class="reveal" style="text-align:center">
            <a href="/https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/" class="example-link">
              <span class="hl">${h}/</span>https://developers.cloudflare.com/... <span>&rarr;</span>
            </a>
          </div>
        </div>
      </section>

    </div>

    <!-- ==================== TAB 2: DOCS ==================== -->
    <div class="tab-content" id="tab-docs">
      <section class="section">
        <div class="docs-section">

          <!-- Quick Start -->
          <div class="doc-card">
            <h3>${t.quickStartTitle}</h3>
            <div class="code-block"><code><span class="code-comment">${t.curlRawComment}</span>
curl -H "Accept: text/markdown" https://${h}/https://example.com

<span class="code-comment">${t.curlJsonComment}</span>
curl "https://${h}/https://example.com?raw=true&amp;format=json"

<span class="code-comment">${t.curlBatchComment}</span>
curl -X POST https://${h}/api/batch \\
  -H "Authorization: Bearer API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://example.com"]}'</code></div>
          </div>

          <!-- API Routes -->
          <div class="doc-card">
            <h3>${t.apiTitle}</h3>
            <table class="route-table">
              <thead><tr><th>${t.apiRouteTitle}</th><th></th></tr></thead>
              <tbody>
                <tr><td><code>GET /{url}</code></td><td>${t.apiGetDesc}</td></tr>
                <tr><td><code>GET /api/stream</code></td><td>${t.streamDesc}</td></tr>
                <tr><td><code>POST /api/batch</code></td><td>${t.batchDesc}</td></tr>
                <tr><td><code>POST /api/extract</code></td><td>${t.extractDesc}</td></tr>
                <tr><td><code>POST /api/jobs</code></td><td>${t.jobsDesc}</td></tr>
                <tr><td><code>POST /api/deepcrawl</code></td><td>${t.deepcrawlDesc}</td></tr>
                <tr><td><code>GET /api/health</code></td><td>${t.healthDesc}</td></tr>
                <tr><td><code>GET /api/og</code></td><td>${t.ogDesc}</td></tr>
                <tr><td><code>GET /llms.txt</code></td><td>${t.llmsTxtRouteDesc}</td></tr>
              </tbody>
            </table>
          </div>

          <!-- Query Parameters -->
          <div class="doc-card">
            <h3>${t.queryParamsTitle}</h3>
            <table class="param-table">
              <tbody>
                <tr><td><code>?raw=true</code></td><td>${t.rawDesc}</td></tr>
                <tr><td><code>?format=</code></td><td>${t.formatDesc} (<code>markdown</code> | <code>html</code> | <code>text</code> | <code>json</code>)</td></tr>
                <tr><td><code>?selector=.css</code></td><td>${t.selectorDesc}</td></tr>
                <tr><td><code>?force_browser=true</code></td><td>${t.forceBrowserDesc}</td></tr>
                <tr><td><code>?engine=jina</code></td><td>${t.engineDesc}</td></tr>
                <tr><td><code>?no_cache=true</code></td><td>${t.noCacheDesc}</td></tr>
                <tr><td><code>?token=</code></td><td>${t.tokenDesc}</td></tr>
              </tbody>
            </table>
          </div>

          <!-- Authentication -->
          <div class="doc-card">
            <h3>${t.authTitle}</h3>
            <p style="font-size:14px;color:var(--text-secondary);line-height:1.7;margin-bottom:8px"><code style="font-family:var(--font-mono);font-size:12px;color:var(--accent-text);background:rgba(34,211,238,0.06);padding:2px 6px;border-radius:3px">PUBLIC_API_TOKEN</code> &mdash; ${t.publicAuthDesc}</p>
            <p style="font-size:14px;color:var(--text-secondary);line-height:1.7"><code style="font-family:var(--font-mono);font-size:12px;color:var(--accent-text);background:rgba(34,211,238,0.06);padding:2px 6px;border-radius:3px">API_TOKEN</code> &mdash; ${t.privateAuthDesc}</p>
          </div>

          <!-- curl Examples -->
          <div class="doc-card">
            <h3>${t.curlExamplesTitle}</h3>
            <div class="code-block"><code><span class="code-comment">${t.curlRaw}</span>
curl -H "Accept: text/markdown" https://${h}/https://example.com

<span class="code-comment">${t.curlJson}</span>
curl "https://${h}/https://example.com?raw=true&amp;format=json"

<span class="code-comment">${t.curlBatch}</span>
curl -X POST https://${h}/api/batch \\
  -H "Authorization: Bearer API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://example.com"]}'

<span class="code-comment">${t.curlExtract}</span>
curl -X POST https://${h}/api/extract \\
  -H "Authorization: Bearer API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"strategy":"css","url":"https://example.com","schema":{"fields":[{"name":"title","selector":"h1","type":"text","required":true}]}}'

<span class="code-comment">${t.curlCrawl}</span>
curl -X POST https://${h}/api/deepcrawl \\
  -H "Authorization: Bearer API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"seed":"https://example.com/docs","stream":true}'</code></div>
          </div>

          <!-- Response Headers -->
          <div class="doc-card">
            <h3>${t.responseHeadersTitle}</h3>
            <table class="param-table">
              <tbody>
                <tr><td><code>X-Markdown-Method</code></td><td>native | readability+turndown | browser+readability+turndown | jina</td></tr>
                <tr><td><code>X-Cache-Status</code></td><td>HIT | MISS</td></tr>
                <tr><td><code>X-Source-URL</code></td><td>${t.sourceUrlDesc}</td></tr>
              </tbody>
            </table>
          </div>

        </div>
      </section>
    </div>

    <!-- ==================== TAB 3: INTEGRATION ==================== -->
    <div class="tab-content" id="tab-integration">
      <section class="section">
        <div class="integration-section">

          <!-- Decision Tree -->
          <div class="decision-tree">
            <h3>${t.decisionTreeTitle}</h3>
            <div class="decision-item"><strong>${t.decisionSkills}</strong></div>
            <div class="decision-item" style="padding-left:36px">${t.decisionYes}</div>
            <div class="decision-item" style="padding-left:36px">${t.decisionNo}</div>
            <div class="decision-item" style="margin-top:8px">${t.decisionAll}</div>
          </div>

          <!-- Agent Skills -->
          <div class="int-card">
            <h3>${t.skillTitle}</h3>
            <div class="for-line">${t.skillFor}</div>
            <p>${t.skillDesc}</p>
            <div class="cmd-label">${t.skillClaudeCode}</div>
            <code class="cmd-block">${t.skillClaudeCmd}</code>
            <div class="cmd-label">${t.skillOpenClaw}</div>
            <code class="cmd-block">${t.skillOpenClawCmd}</code>
            <div class="int-note">${t.skillNote}</div>
          </div>

          <!-- MCP Server -->
          <div class="int-card">
            <h3>${t.mcpTitle}</h3>
            <div class="for-line">${t.mcpFor}</div>
            <p>${t.mcpDesc}</p>
            <code class="cmd-block">${t.mcpCmd}</code>
            <div class="cmd-label">${t.mcpConfigTitle} (~/.claude/claude_desktop_config.json)</div>
            <code class="config-block">{
  "mcpServers": {
    "website2markdown": {
      "command": "mcp-website2markdown",
      "env": {
        "WEBSITE2MARKDOWN_API_URL": "https://${h}"
      }
    }
  }
}</code>
          </div>

          <!-- llms.txt -->
          <div class="int-card">
            <h3>${t.llmsTxtTitle}</h3>
            <div class="for-line">${t.llmsTxtFor}</div>
            <p>${t.llmsTxtDesc}</p>
            <a href="/llms.txt" class="accent-link" style="font-family:var(--font-mono);font-size:13px">https://${h}/llms.txt &rarr;</a>
          </div>

          <!-- Comparison Table -->
          <div class="int-card">
            <h3>${t.comparisonTitle}</h3>
            <table class="comp-table">
              <thead>
                <tr><th></th><th>Skills</th><th>MCP</th><th>llms.txt</th></tr>
              </thead>
              <tbody>
                <tr><td>${t.compLatency}</td><td>&#9733;&#9733;&#9733;</td><td>&#9733;&#9733;</td><td>&#9733;&#9733;&#9733;</td></tr>
                <tr><td>${t.compContext}</td><td>&#9733;&#9733;&#9733;</td><td>&#9733;</td><td>&#9733;&#9733;</td></tr>
                <tr><td>${t.compInstall}</td><td>${t.compSkillsInstall}</td><td>${t.compMcpInstall}</td><td>${t.compLlmsInstall}</td></tr>
                <tr><td>${t.compBestFor}</td><td>${t.compSkillsBest}</td><td>${t.compMcpBest}</td><td>${t.compLlmsBest}</td></tr>
              </tbody>
            </table>
          </div>

        </div>
      </section>
    </div>
  </main>

  <!-- ===== FOOTER ===== -->
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-col">
          <div class="footer-col-title">${t.footerProduct}</div>
          <a href="/#">API</a>
          <a href="/#" onclick="switchTab('docs');return false;">Batch</a>
          <a href="/#" onclick="switchTab('docs');return false;">Extract</a>
          <a href="/#" onclick="switchTab('docs');return false;">Deep Crawl</a>
          <a href="/#" onclick="switchTab('docs');return false;">Jobs</a>
          <a href="/api/health">Health</a>
        </div>
        <div class="footer-col">
          <div class="footer-col-title">${t.footerIntegration}</div>
          <a href="/#integration" onclick="switchTab('integration');return false;">Agent Skills</a>
          <a href="/#integration" onclick="switchTab('integration');return false;">MCP Server</a>
          <a href="/llms.txt">llms.txt</a>
          <a href="https://www.npmjs.com/package/@digidai/mcp-website2markdown" target="_blank">npm</a>
        </div>
        <div class="footer-col">
          <div class="footer-col-title">${t.footerOpenSource}</div>
          <a href="https://github.com/Digidai/website2markdown" target="_blank">GitHub</a>
          <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank">Apache-2.0</a>
          <a href="https://github.com/Digidai/website2markdown/blob/main/CONTRIBUTING.md" target="_blank">${t.footerContributing}</a>
          <a href="https://github.com/Digidai/website2markdown/security" target="_blank">${t.footerSecurity}</a>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; 2026 Digidai</span>
        <div class="theme-toggle" id="themeToggle">
          <button class="theme-btn" data-theme="light" onclick="setTheme('light')">${t.footerThemeLight}</button>
          <button class="theme-btn" data-theme="dark" onclick="setTheme('dark')">${t.footerThemeDark}</button>
          <button class="theme-btn active" data-theme="system" onclick="setTheme('system')">${t.footerThemeSystem}</button>
        </div>
      </div>
    </div>
  </footer>

  <script type="application/ld+json">${schemaJson}</script>
  <script>
    /* ---- Tab switching ---- */
    function switchTab(name) {
      document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
      document.querySelectorAll('.tab-btn').forEach(function(el) { el.classList.remove('active'); });
      var target = document.getElementById('tab-' + name);
      if (target) target.classList.add('active');
      var btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
      if (btn) btn.classList.add('active');
      history.replaceState(null, '', '#' + name);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ---- Hash-based tab on load ---- */
    (function() {
      var hash = location.hash.replace('#', '');
      if (hash === 'docs' || hash === 'integration') switchTab(hash);
    })();

    /* ---- URL form submission ---- */
    function handleSubmit(e) {
      e.preventDefault();
      var input = document.getElementById('urlInput').value.trim();
      if (!input) return false;
      var btn = e.target.querySelector('.convert-btn');
      var inp = document.getElementById('urlInput');
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span>' + ${JSON.stringify(t.convertingButton)};
      inp.disabled = true;
      window.location.href = '/' + input;
      return false;
    }

    /* ---- Restore form on bfcache ---- */
    window.addEventListener('pageshow', function(e) {
      if (e.persisted) {
        var btn = document.querySelector('#urlForm .convert-btn');
        var inp = document.getElementById('urlInput');
        if (btn) { btn.disabled = false; btn.textContent = ${JSON.stringify(t.convertButton)}; }
        if (inp) inp.disabled = false;
      }
    });

    /* ---- Mobile placeholder ---- */
    if (window.matchMedia('(max-width: 768px)').matches) {
      var el = document.getElementById('urlInput');
      if (el) el.placeholder = ${JSON.stringify(t.mobilePlaceholder)};
    }

    /* ---- Dark mode toggle ---- */
    function setTheme(mode) {
      document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.remove('active'); });
      var btn = document.querySelector('.theme-btn[data-theme="' + mode + '"]');
      if (btn) btn.classList.add('active');
      if (mode === 'system') {
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem('theme');
      } else {
        document.documentElement.setAttribute('data-theme', mode);
        localStorage.setItem('theme', mode);
      }
    }

    (function() {
      var saved = localStorage.getItem('theme');
      if (saved) setTheme(saved);
    })();

    /* ---- Scroll reveal (IntersectionObserver) ---- */
    (function() {
      if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.reveal, .reveal-stagger').forEach(function(el) {
          el.classList.add('visible');
        });
        return;
      }
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
      document.querySelectorAll('.reveal, .reveal-stagger').forEach(function(el) {
        observer.observe(el);
      });
    })();

    /* ---- Header scroll shadow ---- */
    (function() {
      var header = document.getElementById('siteHeader');
      if (!header) return;
      var scrolled = false;
      window.addEventListener('scroll', function() {
        var s = window.scrollY > 10;
        if (s !== scrolled) {
          scrolled = s;
          header.classList.toggle('scrolled', s);
        }
      }, { passive: true });
    })();

    /* ---- Mobile menu toggle ---- */
    function toggleMobileMenu() {
      var nav = document.getElementById('headerNav');
      if (nav) nav.classList.toggle('open');
    }
  </script>
</body>
</html>`;
}
