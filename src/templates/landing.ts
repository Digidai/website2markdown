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
        badge: "Cloudflare Markdown for Agents",
        heroTitleHtml: "任意 URL 转 <em>Markdown</em>，<br>即刻完成",
        subtitleHtml: `在任意 URL 前加上 <strong>${h}/</strong>。<br>为 AI Agent、LLM 与开发者提供干净可读的 Markdown。`,
        inputPlaceholder: "粘贴任意 URL...",
        convertButton: "转换",
        convertingButton: "转换中",
        inputHintLead: "支持裸域名、http:// 与 https://",
        feature1Label: "01 &mdash; 通用",
        feature1Title: "任意网站",
        feature1Desc: "四条转换路径：原生边缘 Markdown、Readability 提取、无头浏览器渲染，或 Jina Reader API。",
        feature2Label: "02 &mdash; API 优先",
        feature2Title: "多种格式",
        feature2Desc: "支持输出 <code>markdown</code>、<code>html</code>、<code>text</code>、<code>json</code>，并可用 CSS 选择器定向提取。",
        feature3Label: "03 &mdash; 工作流",
        feature3Title: "批量、提取、深爬",
        feature3Desc: "使用 <code>/api/batch</code>、<code>/api/extract</code>、<code>/api/jobs</code>、<code>/api/deepcrawl</code> 处理大规模转换与结构化采集。",
        howTitle: "工作原理",
        step1Title: "URL 前缀",
        step1Desc: `在任意网页地址前加上 <strong>${h}/</strong>。`,
        step2Title: "边缘抓取",
        step2Desc: "请求会在 Cloudflare 边缘完成校验、可选鉴权与抓取，并按原生 / Readability / 浏览器 / Jina 路径执行。",
        step3Title: "干净输出",
        step3Desc: "返回渲染预览、原始 Markdown、JSON，或通过 SSE / 批量 / 提取 / 任务 / 深爬 API 继续处理。",
        apiTitle: "API 参考",
        apiGetDesc: "将单个 URL 转为 Markdown",
        queryParams: "查询参数：",
        rawDesc: "返回原始 Markdown（不包裹 HTML）",
        formatDesc: "输出格式",
        selectorDesc: "仅提取匹配的 CSS 选择器",
        forceBrowserDesc: "强制使用无头浏览器渲染",
        engineDesc: "使用 Jina Reader API 转换",
        noCacheDesc: "绕过缓存，抓取最新内容",
        tokenDesc: "若启用 PUBLIC_API_TOKEN，使用查询 token 访问受保护的公开转换接口",
        routeSummary: "主要路由：",
        streamDesc: "单 URL SSE 转换进度（step / done / fail）",
        extractDesc: "结构化提取（css / xpath / regex，可附带 markdown）",
        jobsDesc: "任务创建、查询、状态流与执行（支持 Idempotency-Key）",
        deepcrawlDesc: "BFS / BestFirst 深爬，支持过滤、打分、checkpoint",
        healthDesc: "健康检查、运行态与运营指标",
        ogDesc: "分享图生成端点",
        authTitle: "鉴权：",
        publicAuthDesc: "单 URL 转换与 <code>/api/stream</code> 可使用 Bearer 或 <code>?token=...</code>",
        privateAuthDesc: "<code>/api/batch</code>、<code>/api/extract</code>、<code>/api/jobs*</code>、<code>/api/deepcrawl</code> 需要 <code>API_TOKEN</code>",
        responseHeaders: "响应头：",
        sourceUrlDesc: "原始目标 URL",
        batchDesc: "最多转换 10 个 URL（需要 <code>API_TOKEN</code>）",
        bodyLabel: "请求体",
        returnsLabel: "返回",
        curlExamples: "curl 示例：",
        curlRaw: "# 获取原始 markdown",
        curlJson: "# 获取 JSON 输出",
        curlBatch: "# 批量转换",
        curlExtract: "# 结构化提取",
        curlCrawl: "# Deep Crawl",
        exampleLabel: "试一个示例",
        footerLead: "基于 Cloudflare Workers 构建",
        mobilePlaceholder: "https://example.com/article",
        integrationTitle: "AI Agent 集成",
        integrationSubtitle: "有终端的 Agent 用 Skills，无终端的用 MCP，所有 AI 都能发现 llms.txt",
        skillTitle: "Agent Skills",
        skillDesc: "一条命令安装，Agent 自动发现。包含完整使用模式、错误处理和 21 个平台适配器指南。",
        skillClaudeCode: "Claude Code",
        skillClaudeCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.claude/skills/website2markdown",
        skillOpenClaw: "OpenClaw",
        skillOpenClawCmd: "npx clawhub@latest install website2markdown",
        skillNote: "安装后在新会话中自动可用，无需额外配置",
        mcpTitle: "MCP Server",
        mcpDesc: "适用于没有终端访问的客户端：Claude Desktop、Cursor IDE、Windsurf。标准 MCP 协议，提供 <code>convert_url</code> 工具。",
        mcpCmd: "npm install -g @digidai/mcp-website2markdown",
        llmsTxtTitle: "llms.txt",
        llmsTxtDesc: "遵循 <a href='https://llmstxt.org' target='_blank' style='color:var(--accent)'>llms.txt 标准</a>的机器可读 API 描述。AI 系统访问此端点即可了解所有能力。",
        llmsTxtUrl: "/llms.txt",
        llmsTxtRouteDesc: "AI 可读的 API 描述（llms.txt 标准）",
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
        badge: "Cloudflare Markdown for Agents",
        heroTitleHtml: "Any URL to <em>Markdown</em>,<br>instantly",
        subtitleHtml: `Prepend <strong>${h}/</strong> before any URL.<br>Clean, readable Markdown for AI agents, LLMs, and developers.`,
        inputPlaceholder: "paste any url...",
        convertButton: "Convert",
        convertingButton: "Converting",
        inputHintLead: "Bare domains, http:// and https:// all work",
        feature1Label: "01 &mdash; Universal",
        feature1Title: "Any Website",
        feature1Desc: "Four conversion paths: native edge Markdown, Readability extraction, headless browser rendering, or Jina Reader API.",
        feature2Label: "02 &mdash; API-first",
        feature2Title: "Multiple Formats",
        feature2Desc: "Output as <code>markdown</code>, <code>html</code>, <code>text</code>, or <code>json</code>. Specify CSS selectors for targeted extraction.",
        feature3Label: "03 &mdash; Workflows",
        feature3Title: "Batch, Extract, Crawl",
        feature3Desc: "Use <code>/api/batch</code>, <code>/api/extract</code>, <code>/api/jobs</code>, and <code>/api/deepcrawl</code> for larger conversion and structured collection workflows.",
        howTitle: "How it works",
        step1Title: "Prepend URL",
        step1Desc: `Add <strong>${h}/</strong> before any web address.`,
        step2Title: "Edge Fetch",
        step2Desc: "Requests are validated, optionally authenticated, and fetched at the edge through the native / Readability / browser / Jina pipeline.",
        step3Title: "Clean Output",
        step3Desc: "Receive rendered preview, raw Markdown, JSON, or continue with SSE, batch, extraction, jobs, and deep crawl APIs.",
        apiTitle: "API Reference",
        apiGetDesc: "Convert a single URL to Markdown",
        queryParams: "Query Parameters:",
        rawDesc: "Return raw Markdown (no HTML wrapper)",
        formatDesc: "Output format",
        selectorDesc: "Extract only matching CSS selector",
        forceBrowserDesc: "Force headless browser rendering",
        engineDesc: "Convert via Jina Reader API",
        noCacheDesc: "Bypass cache, fetch fresh content",
        tokenDesc: "Query token for protected public convert routes when PUBLIC_API_TOKEN is enabled",
        routeSummary: "Key Routes:",
        streamDesc: "SSE progress for single-URL conversion (step / done / fail)",
        extractDesc: "Structured extraction (css / xpath / regex, optional markdown)",
        jobsDesc: "Create, query, stream, and run jobs (supports Idempotency-Key)",
        deepcrawlDesc: "BFS / BestFirst deep crawl with filters, scoring, and checkpoints",
        healthDesc: "Health check, runtime state, and operational metrics",
        ogDesc: "Share-image generator endpoint",
        authTitle: "Auth:",
        publicAuthDesc: "Single-URL convert and <code>/api/stream</code> accept Bearer or <code>?token=...</code>",
        privateAuthDesc: "<code>/api/batch</code>, <code>/api/extract</code>, <code>/api/jobs*</code>, and <code>/api/deepcrawl</code> require <code>API_TOKEN</code>",
        responseHeaders: "Response Headers:",
        sourceUrlDesc: "The original target URL",
        batchDesc: "Convert up to 10 URLs (requires <code>API_TOKEN</code>)",
        bodyLabel: "Body",
        returnsLabel: "Returns",
        curlExamples: "curl Examples:",
        curlRaw: "# Get raw markdown",
        curlJson: "# Get JSON output",
        curlBatch: "# Batch conversion",
        curlExtract: "# Structured extraction",
        curlCrawl: "# Deep crawl",
        exampleLabel: "Try an example",
        footerLead: "Built on Cloudflare Workers",
        mobilePlaceholder: "https://example.com/article",
        integrationTitle: "AI Agent Integration",
        integrationSubtitle: "Agents with a terminal use Skills. Agents without use MCP. All AI can discover llms.txt.",
        skillTitle: "Agent Skills",
        skillDesc: "One command to install, auto-discovered by your agent. Includes full usage patterns, error handling, and guides for all 21 platform adapters.",
        skillClaudeCode: "Claude Code",
        skillClaudeCmd: "git clone https://github.com/Digidai/website2markdown-skills ~/.claude/skills/website2markdown",
        skillOpenClaw: "OpenClaw",
        skillOpenClawCmd: "npx clawhub@latest install website2markdown",
        skillNote: "Auto-available in new sessions — no extra configuration needed",
        mcpTitle: "MCP Server",
        mcpDesc: "For clients without terminal access: Claude Desktop, Cursor IDE, Windsurf. Standard MCP protocol with <code>convert_url</code> tool.",
        mcpCmd: "npm install -g @digidai/mcp-website2markdown",
        llmsTxtTitle: "llms.txt",
        llmsTxtDesc: "Machine-readable API description following the <a href='https://llmstxt.org' target='_blank' style='color:var(--accent)'>llms.txt standard</a>. Any AI system can discover all capabilities from this endpoint.",
        llmsTxtUrl: "/llms.txt",
        llmsTxtRouteDesc: "AI-readable API description (llms.txt standard)",
      };
  const schemaJson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: host,
    description: t.schemaDescription,
    url: `https://${host}/`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${h} - ${t.pageTitle}</title>
  <meta name="description" content="${t.metaDescription}">
  <link rel="canonical" href="https://${h}/">
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
    :root {
      --bg-deep: #07080c;
      --bg-surface: #111318;
      --bg-elevated: #191b22;
      --border: #23252f;
      --border-subtle: #1a1c26;
      --text-primary: #eeeef2;
      --text-secondary: #8b8da3;
      --text-muted: #555770;
      --accent: #22d3ee;
      --accent-hover: #06b6d4;
      --font-display: 'Instrument Serif', Georgia, serif;
      --font-body: 'DM Sans', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-body);
      background: var(--bg-deep);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    body::after {
      content: '';
      position: fixed;
      inset: 0;
      opacity: 0.025;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      pointer-events: none;
      z-index: 9999;
    }

    .bg-glow { position: fixed; inset: 0; overflow: hidden; z-index: 0; pointer-events: none; }
    .bg-glow::before {
      content: ''; position: absolute; width: 700px; height: 700px; border-radius: 50%;
      background: radial-gradient(circle, rgba(34,211,238,0.07) 0%, transparent 70%);
      top: -250px; right: -150px; animation: drift 22s ease-in-out infinite;
    }
    .bg-glow::after {
      content: ''; position: absolute; width: 500px; height: 500px; border-radius: 50%;
      background: radial-gradient(circle, rgba(34,211,238,0.04) 0%, transparent 70%);
      bottom: -150px; left: -100px; animation: drift 28s ease-in-out infinite reverse;
    }

    @keyframes drift {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(40px, -30px) scale(1.05); }
      66% { transform: translate(-25px, 20px) scale(0.95); }
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(28px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .hero {
      position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 3rem 2rem 2rem; text-align: center;
    }

    .lang-switch {
      position: absolute; top: 1.2rem; right: 1.2rem; display: inline-flex; gap: 0.35rem;
      padding: 0.25rem; background: rgba(17,19,24,0.72); border: 1px solid var(--border);
      border-radius: 999px; backdrop-filter: blur(8px); animation: fadeUp 0.6s ease both;
    }
    .lang-link {
      color: var(--text-secondary); text-decoration: none; font-size: 0.75rem; font-weight: 500;
      letter-spacing: 0.02em; padding: 0.38rem 0.72rem; border-radius: 999px; transition: all 0.2s ease;
    }
    .lang-link:hover { color: var(--text-primary); background: rgba(255,255,255,0.04); }
    .lang-link.active { color: var(--bg-deep); background: var(--accent); }

    .badge {
      display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.35rem 1rem;
      background: rgba(34,211,238,0.06); border: 1px solid rgba(34,211,238,0.12);
      border-radius: 999px; font-size: 0.75rem; font-weight: 500; color: var(--accent);
      letter-spacing: 0.03em; margin-bottom: 2.5rem; animation: fadeUp 0.6s ease both;
    }

    h1 {
      font-family: var(--font-display); font-size: clamp(3rem, 7vw, 5.5rem); font-weight: 400;
      font-style: italic; letter-spacing: -0.02em; line-height: 1.05; margin-bottom: 1.5rem;
      color: var(--text-primary); animation: fadeUp 0.6s ease 0.08s both;
    }

    h1 em {
      font-style: normal;
      background: linear-gradient(135deg, var(--accent) 0%, #67e8f9 50%, var(--accent-hover) 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }

    .subtitle {
      font-size: 1.1rem; color: var(--text-secondary); max-width: 520px; line-height: 1.7;
      margin-bottom: 3rem; font-weight: 300; animation: fadeUp 0.6s ease 0.16s both;
    }
    .subtitle strong { color: var(--text-primary); font-weight: 500; }

    .input-wrapper {
      position: relative; width: 100%; max-width: 680px; border-radius: 14px; padding: 1px;
      background: var(--border); transition: box-shadow 0.4s ease; animation: fadeUp 0.6s ease 0.24s both;
    }

    .input-wrapper:focus-within {
      background: linear-gradient(135deg, var(--accent), var(--accent-hover), #67e8f9, var(--accent));
      background-size: 300% 300%;
      animation: fadeUp 0.6s ease 0.24s both, shimmer 4s ease infinite;
      box-shadow: 0 0 40px rgba(34,211,238,0.1), 0 0 80px rgba(34,211,238,0.04);
    }

    @keyframes shimmer { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }

    .input-group {
      display: flex; width: 100%; background: var(--bg-surface); border-radius: 13px; overflow: hidden;
    }

    .input-prefix {
      display: flex; align-items: center; padding: 0 0 0 1.25rem; color: var(--accent);
      font-family: var(--font-mono); font-size: 0.82rem; font-weight: 500;
      white-space: nowrap; user-select: none; opacity: 0.7;
    }

    .input-group input {
      flex: 1; padding: 1.1rem 1rem; background: transparent; border: none; outline: none;
      color: var(--text-primary); font-size: 0.9rem; font-family: var(--font-mono); font-weight: 400;
    }
    .input-group input::placeholder { color: var(--text-muted); font-weight: 400; }

    .input-group button {
      padding: 0 1.75rem; background: var(--accent); border: none; color: var(--bg-deep);
      font-weight: 600; font-size: 0.85rem; font-family: var(--font-body); cursor: pointer;
      transition: background 0.2s ease; letter-spacing: 0.01em;
    }
    .input-group button:hover { background: var(--accent-hover); }
    .input-group button:disabled { opacity: .7; cursor: wait; }
    .btn-spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(7,8,12,.3); border-top-color: var(--bg-deep);
      border-radius: 50%; animation: spin .6s linear infinite; vertical-align: middle; margin-right: .3rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .input-hint {
      margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-muted);
      letter-spacing: 0.01em; animation: fadeUp 0.6s ease 0.28s both;
    }

    .features {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; width: 100%;
      max-width: 840px; margin-top: 5rem; background: var(--border-subtle);
      border-radius: 16px; overflow: hidden; border: 1px solid var(--border-subtle);
      animation: fadeUp 0.6s ease 0.36s both;
    }

    .feature {
      padding: 2rem 1.75rem; background: var(--bg-surface); transition: background 0.3s ease;
    }
    .feature:hover { background: var(--bg-elevated); }

    .feature-label {
      font-family: var(--font-mono); font-size: 0.65rem; font-weight: 500; color: var(--accent);
      text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 0.85rem; opacity: 0.7;
    }

    .feature h3 { font-family: var(--font-display); font-size: 1.2rem; font-weight: 400; color: var(--text-primary); margin-bottom: 0.5rem; }
    .feature p { font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6; font-weight: 300; }
    .feature code { font-family: var(--font-mono); font-size: 0.75rem; background: rgba(34,211,238,0.08); padding: 0.12rem 0.35rem; border-radius: 4px; color: var(--accent); }

    .how-section { width: 100%; max-width: 840px; margin-top: 5rem; animation: fadeUp 0.6s ease 0.44s both; }
    .how-section h2 { font-family: var(--font-display); font-size: 2rem; font-weight: 400; font-style: italic; text-align: center; margin-bottom: 2.5rem; color: var(--text-primary); }

    .steps { display: flex; gap: 1px; background: var(--border-subtle); border-radius: 16px; overflow: hidden; border: 1px solid var(--border-subtle); }
    .step { flex: 1; padding: 2rem 1.5rem; background: var(--bg-surface); text-align: center; }
    .step-num { font-family: var(--font-display); font-size: 2rem; font-style: italic; color: var(--accent); opacity: 0.5; margin-bottom: 0.75rem; line-height: 1; }
    .step h3 { font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary); }
    .step p { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6; font-weight: 300; }
    .step code { font-family: var(--font-mono); font-size: 0.72rem; background: rgba(34,211,238,0.08); padding: 0.1rem 0.35rem; border-radius: 4px; color: var(--accent); }

    .example-box { margin-top: 3.5rem; width: 100%; max-width: 840px; animation: fadeUp 0.6s ease 0.5s both; }
    .example-label { font-family: var(--font-mono); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin-bottom: 0.6rem; }
    .example-url { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary); padding: 1rem 1.25rem; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 10px; overflow-x: auto; cursor: pointer; transition: all 0.2s ease; }
    .example-url:hover { background: var(--bg-elevated); border-color: var(--border); color: var(--text-primary); }
    .example-url .hl { color: var(--accent); }

    footer { position: relative; z-index: 1; text-align: center; padding: 3rem 2rem; color: var(--text-muted); font-size: 0.75rem; letter-spacing: 0.01em; }
    footer a { color: var(--text-secondary); text-decoration: none; transition: color 0.2s; }
    footer a:hover { color: var(--accent); }

    @media (max-width: 768px) {
      .features { grid-template-columns: 1fr; }
      .steps { flex-direction: column; }
      .input-prefix { display: none; }
      .input-group input { padding: 1rem; }
      .hero { padding: 2rem 1.25rem 1.5rem; }
      .lang-switch { top: 1rem; right: 1rem; }
    }
  </style>
</head>
<body>
  <div class="bg-glow"></div>

  <div class="hero">
    <nav class="lang-switch" aria-label="${t.langSwitchAria}">
      <a class="lang-link ${isZh ? "" : "active"}" href="/?lang=en">EN</a>
      <a class="lang-link ${isZh ? "active" : ""}" href="/?lang=zh">中文</a>
    </nav>

    <div class="badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      ${t.badge}
    </div>

    <h1>${t.heroTitleHtml}</h1>

    <p class="subtitle">${t.subtitleHtml}</p>

    <div class="input-wrapper">
      <form class="input-group" id="urlForm" onsubmit="return handleSubmit(event)">
        <div class="input-prefix">${h}/</div>
        <input type="text" id="urlInput" placeholder="${t.inputPlaceholder}" autocomplete="off" autofocus />
        <button type="submit">${t.convertButton}</button>
      </form>
    </div>
    <p class="input-hint">${t.inputHintLead} &mdash; <code>?format=json|html|text</code> &middot; <code>?selector=.css</code> &middot; <code>?raw=true</code> &middot; <code>?force_browser=true</code> &middot; <code>?engine=jina</code> &middot; <code>?no_cache=true</code> &middot; <code>?token=PUBLIC_API_TOKEN</code></p>

    <div class="features">
      <div class="feature">
        <div class="feature-label">${t.feature1Label}</div>
        <h3>${t.feature1Title}</h3>
        <p>${t.feature1Desc}</p>
      </div>
      <div class="feature">
        <div class="feature-label">${t.feature2Label}</div>
        <h3>${t.feature2Title}</h3>
        <p>${t.feature2Desc}</p>
      </div>
      <div class="feature">
        <div class="feature-label">${t.feature3Label}</div>
        <h3>${t.feature3Title}</h3>
        <p>${t.feature3Desc}</p>
      </div>
    </div>

    <div class="how-section">
      <h2>${t.howTitle}</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">i</div>
          <h3>${t.step1Title}</h3>
          <p>${t.step1Desc}</p>
        </div>
        <div class="step">
          <div class="step-num">ii</div>
          <h3>${t.step2Title}</h3>
          <p>${t.step2Desc}</p>
        </div>
        <div class="step">
          <div class="step-num">iii</div>
          <h3>${t.step3Title}</h3>
          <p>${t.step3Desc}</p>
        </div>
      </div>
    </div>

    <div class="how-section" style="margin-top:3.5rem">
      <h2>${t.integrationTitle}</h2>
      <p style="text-align:center;color:var(--text-secondary);font-size:0.85rem;margin-bottom:2rem;font-weight:300">${t.integrationSubtitle}</p>
      <div class="features">
        <div class="feature">
          <div class="feature-label">01 &mdash; Skills</div>
          <h3>${t.skillTitle}</h3>
          <p>${t.skillDesc}</p>
          <div style="margin-top:1.2rem">
            <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:0.25rem;font-family:var(--font-mono)">${t.skillClaudeCode}</div>
            <code style="font-family:var(--font-mono);font-size:0.64rem;display:block;padding:0.5rem 0.7rem;background:rgba(34,211,238,0.06);border-radius:6px;color:var(--accent);word-break:break-all;line-height:1.5">${t.skillClaudeCmd}</code>
            <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.6rem;margin-bottom:0.25rem;font-family:var(--font-mono)">${t.skillOpenClaw}</div>
            <code style="font-family:var(--font-mono);font-size:0.64rem;display:block;padding:0.5rem 0.7rem;background:rgba(34,211,238,0.06);border-radius:6px;color:var(--accent);word-break:break-all;line-height:1.5">${t.skillOpenClawCmd}</code>
          </div>
          <p style="margin-top:0.75rem;font-size:0.72rem;color:var(--text-muted);font-style:italic">${t.skillNote}</p>
        </div>
        <div class="feature">
          <div class="feature-label">02 &mdash; MCP</div>
          <h3>${t.mcpTitle}</h3>
          <p>${t.mcpDesc}</p>
          <div style="margin-top:1.2rem">
            <code style="font-family:var(--font-mono);font-size:0.64rem;display:block;padding:0.5rem 0.7rem;background:rgba(34,211,238,0.06);border-radius:6px;color:var(--accent);word-break:break-all;line-height:1.5">${t.mcpCmd}</code>
          </div>
        </div>
        <div class="feature">
          <div class="feature-label">03 &mdash; Discovery</div>
          <h3>${t.llmsTxtTitle}</h3>
          <p>${t.llmsTxtDesc}</p>
          <div style="margin-top:1.2rem">
            <a href="${t.llmsTxtUrl}" style="font-family:var(--font-mono);font-size:0.72rem;display:inline-flex;align-items:center;gap:0.4rem;padding:0.5rem 0.8rem;background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.15);border-radius:6px;color:var(--accent);text-decoration:none;transition:all 0.2s">${h}${t.llmsTxtUrl} &rarr;</a>
          </div>
        </div>
      </div>
    </div>

    <div class="how-section" style="margin-top:3.5rem">
      <h2>${t.apiTitle}</h2>
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:16px;padding:2rem 1.75rem;font-size:0.82rem;line-height:1.8;color:var(--text-secondary)">
        <div style="margin-bottom:1rem"><strong style="color:var(--text-primary)">GET /{url}</strong> &mdash; ${t.apiGetDesc}</div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">${t.queryParams}</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1rem">
          <code>?raw=true</code> &mdash; ${t.rawDesc}<br>
          <code>?format=</code><code>markdown</code>|<code>html</code>|<code>text</code>|<code>json</code> &mdash; ${t.formatDesc}<br>
          <code>?selector=.article</code> &mdash; ${t.selectorDesc}<br>
          <code>?force_browser=true</code> &mdash; ${t.forceBrowserDesc}<br>
          <code>?engine=jina</code> &mdash; ${t.engineDesc}<br>
          <code>?no_cache=true</code> &mdash; ${t.noCacheDesc}<br>
          <code>?token=PUBLIC_API_TOKEN</code> &mdash; ${t.tokenDesc}
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">${t.routeSummary}</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1rem">
          <code>GET /api/stream</code> &mdash; ${t.streamDesc}<br>
          <code>POST /api/batch</code> &mdash; ${t.batchDesc}<br>
          <code>POST /api/extract</code> &mdash; ${t.extractDesc}<br>
          <code>POST /api/jobs</code> / <code>GET /api/jobs/:id</code> / <code>GET /api/jobs/:id/stream</code> / <code>POST /api/jobs/:id/run</code> &mdash; ${t.jobsDesc}<br>
          <code>POST /api/deepcrawl</code> &mdash; ${t.deepcrawlDesc}<br>
          <code>GET /llms.txt</code> &mdash; ${t.llmsTxtRouteDesc}<br>
          <code>GET /api/health</code> &mdash; ${t.healthDesc}<br>
          <code>GET /api/og</code> &mdash; ${t.ogDesc}
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">${t.authTitle}</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1rem">
          <code>PUBLIC_API_TOKEN</code> &mdash; ${t.publicAuthDesc}<br>
          <code>API_TOKEN</code> &mdash; ${t.privateAuthDesc}
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">${t.responseHeaders}</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1rem">
          <code>X-Markdown-Method</code> &mdash; native | readability+turndown | browser+readability+turndown | jina<br>
          <code>X-Cache-Status</code> &mdash; HIT | MISS<br>
          <code>X-Source-URL</code> &mdash; ${t.sourceUrlDesc}
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">POST /api/batch</strong> &mdash; ${t.batchDesc}</div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1.5rem">
          ${t.bodyLabel}: <code>{"urls": ["https://...", "https://..."]}</code><br>
          ${t.returnsLabel}: <code>{"results": [{url, markdown, title, method}, ...]}</code>
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">${t.curlExamples}</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.72rem;line-height:2;color:var(--text-muted)">
          <code style="display:block;margin-bottom:0.4rem">${t.curlRaw}</code>
          <code style="display:block;margin-bottom:0.75rem">curl -H "Accept: text/markdown" https://${h}/https://example.com</code>
          <code style="display:block;margin-bottom:0.4rem">${t.curlJson}</code>
          <code style="display:block;margin-bottom:0.75rem">curl "https://${h}/https://example.com?raw=true&amp;format=json"</code>
          <code style="display:block;margin-bottom:0.4rem">${t.curlBatch}</code>
          <code style="display:block;margin-bottom:0.75rem">curl -X POST https://${h}/api/batch -H "Authorization: Bearer API_TOKEN" -H "Content-Type: application/json" -d '{"urls":["https://example.com"]}'</code>
          <code style="display:block;margin-bottom:0.4rem">${t.curlExtract}</code>
          <code style="display:block;margin-bottom:0.75rem">curl -X POST https://${h}/api/extract -H "Authorization: Bearer API_TOKEN" -H "Content-Type: application/json" -d '{"strategy":"css","url":"https://example.com","schema":{"fields":[{"name":"title","selector":"h1","type":"text","required":true}]}}'</code>
          <code style="display:block;margin-bottom:0.4rem">${t.curlCrawl}</code>
          <code style="display:block">curl -X POST https://${h}/api/deepcrawl -H "Authorization: Bearer API_TOKEN" -H "Content-Type: application/json" -d '{"seed":"https://example.com/docs","stream":true}'</code>
        </div>
      </div>
    </div>

    <div class="example-box">
      <div class="example-label">${t.exampleLabel}</div>
      <div class="example-url" onclick="window.location.href='/https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/'">
        <span class="hl">${h}/</span>https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
      </div>
    </div>
  </div>

  <footer>
    ${t.footerLead} &mdash;
    <a href="https://github.com/Digidai/website2markdown" target="_blank">GitHub</a> &middot;
    <a href="https://www.npmjs.com/package/@digidai/mcp-website2markdown" target="_blank">npm</a> &middot;
    <a href="https://github.com/Digidai/website2markdown-skills" target="_blank">Skills</a> &middot;
    <a href="/llms.txt">llms.txt</a>
  </footer>

  <script type="application/ld+json">${schemaJson}</script>
  <script>
    function handleSubmit(e) {
      e.preventDefault();
      var input = document.getElementById('urlInput').value.trim();
      if (!input) return false;
      var btn = e.target.querySelector('button');
      var inp = document.getElementById('urlInput');
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span>${t.convertingButton}';
      inp.disabled = true;
      window.location.href = '/' + input;
      return false;
    }
    // Restore button state when page is loaded from bfcache (back/forward navigation)
    window.addEventListener('pageshow', function(e) {
      if (e.persisted) {
        var btn = document.querySelector('#urlForm button');
        var inp = document.getElementById('urlInput');
        if (btn) { btn.disabled = false; btn.textContent = ${JSON.stringify(t.convertButton)}; }
        if (inp) inp.disabled = false;
      }
    });
    // On mobile, prefix is hidden — update placeholder to show full URL hint
    if (window.matchMedia('(max-width: 768px)').matches) {
      document.getElementById('urlInput').placeholder = ${JSON.stringify(t.mobilePlaceholder)};
    }
  </script>
</body>
</html>`;
}
