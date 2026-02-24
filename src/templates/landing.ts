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
          "把任意网页转换为干净、可读的 Markdown。支持三条转换路径：原生边缘 Markdown、Readability + Turndown，以及无头浏览器渲染。适用于 AI Agent、LLM 和开发者。",
        shareDescription: `在任意 URL 前加上 ${h}/，即可快速获得干净、可读的 Markdown。基于 Cloudflare Workers。`,
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
        feature1Desc: "三条转换路径：原生边缘 Markdown、Readability 提取，或无头浏览器渲染。",
        feature2Label: "02 &mdash; API 优先",
        feature2Title: "多种格式",
        feature2Desc: "支持输出 <code>markdown</code>、<code>html</code>、<code>text</code>、<code>json</code>，并可用 CSS 选择器定向提取。",
        feature3Label: "03 &mdash; 已缓存",
        feature3Title: "响应更快",
        feature3Desc: "结果缓存到 KV，重复访问更快；图片存入 R2，交付更稳定。",
        howTitle: "工作原理",
        step1Title: "URL 前缀",
        step1Desc: `在任意网页地址前加上 <strong>${h}/</strong>。`,
        step2Title: "边缘抓取",
        step2Desc: "请求会携带 <code>Accept: text/markdown</code> 并通过 Cloudflare 边缘网络发出。",
        step3Title: "干净输出",
        step3Desc: "返回格式化 Markdown，可渲染预览，也可通过 API 获取原始文本。",
        apiTitle: "API 参考",
        apiGetDesc: "将单个 URL 转为 Markdown",
        queryParams: "查询参数：",
        rawDesc: "返回原始 Markdown（不包裹 HTML）",
        formatDesc: "输出格式",
        selectorDesc: "仅提取匹配的 CSS 选择器",
        forceBrowserDesc: "强制使用无头浏览器渲染",
        noCacheDesc: "绕过缓存，抓取最新内容",
        responseHeaders: "响应头：",
        sourceUrlDesc: "原始目标 URL",
        batchDesc: "最多转换 10 个 URL（需要 <code>Authorization: Bearer &lt;token&gt;</code>）",
        bodyLabel: "请求体",
        returnsLabel: "返回",
        curlExamples: "curl 示例：",
        curlRaw: "# 获取原始 markdown",
        curlJson: "# 获取 JSON 输出",
        curlBatch: "# 批量转换",
        exampleLabel: "试一个示例",
        footerLead: "基于 Cloudflare Workers 构建",
        mobilePlaceholder: "https://example.com/article",
      }
    : {
        htmlLang: "en",
        locale: "en_US",
        pageTitle: "Convert Any URL to Markdown",
        schemaDescription: "Convert any URL to clean, readable Markdown instantly. For AI agents, LLMs, and developers.",
        metaDescription:
          "Convert any URL to clean, readable Markdown instantly. Three conversion paths: native edge Markdown, Readability + Turndown, and headless browser rendering. For AI agents, LLMs, and developers.",
        shareDescription: `Prepend ${h}/ before any URL. Clean, readable Markdown for AI agents, LLMs, and developers. Powered by Cloudflare Workers.`,
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
        feature1Desc: "Three conversion paths: native edge Markdown, Readability extraction, or headless browser rendering.",
        feature2Label: "02 &mdash; API-first",
        feature2Title: "Multiple Formats",
        feature2Desc: "Output as <code>markdown</code>, <code>html</code>, <code>text</code>, or <code>json</code>. Specify CSS selectors for targeted extraction.",
        feature3Label: "03 &mdash; Cached",
        feature3Title: "Fast Responses",
        feature3Desc: "Results are cached in KV for instant repeat access. Images stored in R2 for reliable delivery.",
        howTitle: "How it works",
        step1Title: "Prepend URL",
        step1Desc: `Add <strong>${h}/</strong> before any web address.`,
        step2Title: "Edge Fetch",
        step2Desc: "Request sent with <code>Accept: text/markdown</code> via Cloudflare edge network.",
        step3Title: "Clean Output",
        step3Desc: "Receive formatted Markdown &mdash; rendered preview or raw text via API.",
        apiTitle: "API Reference",
        apiGetDesc: "Convert a single URL to Markdown",
        queryParams: "Query Parameters:",
        rawDesc: "Return raw Markdown (no HTML wrapper)",
        formatDesc: "Output format",
        selectorDesc: "Extract only matching CSS selector",
        forceBrowserDesc: "Force headless browser rendering",
        noCacheDesc: "Bypass cache, fetch fresh content",
        responseHeaders: "Response Headers:",
        sourceUrlDesc: "The original target URL",
        batchDesc: "Convert up to 10 URLs (requires <code>Authorization: Bearer &lt;token&gt;</code>)",
        bodyLabel: "Body",
        returnsLabel: "Returns",
        curlExamples: "curl Examples:",
        curlRaw: "# Get raw markdown",
        curlJson: "# Get JSON output",
        curlBatch: "# Batch conversion",
        exampleLabel: "Try an example",
        footerLead: "Built on Cloudflare Workers",
        mobilePlaceholder: "https://example.com/article",
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
    <p class="input-hint">${t.inputHintLead} &mdash; <code>?format=json|html|text</code> &middot; <code>?selector=.css</code> &middot; <code>?raw=true</code> &middot; <code>?force_browser=true</code> &middot; <code>?no_cache=true</code></p>

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
      <h2>${t.apiTitle}</h2>
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:16px;padding:2rem 1.75rem;font-size:0.82rem;line-height:1.8;color:var(--text-secondary)">
        <div style="margin-bottom:1rem"><strong style="color:var(--text-primary)">GET /{url}</strong> &mdash; ${t.apiGetDesc}</div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">${t.queryParams}</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1rem">
          <code>?raw=true</code> &mdash; ${t.rawDesc}<br>
          <code>?format=</code><code>markdown</code>|<code>html</code>|<code>text</code>|<code>json</code> &mdash; ${t.formatDesc}<br>
          <code>?selector=.article</code> &mdash; ${t.selectorDesc}<br>
          <code>?force_browser=true</code> &mdash; ${t.forceBrowserDesc}<br>
          <code>?no_cache=true</code> &mdash; ${t.noCacheDesc}
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">${t.responseHeaders}</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1rem">
          <code>X-Markdown-Method</code> &mdash; native | readability+turndown | browser+readability+turndown<br>
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
          <code style="display:block;margin-bottom:0.75rem">curl -H "Accept: text/markdown" ${h}/https://example.com</code>
          <code style="display:block;margin-bottom:0.4rem">${t.curlJson}</code>
          <code style="display:block;margin-bottom:0.75rem">curl "${h}/https://example.com?raw=true&amp;format=json"</code>
          <code style="display:block;margin-bottom:0.4rem">${t.curlBatch}</code>
          <code style="display:block">curl -X POST ${h}/api/batch -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"urls":["https://example.com"]}'</code>
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
    ${t.footerLead} &mdash; <a href="https://blog.cloudflare.com/markdown-for-agents/" target="_blank">Markdown for Agents</a>
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
