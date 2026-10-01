import { escapeHtml } from "../security";
import { FONT_UI, THEME_BASE, THEME_BOOT, THEME_TOKENS } from "./theme";

type LandingLang = "en" | "zh";
export type SitePage = "home" | "examples" | "docs" | "integration";

export function landingPageHTML(host: string, lang: LandingLang = "en", page: SitePage = "home"): string {
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
        portalLabel: "获取 API Key",
        // Hero
        heroTitleHtml: "打不开的网页，交给它",
        heroSubtitle: "在链接前加上这个域名。普通网页、以及微信公众号、知乎、飞书这类会把阅读器挡在外面的站点，都会以 Markdown 返回。给你自己看，也给 Agent 用。",
        inputPlaceholder: "粘贴任意 URL",
        convertButton: "转换",
        convertingButton: "转换中",
        hintKeys: "可选参数：format、selector、force_browser、raw、engine",
        formError: "先粘贴一个 URL。",
        copyLabel: "复制",
        copiedLabel: "已复制",
        copyFailed: "请手动选择复制",
        // Why cards
        why1Title: "SPA、付费墙与反爬页面",
        why1Desc: "16 个适配器覆盖微信公众号、知乎、飞书、Twitter 等国内外平台。静态抓取拿不到内容时，自动升级到无头浏览器。",
        why2Title: "你的 Agent 直接可用",
        why2Desc: "自带 MCP Server、Agent Skills 与 llms.txt。把 Claude、Cursor 或自研 Agent 指过来就能用，不需要写胶水代码。",
        why3Title: "五层兜底，逐层降级",
        why3Desc: "原生提取、Readability、无头浏览器、Firecrawl、Jina 依次尝试。浏览器和外部阅读器需要 API key。结果缓存在边缘。",
        // Use cases
        useCasesTitle: "大家拿它做什么",
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
        platformsTitle: "16 个平台适配器",
        // How it works
        howTitle: "工作原理",
        step1Title: "添加前缀",
        step1Desc: "在任意网址前加上 md.genedai.me/",
        step2Title: "边缘处理",
        step2Desc: "按顺序尝试：原生提取、Readability、浏览器、Firecrawl、Jina。浏览器和外部阅读器需要 API key。",
        step3Title: "干净输出",
        step3Desc: "Markdown、JSON、HTML 或纯文本",
        // FAQ
        faqTitle: "常见问题",
        faq1Q: "什么是 Website2Markdown？",
        faq1A: "一个免费、开源的 API，可将任意网页 URL 转为干净、可读的 Markdown。基于 Cloudflare Workers，5 层 fallback 管线：原生边缘 Markdown &rarr; Readability &rarr; 无头浏览器/CF REST &rarr; Firecrawl &rarr; Jina Reader。",
        faq2Q: "它是免费的吗？",
        faq2A: "是的，完全免费并以 Apache-2.0 开源。你可以自行部署，也可以使用 md.genedai.me 的托管服务。",
        faq3Q: "支持哪些平台？",
        faq3A: "16 个内置适配器：微信公众号、知乎、飞书/Lark、语雀、掘金、CSDN、36氪、头条、微博、网易、Twitter/X、Reddit、Notion、GitHub、Substack、Medium。任何公开 URL 都可通过通用 fallback 处理。",
        faq4Q: "如何处理 JS 渲染密集型页面？",
        faq4A: "原生提取失败后升级到 Readability。浏览器渲染、Firecrawl 和 Jina 需要 API key。转换成功且实际走了浏览器时计 3 credits，缓存命中仍是 1。持有 key 时可用 ?force_browser=true。",
        faq5Q: "如何与 AI Agent 集成？",
        faq5A: "三种方式：(1) Agent Skills——Claude Code/OpenClaw 一条命令安装。(2) MCP Server——Claude Desktop、Cursor IDE。(3) llms.txt——所有 AI 系统自动发现。",
        faq6Q: "如何使用 API？",
        faq6A: "在任意 URL 前加上 md.genedai.me/。获取原始 Markdown 加 ?raw=true。示例：curl \"https://md.genedai.me/https://example.com?raw=true\"。完整 API 参考见文档标签页。",
        // CTA
        ctaTitle: "粘贴一个 URL。",
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
        engineDesc: "使用指定引擎转换（jina / firecrawl / cf）",
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
        decisionTreeTitle: "选一种接法",
        decisionSkills: "Agent 有终端。",
        decisionYes: "安装 Agent Skills。一条命令，带上用法和 16 个平台的说明。",
        decisionNo: "没有终端，用 MCP Server。",
        decisionAll: "任何能打开网页的系统，读 llms.txt 就能发现接口。",
        skillTitle: "Agent Skills",
        skillDesc: "一条命令安装，Agent 自动发现。包含完整使用模式、错误处理和 16 个平台适配器指南。",
        skillFor: "适用：Claude Code、Codex CLI、Gemini CLI、OpenClaw",
        skillClaudeCode: "Claude Code",
        skillClaudeCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.claude/skills/website2markdown",
        skillCodex: "Codex CLI",
        skillCodexCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.codex/skills/website2markdown",
        skillGemini: "Gemini CLI",
        skillGeminiCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.gemini/skills/website2markdown",
        skillOpenClaw: "OpenClaw",
        skillOpenClawCmd: "npx clawhub@latest install website2markdown",
        skillNote: "一条命令安装，新会话自动发现，无需额外配置",
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
        compLatencyHigh: "最低",
        compLatencyMid: "低",
        compContextHigh: "最全",
        compContextMid: "部分",
        compContextLow: "较少",
        layer1Name: "原生 Markdown",
        layer1Meta: "Cloudflare 边缘，约 0.1 秒",
        layer2Name: "Readability",
        layer2Meta: "解析 HTML，约 0.5 秒",
        layer3Name: "无头浏览器",
        layer3Meta: "约 2–5 秒",
        layer4Name: "Cloudflare REST",
        layer4Meta: "约 1–3 秒",
        layer5Name: "Firecrawl，然后 Jina",
        layer5Meta: "外部兜底，约 2–4 秒",
        pipelineNote: "按这个顺序尝试，拿到内容就返回。",
        footerContributing: "贡献指南",
        footerSecurity: "安全",
        footerThemeLight: "浅色",
        footerThemeDark: "深色",
        footerThemeSystem: "跟随系统",
        mobilePlaceholder: "https://example.com/article",
        exampleLabel: "试一个示例",
        // Mockup: Hero WeChat
        mockupWechatBadge: "微信公众号",
        mockupFollow: "关注公众号",
        mockupArticleTitle: "深度解析：大模型在企业的落地实践",
        mockupAuthorDate: "林可，2026-03-25",
        mockupWechatBlock: "此内容需要在微信客户端中打开",
        mockupQrHint: "长按识别二维码",
        mockupOpenWechat: "在微信中打开",
        mockupRecommended: "推荐阅读",
        mockupH2KeyPoints: "核心观点",
        mockupH2Background: "背景",
        mockupBullet1: "大模型的应用场景正在从实验室走向生产环境",
        mockupBullet2: "RAG 架构成为企业级应用的首选方案",
        mockupBullet3: "Agent 工作流将重新定义软件开发流程",
        mockupBgParagraph: "随着 GPT-4、Claude 等模型的发布，企业开始认真考虑将大语言模型集成到核心业务流程中...",
        // Mockup: Feature 1 Zhihu
        mockupZhihuSlogan: "知乎 - 有问题，就会有答案",
        mockupZhihuTitle: "如何评价大模型在企业中的落地？",
        mockupZhihuContent: "近年来，随着大语言模型技术的突破性进展，越来越多的企业开始探索将 AI 融入核心业务...",
        mockupLoginRequired: "登录后查看完整内容",
        mockupLoginRequiredSub: "Login to view full content",
        mockupLogin: "登录",
        mockupRegister: "注册",
        mockupZhihuAnswer: "如何评价大模型在企业中的落地？",
        mockupZhihuParagraph: "近年来，随着大语言模型技术的突破性进展，越来越多的企业开始探索将 AI 融入核心业务流程。",
        mockupZhihuH3: "三大趋势",
        mockupZhihuBullet1: "多模态能力成为标配",
        mockupZhihuBullet2: "私有化部署需求增长",
        mockupZhihuBullet3: "Agent 框架百花齐放",
        mockupExtractedBadge: "通过浏览器渲染提取",
        mockupLabelBlocked: "页面上看到的",
        mockupLabelClean: "转成的 Markdown",
        // Mockup: Feature 2 Chat
        mockupChatUserMsg: "读一下这篇文章，总结核心观点",
        mockupChatSummaryIntro: "这篇文章的核心观点：",
        mockupChatPoint1: "大模型正在从实验走向生产",
        mockupChatPoint2: "RAG 是当前最实用的架构",
        mockupChatPoint3: "Agent 将改变软件开发方式",
        mockupChatEnding: "文章还提到了一个有趣的案例...",
        // Mockup: Feature 3 Pipeline
        mockupPipelineResult: "返回干净的 Markdown。",
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
        portalLabel: "Get API Key",
        // Hero
        heroTitleHtml: "Pages your agent can't open",
        heroSubtitle: "Put this host in front of the link. Ordinary pages, and the ones that keep a reader out &mdash; WeChat, Zhihu, Feishu &mdash; come back as Markdown. For you, and for an agent.",
        inputPlaceholder: "Paste any URL",
        convertButton: "Convert",
        convertingButton: "Converting",
        hintKeys: "Optional: format, selector, force_browser, raw, engine",
        formError: "Paste a URL first.",
        copyLabel: "Copy",
        copiedLabel: "Copied",
        copyFailed: "Select the text to copy",
        // Why cards
        why1Title: "SPAs, paywalls, anti-bot pages",
        why1Desc: "Sixteen adapters cover WeChat, Zhihu, Feishu, Twitter and more. When a static fetch comes back empty, it escalates to a headless browser.",
        why2Title: "Reachable from your agent",
        why2Desc: "An MCP server, Agent Skills, and llms.txt ship with it. Point Claude, Cursor, or your own agent at the host &mdash; no glue code.",
        why3Title: "Five fallbacks, in order",
        why3Desc: "Native extraction, Readability, a headless browser, Firecrawl, then Jina. Browser rendering and external readers require an API key. Results are cached at the edge.",
        // Use cases
        useCasesTitle: "What people use it for",
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
        platformsTitle: "16 Platform Adapters",
        // How it works
        howTitle: "How it works",
        step1Title: "Prepend URL",
        step1Desc: "Add md.genedai.me/ before any web address",
        step2Title: "Edge Pipeline",
        step2Desc: "Tried in order: native extraction, Readability, a browser, Firecrawl, then Jina. Browser rendering and external readers require an API key.",
        step3Title: "Clean Output",
        step3Desc: "Markdown, JSON, HTML, or plain text",
        // FAQ
        faqTitle: "Frequently asked questions",
        faq1Q: "What is Website2Markdown?",
        faq1A: "A free, open-source API that converts any web page URL to clean Markdown. Built on Cloudflare Workers with 5-layer fallback: native edge Markdown &rarr; Readability &rarr; headless browser/CF REST &rarr; Firecrawl &rarr; Jina Reader.",
        faq2Q: "Is it free?",
        faq2A: "Yes, completely free and open source under Apache-2.0. Self-host or use the managed service at md.genedai.me.",
        faq3Q: "Which platforms are supported?",
        faq3A: "16 built-in adapters: WeChat, Zhihu, Feishu/Lark, Yuque, Juejin, CSDN, 36Kr, Toutiao, Weibo, NetEase, Twitter/X, Reddit, Notion, GitHub, Substack, and Medium. Any public URL works via generic fallback.",
        faq4Q: "How does it handle JS-heavy pages?",
        faq4A: "If native extraction fails, it escalates to Readability. Browser rendering, Firecrawl, and Jina require an API key. A successful live browser render costs 3 credits, and a cache hit stays at 1. With a key, use ?force_browser=true to go straight to the browser.",
        faq5Q: "How to integrate with my AI agent?",
        faq5A: "Three ways: (1) Agent Skills for Claude Code/OpenClaw -- one command install. (2) MCP Server for Claude Desktop/Cursor. (3) llms.txt for auto-discovery by any AI system.",
        faq6Q: "How to use the API?",
        faq6A: "Prepend md.genedai.me/ before any URL. For raw Markdown, add ?raw=true. Example: curl \"https://md.genedai.me/https://example.com?raw=true\". See the Docs tab for full API reference.",
        // CTA
        ctaTitle: "Paste a URL.",
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
        engineDesc: "Convert via specific engine (jina / firecrawl / cf)",
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
        decisionTreeTitle: "Pick one",
        decisionSkills: "The agent has a terminal.",
        decisionYes: "Install Agent Skills. One command, with usage notes and guides for all 16 adapters.",
        decisionNo: "No terminal: use the MCP server.",
        decisionAll: "Anything that can open a web page can read llms.txt and discover the API.",
        skillTitle: "Agent Skills",
        skillDesc: "One command to install, auto-discovered by your agent. Includes full usage patterns, error handling, and guides for all 16 platform adapters.",
        skillFor: "For: Claude Code, Codex CLI, Gemini CLI, OpenClaw",
        skillClaudeCode: "Claude Code",
        skillClaudeCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.claude/skills/website2markdown",
        skillCodex: "Codex CLI",
        skillCodexCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.codex/skills/website2markdown",
        skillGemini: "Gemini CLI",
        skillGeminiCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.gemini/skills/website2markdown",
        skillOpenClaw: "OpenClaw",
        skillOpenClawCmd: "npx clawhub@latest install website2markdown",
        skillNote: "One command install, auto-discovered in new sessions",
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
        footerOpenSource: "Open source",
        compLatencyHigh: "Lowest",
        compLatencyMid: "Low",
        compContextHigh: "Full",
        compContextMid: "Partial",
        compContextLow: "Light",
        layer1Name: "Native Markdown",
        layer1Meta: "Cloudflare edge, about 0.1s",
        layer2Name: "Readability",
        layer2Meta: "HTML parsing, about 0.5s",
        layer3Name: "Headless browser",
        layer3Meta: "about 2–5s",
        layer4Name: "Cloudflare REST",
        layer4Meta: "about 1–3s",
        layer5Name: "Firecrawl, then Jina",
        layer5Meta: "External fallback, about 2–4s",
        pipelineNote: "Each layer is tried in order. The first one that returns content wins.",
        footerContributing: "Contributing",
        footerSecurity: "Security",
        footerThemeLight: "Light",
        footerThemeDark: "Dark",
        footerThemeSystem: "System",
        mobilePlaceholder: "https://example.com/article",
        exampleLabel: "Try an example",
        // Mockup: Hero WeChat
        mockupWechatBadge: "WeChat Official",
        mockupFollow: "Follow",
        mockupArticleTitle: "Deep Dive: LLMs in Enterprise Production",
        mockupAuthorDate: "Lin Ke, 2026-03-25",
        mockupWechatBlock: "This content requires the WeChat app",
        mockupQrHint: "Scan QR code",
        mockupOpenWechat: "Open in WeChat",
        mockupRecommended: "Recommended",
        mockupH2KeyPoints: "Key Takeaways",
        mockupH2Background: "Background",
        mockupBullet1: "LLMs are moving from lab experiments to production environments",
        mockupBullet2: "RAG architecture is the preferred approach for enterprise apps",
        mockupBullet3: "Agent workflows will redefine software development",
        mockupBgParagraph: "With the release of GPT-4, Claude, and other models, enterprises are seriously considering integrating LLMs into their core business workflows...",
        // Mockup: Feature 1 Zhihu
        mockupZhihuSlogan: "Zhihu - Q&amp;A Platform",
        mockupZhihuTitle: "How do you evaluate LLM adoption in enterprises?",
        mockupZhihuContent: "In recent years, with breakthroughs in large language model technology, more and more enterprises are exploring integrating AI into core business...",
        mockupLoginRequired: "Login to view full content",
        mockupLoginRequiredSub: "Sign in required to continue reading",
        mockupLogin: "Login",
        mockupRegister: "Sign up",
        mockupZhihuAnswer: "How do you evaluate LLM adoption in enterprises?",
        mockupZhihuParagraph: "In recent years, with breakthroughs in large language model technology, more and more enterprises are exploring integrating AI into core business workflows.",
        mockupZhihuH3: "Three Key Trends",
        mockupZhihuBullet1: "Multimodal capabilities becoming standard",
        mockupZhihuBullet2: "Growing demand for private deployment",
        mockupZhihuBullet3: "Agent frameworks flourishing",
        mockupExtractedBadge: "Extracted with browser rendering",
        mockupLabelBlocked: "What the page shows",
        mockupLabelClean: "Markdown you get",
        // Mockup: Feature 2 Chat
        mockupChatUserMsg: "Read this article and summarize the key points",
        mockupChatSummaryIntro: "Here are the key takeaways from the article:",
        mockupChatPoint1: "LLMs are moving from experiments to production",
        mockupChatPoint2: "RAG is the most practical architecture currently",
        mockupChatPoint3: "Agents will transform software development",
        mockupChatEnding: "The article also mentions an interesting case study...",
        // Mockup: Feature 3 Pipeline
        mockupPipelineResult: "You get clean Markdown back.",
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
          "16 platform adapters",
          "Batch API",
          "Structured extraction",
          "Deep crawl",
          "MCP Server",
          "Agent Skills",
          "llms.txt",
        ],
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
        name: isZh ? "如何将 URL 转换为 Markdown" : "How to convert a URL to Markdown",
        step: [
          { "@type": "HowToStep", name: t.step1Title, text: t.step1Desc.replace(/&rarr;/g, "->") },
          { "@type": "HowToStep", name: t.step2Title, text: t.step2Desc.replace(/&rarr;/g, "->") },
          { "@type": "HowToStep", name: t.step3Title, text: t.step3Desc },
        ],
      },
    ],
  })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  const iconGithub = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`;

  const platforms = ["WeChat", "Zhihu", "Feishu", "Yuque", "Juejin", "CSDN", "36Kr", "Toutiao", "Weibo", "NetEase", "Twitter/X", "Reddit", "Notion", "GitHub", "Substack", "Medium"];
  const pagePath: Record<SitePage, string> = {
    home: "/",
    examples: "/examples",
    docs: "/docs",
    integration: "/integrations",
  };
  const langHref = (pathname: string, language: LandingLang) =>
    language === "zh" ? (pathname === "/" ? "/?lang=zh" : `${pathname}?lang=zh`) : pathname === "/" ? "/?lang=en" : pathname;
  const stay = (pathname: string) => (isZh ? langHref(pathname, "zh") : pathname === "/" ? "/" : pathname);
  const documentTitle =
    page === "examples" ? (isZh ? "示例" : "Examples")
    : page === "docs" ? (isZh ? "文档" : "Docs")
    : page === "integration" ? (isZh ? "集成" : "Integrations")
    : t.pageTitle;
  const canonicalPath = pagePath[page];
  const canonical = `https://${h}${isZh ? langHref(canonicalPath, "zh") : canonicalPath === "/" ? "/" : canonicalPath}`;

  const wechatProof = `<article class="exhibit">
    <div class="exhibit-copy">
      <h2>${t.why1Title}</h2>
      <p>${t.why1Desc}</p>
    </div>
    <div class="compare">
      <div class="compare-col">
        <p class="compare-label">${t.mockupLabelBlocked}</p>
        <p class="compare-kicker">${t.mockupWechatBadge}</p>
        <h3>${t.mockupArticleTitle}</h3>
        <p class="compare-meta">${t.mockupAuthorDate}</p>
        <p class="compare-block">${t.mockupWechatBlock}</p>
        <p class="compare-note">${t.mockupQrHint}</p>
      </div>
      <div class="compare-col">
        <p class="compare-label">${t.mockupLabelClean}</p>
        <pre class="specimen-md"># ${t.mockupArticleTitle}

&gt; ${t.mockupAuthorDate}

## ${t.mockupH2KeyPoints}

1. ${t.mockupBullet1}
2. ${t.mockupBullet2}
3. ${t.mockupBullet3}

## ${t.mockupH2Background}

${t.mockupBgParagraph}</pre>
      </div>
    </div>
  </article>`;

  const zhihuProof = `<article class="exhibit">
    <div class="exhibit-copy">
      <h2>${isZh ? "登录墙后面的全文" : "The rest of a login wall"}</h2>
      <p>${isZh ? "知乎这类页面会停在登录框。浏览器渲染把正文提出来，不需要你先注册。" : "Zhihu stops on a sign-in box. Browser rendering pulls the article out. You don't register first."}</p>
    </div>
    <div class="compare">
      <div class="compare-col">
        <p class="compare-label">${t.mockupLabelBlocked}</p>
        <p class="compare-kicker">${t.mockupZhihuSlogan}</p>
        <h3>${t.mockupZhihuTitle}</h3>
        <p class="compare-note">${t.mockupZhihuContent}</p>
        <p class="compare-block">${t.mockupLoginRequired}</p>
      </div>
      <div class="compare-col">
        <p class="compare-label">${t.mockupLabelClean}</p>
        <pre class="specimen-md"># ${t.mockupZhihuAnswer}

${t.mockupZhihuParagraph}

## ${t.mockupZhihuH3}

- ${t.mockupZhihuBullet1}
- ${t.mockupZhihuBullet2}
- ${t.mockupZhihuBullet3}</pre>
        <p class="compare-note">${t.mockupExtractedBadge}</p>
      </div>
    </div>
  </article>`;

  const agentProof = `<article class="exhibit">
    <div class="exhibit-copy">
      <h2>${t.why2Title}</h2>
      <p>${t.why2Desc}</p>
    </div>
    <div class="transcript">
      <p><span class="who">${isZh ? "你" : "You"}</span> ${t.mockupChatUserMsg}</p>
      <p class="tool">convert_url
url: https://mp.weixin.qq.com/s/abc123</p>
      <p><span class="who">Agent</span> ${t.mockupChatSummaryIntro}</p>
      <ol>
        <li>${t.mockupChatPoint1}</li>
        <li>${t.mockupChatPoint2}</li>
        <li>${t.mockupChatPoint3}</li>
      </ol>
      <p>${t.mockupChatEnding}</p>
    </div>
  </article>`;

  const html = `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${h} - ${documentTitle}</title>
  <meta name="description" content="${t.metaDescription}">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <meta name="author" content="Digidai">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="https://${h}${canonicalPath === "/" ? "/" : canonicalPath}">
  <link rel="alternate" hreflang="zh" href="https://${h}${langHref(canonicalPath, "zh")}">
  <link rel="alternate" hreflang="x-default" href="https://${h}${canonicalPath === "/" ? "/" : canonicalPath}">
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${h} — ${documentTitle}">
  <meta property="og:description" content="${t.shareDescription}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="${h}">
  <meta property="og:image" content="https://${h}/api/og">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${t.locale}">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${h} — ${documentTitle}">
  <meta name="twitter:description" content="${t.shareDescription}">
  <meta name="twitter:image" content="https://${h}/api/og">
  ${THEME_BOOT}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONT_UI}" rel="stylesheet">
  <style>
    ${THEME_TOKENS}
    ${THEME_BASE}

    .container { max-width: var(--max-w); margin: 0 auto; padding: 0 24px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }

    .site-header {
      position: sticky; top: 0; z-index: 20; min-height: var(--header-h);
      background: var(--bg);
      border-bottom: 1px solid var(--border);
    }
    .header-inner {
      max-width: var(--max-w); margin: 0 auto; padding: 0 24px;
      min-height: var(--header-h); display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .site-name {
      font-size: 15px; font-weight: 600; color: var(--text-primary);
      text-decoration: none; letter-spacing: -0.01em;
    }
    .site-name:hover { color: var(--accent-text); }
    .header-nav { display: flex; align-items: center; gap: 4px; }
    .tab-btn {
      background: none; border: none; cursor: pointer;
      font-family: inherit; font-size: 15px; font-weight: 500;
      color: var(--text-secondary); padding: 8px 12px; border-radius: 0;
      min-height: 40px; text-decoration: none;
      display: inline-flex; align-items: center;
      box-shadow: inset 0 -2px 0 transparent;
    }
    .tab-btn:hover { color: var(--text-primary); }
    .tab-btn.active { color: var(--text-primary); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
    .header-right { display: flex; align-items: center; gap: 8px; }
    .lang-switch { display: inline-flex; align-items: center; gap: 2px; }
    .lang-link {
      color: var(--text-secondary); text-decoration: none; font-size: 14px; font-weight: 500;
      padding: 6px 8px; min-height: 36px; display: inline-flex; align-items: center;
    }
    .lang-link:hover { color: var(--text-primary); }
    .lang-link.active { color: var(--text-primary); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
    .portal-link {
      display: inline-flex; align-items: center; min-height: 36px; padding: 6px 12px;
      font-size: 14px; font-weight: 600; color: var(--accent-on); background: var(--accent);
      border-radius: var(--radius); text-decoration: none;
    }
    .portal-link:hover { background: var(--accent-hover); }
    .portal-link:active { transform: translateY(1px); }
    .github-link { display: flex; align-items: center; color: var(--text-secondary); padding: 8px; }
    .github-link:hover { color: var(--text-primary); }
    .mobile-menu-btn {
      display: none; background: none; border: none; cursor: pointer;
      color: var(--text-primary); padding: 8px; min-width: 40px; min-height: 40px;
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .section { padding: 56px 0; }
    .section-title {
      font-size: 22px; font-weight: 600; letter-spacing: -0.02em;
      line-height: 1.25; margin-bottom: 20px;
    }

    .hero { padding: 48px 0 8px; }
    .request {
      margin-top: 14px; max-width: 720px;
      font-family: var(--font-mono); font-size: 13px; line-height: 1.5;
      color: var(--text-secondary); overflow-x: auto; white-space: nowrap;
    }
    .request-method { color: var(--accent-text); font-weight: 500; margin-right: 8px; }
    .hero-links { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 12px; }
    .hero-links a { color: var(--accent-text); font-size: 14px; font-weight: 600; text-underline-offset: 3px; }
    .page-intro { padding: 48px 0 8px; }
    .page-intro h1 { font-size: clamp(32px, 4vw, 44px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 12px; max-width: 16em; }
    .page-intro p { color: var(--text-secondary); font-size: 17px; line-height: 1.6; max-width: 62ch; }
    .exhibit {
      display: grid; grid-template-columns: minmax(220px, 0.72fr) minmax(0, 1.28fr);
      gap: 20px 40px; align-items: start; padding: 32px 0; border-top: 1px solid var(--border);
    }
    .exhibit-copy h2 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; margin-bottom: 8px; }
    .exhibit-copy p { color: var(--text-secondary); font-size: 16px; line-height: 1.65; }
    .compare { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--border); background: var(--bg-surface); min-width: 0; }
    .compare-col { padding: 16px 18px 18px; min-width: 0; }
    .compare-col + .compare-col { border-left: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 55%, var(--bg-surface)); }
    .compare-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; }
    .compare-kicker, .compare-meta, .compare-note { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
    .compare-kicker { margin-bottom: 6px; }
    .compare h3 { font-size: 16px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.35; margin-bottom: 8px; }
    .compare-meta { margin-bottom: 12px; }
    .compare-note { margin-top: 10px; }
    .compare-block { margin-top: 10px; padding: 12px 14px; background: var(--bg-elevated); border: 1px solid var(--border); border-left: 2px solid var(--warning); font-size: 14px; line-height: 1.5; }
    .specimen-md { font-family: var(--font-mono); font-size: 12.5px; line-height: 1.65; color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
    .transcript p, .transcript li { font-size: 15px; line-height: 1.6; color: var(--text-secondary); }
    .transcript p { margin-bottom: 10px; }
    .transcript .who { font-weight: 600; color: var(--text-primary); margin-right: 6px; }
    .transcript .tool { font-family: var(--font-mono); font-size: 13px; line-height: 1.55; background: var(--bg-surface); border: 1px solid var(--border); padding: 10px 12px; margin: 0 0 12px; white-space: pre-wrap; color: var(--text-primary); }
    .transcript ol { margin: 0 0 10px 1.2em; }
    .paths { list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .paths a { display: block; padding: 16px 0; border-top: 1px solid var(--border); text-decoration: none; color: inherit; min-height: 100%; }
    .paths a:hover strong { color: var(--accent-text); }
    .paths strong { display: block; font-size: 16px; margin-bottom: 6px; }
    .paths span { color: var(--text-secondary); font-size: 14px; line-height: 1.5; }
    .more-links { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 8px; }
    .more-links a { color: var(--accent-text); font-weight: 600; text-underline-offset: 3px; }
    .spec-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.85fr); gap: 40px 56px; align-items: start; }
    .spec-block { margin-top: 40px; }
    .spec-block h2, .spec-grid h2 {
      font-size: 15px; font-weight: 600; margin-bottom: 8px;
    }
    .spec-lead { color: var(--text-secondary); font-size: 15px; line-height: 1.6; max-width: 68ch; margin-bottom: 12px; }
    .order { list-style: none; border-top: 1px solid var(--border); max-width: 720px; }
    .order li {
      display: grid; grid-template-columns: 14rem minmax(0, 1fr); gap: 12px 24px;
      padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 15px;
    }
    .order li span:last-child { color: var(--text-secondary); }
    .adapters { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 16px; max-width: 720px; }
    .adapters li { font-size: 14px; font-weight: 600; }
    .hero h1 {
      font-size: clamp(32px, 4vw, 44px); font-weight: 600;
      letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 12px;
      max-width: 14em; text-wrap: balance;
    }
    .nowrap { white-space: nowrap; }
    .hero-subtitle {
      font-size: 17px; color: var(--text-secondary); max-width: 62ch;
      margin: 0 0 28px; line-height: 1.6;
    }

    .input-wrapper {
      max-width: 720px; border-radius: var(--radius);
      background: var(--bg-surface); border: 1px solid var(--border);
    }
    .input-wrapper:focus-within { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
    .input-group { display: flex; width: 100%; align-items: stretch; }
    .input-prefix {
      display: flex; align-items: center; padding: 0 0 0 14px;
      color: var(--text-muted); font-family: var(--font-mono);
      font-size: 13px; white-space: nowrap; user-select: none;
    }
    .input-group input {
      flex: 1; padding: 12px; background: transparent; border: none;
      color: var(--text-primary); font-size: 15px; font-family: var(--font-mono);
      min-width: 0;
    }
    .input-group input:focus { outline: none; }
    .input-group input::placeholder { color: var(--text-muted); }
    .convert-btn {
      margin: 6px; padding: 0 18px; background: var(--accent); border: none;
      color: var(--accent-on); font-weight: 600; font-size: 15px;
      font-family: inherit; cursor: pointer; border-radius: var(--radius);
      min-height: 36px;
    }
    .convert-btn:hover { background: var(--accent-hover); }
    .convert-btn:active { transform: translateY(1px); }
    .convert-btn:disabled { opacity: 0.6; cursor: wait; }
    .btn-spinner {
      display: inline-block; width: 12px; height: 12px; margin-right: 6px;
      border: 2px solid color-mix(in srgb, var(--accent-on) 35%, transparent);
      border-top-color: var(--accent-on); border-radius: 50%;
      animation: spin 0.7s linear infinite; vertical-align: -1px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .input-hint { margin-top: 10px; font-size: 13px; color: var(--text-muted); font-family: var(--font-mono); }
    .form-error { margin-top: 8px; font-size: 14px; color: var(--danger); }
    .form-error[hidden] { display: none; }

    .faq-list { max-width: 720px; border-top: 1px solid var(--border); }
    .faq-item { border-bottom: 1px solid var(--border); }
    .faq-item summary {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 16px 0; cursor: pointer; font-size: 16px; font-weight: 600; list-style: none;
    }
    .faq-item summary::-webkit-details-marker { display: none; }
    .faq-item summary::after { content: "+"; font-weight: 500; color: var(--text-muted); }
    .faq-item[open] summary::after { content: "–"; }
    .faq-answer { padding: 0 0 16px; font-size: 15px; color: var(--text-secondary); line-height: 1.7; max-width: 65ch; }

    .cta-section { padding: 24px 0 72px; }
    .cta-title { font-size: clamp(28px, 4vw, 40px); font-weight: 600; letter-spacing: -0.03em; margin-bottom: 16px; }
    .example-link {
      display: inline-flex; align-items: center; min-height: 40px; padding: 8px 14px;
      background: var(--accent); color: var(--accent-on); text-decoration: none;
      font-weight: 600; font-size: 15px; border-radius: var(--radius);
    }
    .example-link:hover { background: var(--accent-hover); }
    .example-link:active { transform: translateY(1px); }

    .docs-section, .integration-section { max-width: 800px; margin: 0 auto; }
    .doc-card, .int-card, .decision-tree {
      padding: 8px 0 28px; margin-bottom: 8px; border-bottom: 1px solid var(--border);
      scroll-margin-top: 72px;
    }
    .doc-card h3, .int-card h3, .decision-tree h3 {
      font-size: 20px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 12px;
    }
    .copy-host { display: grid; justify-items: end; gap: 6px; margin-bottom: 10px; }
    .code-block, .cmd-block, .config-block {
      width: 100%;
      background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 14px; font-family: var(--font-mono); font-size: 12.5px;
      line-height: 1.7; color: var(--text-secondary); overflow-x: auto; margin: 0;
    }
    .code-block { white-space: pre-wrap; overflow-wrap: anywhere; }
    .cmd-block, .config-block { display: block; white-space: pre; color: var(--text-primary); }
    .code-block code { font-family: inherit; font-size: inherit; }
    .code-comment { color: var(--text-muted); }
    .code-hl { color: var(--accent-text); }
    .code-str { color: var(--text-primary); }
    .copy-inline {
      border: 1px solid var(--border); background: var(--bg); color: var(--text-primary);
      font-family: inherit; font-size: 13px; font-weight: 600;
      padding: 4px 8px; border-radius: var(--radius); cursor: pointer; min-height: 28px;
    }
    .copy-inline:hover { background: var(--bg-elevated); }
    .copy-inline:active { transform: translateY(1px); }
    .route-table, .param-table, .comp-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .route-table th, .param-table th, .comp-table th {
      text-align: left; padding: 8px 12px 8px 0; font-weight: 600; font-size: 13px;
      color: var(--text-secondary); border-bottom: 1px solid var(--border);
    }
    .route-table td, .param-table td, .comp-table td {
      padding: 10px 12px 10px 0; border-bottom: 1px solid var(--border);
      color: var(--text-secondary); vertical-align: top;
    }
    .route-table code, .param-table code, .auth-code {
      font-family: var(--font-mono); font-size: 12.5px; color: var(--accent-text);
      background: var(--accent-soft); padding: 1px 5px; border-radius: 3px;
    }
    .decision-item { font-size: 15px; color: var(--text-secondary); padding: 4px 0; line-height: 1.55; }
    .decision-item strong { color: var(--text-primary); font-weight: 600; }
    .int-card .for-line { font-size: 14px; color: var(--text-muted); margin-bottom: 8px; }
    .int-card p { font-size: 15px; color: var(--text-secondary); line-height: 1.65; margin-bottom: 14px; max-width: 65ch; }
    .cmd-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin: 14px 0 6px; }
    .int-note { font-size: 14px; color: var(--text-secondary); margin-top: 8px; }
    .accent-link { color: var(--accent-text); text-underline-offset: 3px; }
    .auth-line { font-size: 15px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 8px; }

    .site-footer { border-top: 1px solid var(--border); padding: 40px 0 24px; margin-top: 24px; }
    .footer-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-bottom: 32px; }
    .footer-col-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
    .footer-col a { display: block; font-size: 14px; color: var(--text-secondary); text-decoration: none; padding: 3px 0; }
    .footer-col a:hover { color: var(--text-primary); text-decoration: underline; text-underline-offset: 3px; }
    .footer-bottom {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding-top: 16px; border-top: 1px solid var(--border);
      font-size: 13px; color: var(--text-muted);
    }
    .theme-toggle { display: inline-flex; gap: 4px; }
    .theme-btn {
      background: none; border: 1px solid transparent; cursor: pointer;
      font-family: inherit; font-size: 13px; color: var(--text-secondary);
      padding: 4px 8px; border-radius: var(--radius); min-height: 32px;
    }
    .theme-btn:hover { color: var(--text-primary); }
    .theme-btn.active { color: var(--text-primary); border-color: var(--border); background: var(--bg-surface); font-weight: 600; }

    @media (max-width: 800px) {
      .container { padding: 0 16px; }
      .hero { padding-top: 32px; }
      .hero h1 { max-width: none; }
      .footer-grid, .spec-grid, .order li, .exhibit, .compare, .paths { grid-template-columns: 1fr; }
      .order li { gap: 2px; }
      .compare-col + .compare-col { border-left: 0; border-top: 1px solid var(--border); }
      .input-group { flex-direction: column; align-items: stretch; }
      .input-prefix { padding: 10px 12px 0; }
      .convert-btn { margin: 8px; }
      .github-link { display: none; }
      .site-name { min-width: 0; }
      .site-header { height: auto; }
      .header-inner { height: auto; flex-wrap: wrap; padding: 8px 12px; row-gap: 4px; }
      .header-right { margin-left: auto; gap: 2px; }
      .portal-link { font-size: 13px; padding: 6px 8px; }
      .lang-link { padding: 6px; }
      .header-nav { display: none; }
      .header-nav.open {
        display: flex; flex-direction: column; position: absolute;
        top: 100%; left: 0; right: 0; background: var(--bg);
        border-bottom: 1px solid var(--border); padding: 8px 12px 12px; z-index: 20;
      }
      .header-nav.open .tab-btn { width: 100%; text-align: left; min-height: 44px; }
      .mobile-menu-btn { display: inline-flex; align-items: center; justify-content: center; }
      .footer-bottom { flex-direction: column; align-items: flex-start; }
    }
  </style>

</head>
<body>
  <a class="skip" href="#content">${isZh ? "跳到内容" : "Skip to content"}</a>
  <header class="site-header" id="siteHeader">
    <div class="header-inner">
      <a href="${stay("/")}" class="site-name">${h}</a>
      <nav class="header-nav" id="headerNav" aria-label="${isZh ? "站点" : "Site"}">
        <a class="tab-btn ${page === "home" ? "active" : ""}" href="${stay("/")}">${t.tabHome}</a>
        <a class="tab-btn ${page === "examples" ? "active" : ""}" href="${stay("/examples")}">${isZh ? "示例" : "Examples"}</a>
        <a class="tab-btn ${page === "docs" ? "active" : ""}" href="${stay("/docs")}">${t.tabDocs}</a>
        <a class="tab-btn ${page === "integration" ? "active" : ""}" href="${stay("/integrations")}">${t.tabIntegration}</a>
      </nav>
      <div class="header-right">
        <a href="/portal/" class="portal-link">${t.portalLabel}</a>
        <nav class="lang-switch" aria-label="${t.langSwitchAria}">
          <a class="lang-link ${isZh ? "" : "active"}" href="${page === "home" ? "/?lang=en" : langHref(canonicalPath, "en")}">EN</a>
          <a class="lang-link ${isZh ? "active" : ""}" href="${page === "home" ? "/?lang=zh" : langHref(canonicalPath, "zh")}">中文</a>
        </nav>
        <a href="https://github.com/Digidai/website2markdown" target="_blank" class="github-link" aria-label="GitHub">${iconGithub}</a>
        <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Menu" aria-expanded="false" onclick="toggleMobileMenu()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
    </div>
  </header>

  <main id="content">
    <!-- ==================== TAB 1: HOME ==================== -->
    <!--PAGE:home-->
    <div class="tab-content ${page === "home" ? "active" : ""}" id="tab-home">

      <section class="hero">
        <div class="container">
          <h1>${t.heroTitleHtml}</h1>
          <p class="hero-subtitle" id="direct-answer">${t.heroSubtitle}</p>
          <div class="input-wrapper">
            <form class="input-group" id="urlForm" onsubmit="return handleSubmit(event)">
              <label for="urlInput" class="sr-only">${isZh ? "输入要转换的 URL" : "Enter URL to convert"}</label>
              <div class="input-prefix">${h}/</div>
              <input type="text" id="urlInput" name="url" inputmode="url" placeholder="${t.inputPlaceholder}" autocomplete="off" spellcheck="false" autofocus>
              <button type="submit" class="convert-btn">${t.convertButton}</button>
            </form>
          </div>
          <p class="form-error" id="formError" hidden></p>
          <p class="input-hint">${t.hintKeys}</p>
          <p class="request" id="requestPreview"><span class="request-method">GET</span><span id="requestUrl">https://${h}/https://example.com</span></p>
          <p class="hero-links">
            <a href="/https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/">${isZh ? "试一篇 Cloudflare 文档" : "Try a Cloudflare docs page"}</a>
            <a href="${stay("/examples")}">${isZh ? "看打不开的页面" : "See pages that block you"}</a>
            <a href="${stay("/docs")}">${isZh ? "接口文档" : "API reference"}</a>
          </p>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2 class="section-title">${isZh ? "打开链接时被拦住，返回的是正文" : "The link is blocked. The article comes back."}</h2>
          <p class="spec-lead">${isZh ? "这是微信公众号的常见情况。左边是人看到的，右边是同一次转换返回的 Markdown。" : "A WeChat article, as people usually meet it. Left is the page. Right is the Markdown from the same conversion."}</p>
          ${wechatProof}
          <p class="more-links">
            <a href="${stay("/examples")}#zhihu">${isZh ? "知乎登录墙" : "Zhihu login wall"}</a>
            <a href="${stay("/examples")}#agent">${isZh ? "Agent 调用" : "An agent calling it"}</a>
          </p>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2 class="section-title">${isZh ? "按你现在要做的事" : "Pick up where you are"}</h2>
          <ul class="paths">
            <li><a href="${stay("/")}"><strong>${isZh ? "手头有一个链接" : "You have a link"}</strong><span>${isZh ? "贴到上面。Markdown 会在下一页打开。" : "Paste it above. Markdown opens on the next page."}</span></a></li>
            <li><a href="${stay("/integrations")}"><strong>${isZh ? "Agent 要自己读网页" : "An agent should read the web"}</strong><span>${isZh ? "Skills、MCP，或让它读 llms.txt。" : "Skills, MCP, or point it at llms.txt."}</span></a></li>
            <li><a href="${stay("/docs")}"><strong>${isZh ? "要接进自己的流程" : "You are wiring a pipeline"}</strong><span>${isZh ? "批量、提取、任务和深爬在文档里。密钥在门户。" : "Batch, extract, jobs, and deep crawl are in the docs. Keys live in the portal."}</span></a></li>
          </ul>
        </div>
      </section>

      <section class="section" id="faq">
        <div class="container">
          <h2 class="section-title">${t.faqTitle}</h2>
          <div class="faq-list">
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

    </div>
    <!--/PAGE:home-->

    <!--PAGE:examples-->
    <div class="tab-content ${page === "examples" ? "active" : ""}" id="tab-examples">
      <section class="page-intro">
        <div class="container">
          <h1>${isZh ? "这些页面平时读不到" : "Pages that usually stop you"}</h1>
          <p>${isZh ? "左边是打开链接时看到的，右边是同一次转换返回的 Markdown。" : "Left is what the link shows a person. Right is the Markdown from that same conversion."}</p>
        </div>
      </section>
      <section class="section">
        <div class="container">
          <div id="wechat">${wechatProof}</div>
          <div id="zhihu">${zhihuProof}</div>
          <div id="agent">${agentProof}</div>
          <p class="more-links"><a href="${stay("/")}">${isZh ? "拿一个链接试" : "Try a link"}</a></p>
        </div>
      </section>
    </div>
    <!--/PAGE:examples-->

    <!--PAGE:docs-->
    <div class="tab-content ${page === "docs" ? "active" : ""}" id="tab-docs">
      <section class="section">
        <div class="docs-section">
          <div class="page-intro" style="padding-top:0">
            <h1>${isZh ? "接口" : "API"}</h1>
            <p>${isZh ? "在 URL 前加上本站域名就是一次转换。批量、提取、任务和深爬需要 API key。" : "Prepend this host to a URL to convert it. Batch, extract, jobs, and deep crawl need an API key."}</p>
          </div>
          <div class="doc-card" id="quickstart">
            <h3>${t.quickStartTitle}</h3>
            <div class="code-block"><code><span class="code-comment">${t.curlRawComment}</span>
curl -H "Accept: text/markdown" https://${h}/https://example.com</code></div>
            <div class="code-block"><code><span class="code-comment">${t.curlJsonComment}</span>
curl "https://${h}/https://example.com?raw=true&amp;format=json"</code></div>
            <div class="code-block"><code><span class="code-comment">${t.curlBatchComment}</span>
curl -X POST https://${h}/api/batch \\
  -H "Authorization: Bearer API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://example.com"]}'</code></div>
            <div class="code-block"><code><span class="code-comment">${t.curlExtract}</span>
curl -X POST https://${h}/api/extract \\
  -H "Authorization: Bearer API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"strategy":"css","url":"https://example.com","schema":{"fields":[{"name":"title","selector":"h1","type":"text","required":true}]}}'</code></div>
            <div class="code-block"><code><span class="code-comment">${t.curlCrawl}</span>
curl -X POST https://${h}/api/deepcrawl \\
  -H "Authorization: Bearer API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"seed":"https://example.com/docs","stream":true}'</code></div>
          </div>

          <div class="doc-card" id="routes">
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

          <div class="doc-card" id="params">
            <h3>${t.queryParamsTitle}</h3>
            <table class="param-table">
              <tbody>
                <tr><td><code>?raw=true</code></td><td>${t.rawDesc}</td></tr>
                <tr><td><code>?format=</code></td><td>${t.formatDesc} (<code>markdown</code> | <code>html</code> | <code>text</code> | <code>json</code>)</td></tr>
                <tr><td><code>?selector=.css</code></td><td>${t.selectorDesc}</td></tr>
                <tr><td><code>?force_browser=true</code></td><td>${t.forceBrowserDesc}</td></tr>
                <tr><td><code>?engine=jina|firecrawl|cf</code></td><td>${t.engineDesc}</td></tr>
                <tr><td><code>?no_cache=true</code></td><td>${t.noCacheDesc}</td></tr>
                <tr><td><code>?token=</code></td><td>${t.tokenDesc}</td></tr>
              </tbody>
            </table>
          </div>

          <div class="doc-card" id="auth">
            <h3>${t.authTitle}</h3>
            <p class="auth-line"><code class="auth-code">PUBLIC_API_TOKEN</code> ${t.publicAuthDesc}</p>
            <p class="auth-line"><code class="auth-code">API_TOKEN</code> ${t.privateAuthDesc}</p>
          </div>

          <div class="doc-card" id="headers">
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
    <!--/PAGE:docs-->

    <!--PAGE:integration-->
    <div class="tab-content ${page === "integration" ? "active" : ""}" id="tab-integration">
      <section class="section">
        <div class="integration-section">
          <div class="page-intro" style="padding-top:0">
            <h1>${isZh ? "接到 Agent" : "Connect an agent"}</h1>
            <p>${isZh ? "有终端用 Skills。在 IDE 里用 MCP。任何能打开网页的系统读 llms.txt。" : "A terminal gets Skills. An IDE gets MCP. Anything that can open a web page can read llms.txt."}</p>
          </div>

          <!-- Decision Tree -->
          <div class="decision-tree">
            <h3>${t.decisionTreeTitle}</h3>
            <p class="decision-item"><strong>${t.decisionSkills}</strong> ${t.decisionYes}</p>
            <p class="decision-item"><strong>${t.decisionNo}</strong></p>
            <p class="decision-item">${t.decisionAll}</p>
          </div>

          <!-- Agent Skills -->
          <div class="int-card" id="skills">
            <h3>${t.skillTitle}</h3>
            <div class="for-line">${t.skillFor}</div>
            <p>${t.skillDesc}</p>
            <div class="cmd-label">${t.skillClaudeCode}</div>
            <code class="cmd-block">${t.skillClaudeCmd}</code>
            <div class="cmd-label">${t.skillCodex}</div>
            <code class="cmd-block">${t.skillCodexCmd}</code>
            <div class="cmd-label">${t.skillGemini}</div>
            <code class="cmd-block">${t.skillGeminiCmd}</code>
            <div class="cmd-label">${t.skillOpenClaw}</div>
            <code class="cmd-block">${t.skillOpenClawCmd}</code>
            <div class="int-note">${t.skillNote}</div>
          </div>

          <!-- MCP Server -->
          <div class="int-card" id="mcp">
            <h3>${t.mcpTitle}</h3>
            <div class="for-line">${t.mcpFor}</div>
            <p>${t.mcpDesc}</p>
            <code class="cmd-block">${t.mcpCmd}</code>
            <div class="cmd-label">${t.mcpConfigTitle} (~/.claude/claude_desktop_config.json)</div>
            <code class="config-block">{
  <span class="code-hl">"mcpServers"</span>: {
    <span class="code-hl">"website2markdown"</span>: {
      <span class="code-hl">"command"</span>: <span class="code-str">"mcp-website2markdown"</span>,
      <span class="code-hl">"env"</span>: {
        <span class="code-hl">"WEBSITE2MARKDOWN_API_URL"</span>: <span class="code-str">"https://${h}"</span>
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
            <a href="/llms.txt" class="accent-link">https://${h}/llms.txt</a>
          </div>

          <!-- Comparison Table -->
          <div class="int-card">
            <h3>${t.comparisonTitle}</h3>
            <table class="comp-table">
              <thead>
                <tr><th></th><th>Skills</th><th>MCP</th><th>llms.txt</th></tr>
              </thead>
              <tbody>
                <tr><td>${t.compLatency}</td><td>${t.compLatencyHigh}</td><td>${t.compLatencyMid}</td><td>${t.compLatencyHigh}</td></tr>
                <tr><td>${t.compContext}</td><td>${t.compContextHigh}</td><td>${t.compContextLow}</td><td>${t.compContextMid}</td></tr>
                <tr><td>${t.compInstall}</td><td>${t.compSkillsInstall}</td><td>${t.compMcpInstall}</td><td>${t.compLlmsInstall}</td></tr>
                <tr><td>${t.compBestFor}</td><td>${t.compSkillsBest}</td><td>${t.compMcpBest}</td><td>${t.compLlmsBest}</td></tr>
              </tbody>
            </table>
          </div>

        </div>
      </section>
    </div>
    <!--/PAGE:integration-->
  </main>

  <!-- ===== FOOTER ===== -->
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-col">
          <div class="footer-col-title">${t.footerProduct}</div>
          <a href="${stay("/examples")}">${isZh ? "示例" : "Examples"}</a>
          <a href="${stay("/docs")}">${isZh ? "文档" : "Docs"}</a>
          <a href="${stay("/docs")}#params">${isZh ? "参数" : "Parameters"}</a>
          <a href="/api/health">Health</a>
        </div>
        <div class="footer-col">
          <div class="footer-col-title">${t.footerIntegration}</div>
          <a href="${stay("/integrations")}#skills">Agent Skills</a>
          <a href="${stay("/integrations")}#mcp">MCP</a>
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
        <span>&copy; <script>document.write(new Date().getFullYear())</script> Digidai</span>
        <div class="theme-toggle" id="themeToggle">
          <button class="theme-btn" data-theme="light" onclick="setTheme('light')">${t.footerThemeLight}</button>
          <button class="theme-btn" data-theme="dark" onclick="setTheme('dark')">${t.footerThemeDark}</button>
          <button class="theme-btn active" data-theme="system" onclick="setTheme('system')">${t.footerThemeSystem}</button>
        </div>
      </div>
    </div>
  </footer>

  ${page === "home" ? `<script type="application/ld+json">${schemaJson}</script>` : ""}
  <script>
    /* ---- Tab switching ---- */
    (function() {
      var hash = location.hash;
      var search = location.search || '';
      if (hash === '#docs') location.replace('/docs' + search);
      else if (hash === '#integration') location.replace('/integrations' + search);
    })();

    function toggleMobileMenu() {
      var nav = document.getElementById('headerNav');
      var btn = document.getElementById('mobileMenuBtn');
      if (nav) {
        nav.classList.toggle('open');
        if (btn) btn.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
      }
    }

    var urlInput = document.getElementById('urlInput');
    var requestUrl = document.getElementById('requestUrl');
    if (urlInput && requestUrl) {
      var requestBase = requestUrl.textContent.replace(/https:\/\/example\.com$/, '');
      function paintRequest() {
        var value = urlInput.value.trim() || 'https://example.com';
        requestUrl.textContent = requestBase + value;
      }
      urlInput.addEventListener('input', paintRequest);
    }

    /* ---- URL form submission ---- */
    function handleSubmit(e) {
      e.preventDefault();
      var input = document.getElementById('urlInput').value.trim();
      var err = document.getElementById('formError');
      if (!input) {
        if (err) {
          err.hidden = false;
          err.textContent = ${JSON.stringify(t.formError)};
        }
        document.getElementById('urlInput').focus();
        return false;
      }
      if (err) err.hidden = true;
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
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved);
      } else {
        // No valid stored preference — ensure "System" is highlighted
        localStorage.removeItem('theme');
        document.documentElement.removeAttribute('data-theme');
        document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.remove('active'); });
        var sysBtn = document.querySelector('.theme-btn[data-theme="system"]');
        if (sysBtn) sysBtn.classList.add('active');
      }
    })();

    document.querySelectorAll('.code-block, .cmd-block, .config-block').forEach(function(block) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-inline';
      btn.textContent = ${JSON.stringify(t.copyLabel)};
      btn.addEventListener('click', function() {
        var source = block.querySelector('code') || block;
        navigator.clipboard.writeText(source.innerText).then(function() {
          btn.textContent = ${JSON.stringify(t.copiedLabel)};
          setTimeout(function() { btn.textContent = ${JSON.stringify(t.copyLabel)}; }, 1600);
        }).catch(function() {
          btn.textContent = ${JSON.stringify(t.copyFailed)};
        });
      });
      var host = document.createElement('div');
      host.className = 'copy-host';
      block.parentNode.insertBefore(host, block);
      host.appendChild(btn);
      host.appendChild(block);
    });
  </script>
</body>
</html>`;
  return keepSitePage(html, page);
}

function keepSitePage(html: string, page: SitePage): string {
  const pages: SitePage[] = ["home", "examples", "docs", "integration"];
  let out = html;
  for (const name of pages) {
    if (name === page) continue;
    const start = `<!--PAGE:${name}-->`;
    const end = `<!--/PAGE:${name}-->`;
    const from = out.indexOf(start);
    const to = out.indexOf(end);
    if (from !== -1 && to > from) out = out.slice(0, from) + out.slice(to + end.length);
  }
  return out;
}
