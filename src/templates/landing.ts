import { escapeHtml } from "../security";

export function landingPageHTML(host: string): string {
  const h = escapeHtml(host);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${h} - Convert Any URL to Markdown</title>
  <meta name="description" content="Convert any URL to clean, readable Markdown instantly. Three conversion paths: native edge Markdown, Readability + Turndown, and headless browser rendering. For AI agents, LLMs, and developers.">
  <link rel="canonical" href="https://${h}/">
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${h} — Convert Any URL to Markdown">
  <meta property="og:description" content="Prepend ${h}/ before any URL. Clean, readable Markdown for AI agents, LLMs, and developers. Powered by Cloudflare Workers.">
  <meta property="og:url" content="https://${h}/">
  <meta property="og:site_name" content="${h}">
  <meta property="og:image" content="https://${h}/api/og">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="en_US">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${h} — Convert Any URL to Markdown">
  <meta name="twitter:description" content="Prepend ${h}/ before any URL. Clean, readable Markdown for AI agents, LLMs, and developers.">
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
    }
  </style>
</head>
<body>
  <div class="bg-glow"></div>

  <div class="hero">
    <div class="badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      Cloudflare Markdown for Agents
    </div>

    <h1>Any URL to <em>Markdown</em>,<br>instantly</h1>

    <p class="subtitle">
      Prepend <strong>${h}/</strong> before any URL.<br>
      Clean, readable Markdown for AI agents, LLMs, and developers.
    </p>

    <div class="input-wrapper">
      <form class="input-group" id="urlForm" onsubmit="return handleSubmit(event)">
        <div class="input-prefix">${h}/</div>
        <input type="text" id="urlInput" placeholder="paste any url..." autocomplete="off" autofocus />
        <button type="submit">Convert</button>
      </form>
    </div>
    <p class="input-hint">Bare domains, http:// and https:// all work &mdash; <code>?format=json|html|text</code> &middot; <code>?selector=.css</code> &middot; <code>?raw=true</code> &middot; <code>?force_browser=true</code> &middot; <code>?no_cache=true</code></p>

    <div class="features">
      <div class="feature">
        <div class="feature-label">01 &mdash; Universal</div>
        <h3>Any Website</h3>
        <p>Three conversion paths: native edge Markdown, Readability extraction, or headless browser rendering.</p>
      </div>
      <div class="feature">
        <div class="feature-label">02 &mdash; API-first</div>
        <h3>Multiple Formats</h3>
        <p>Output as <code>markdown</code>, <code>html</code>, <code>text</code>, or <code>json</code>. Specify CSS selectors for targeted extraction.</p>
      </div>
      <div class="feature">
        <div class="feature-label">03 &mdash; Cached</div>
        <h3>Fast Responses</h3>
        <p>Results are cached in KV for instant repeat access. Images stored in R2 for reliable delivery.</p>
      </div>
    </div>

    <div class="how-section">
      <h2>How it works</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">i</div>
          <h3>Prepend URL</h3>
          <p>Add <strong>${h}/</strong> before any web address.</p>
        </div>
        <div class="step">
          <div class="step-num">ii</div>
          <h3>Edge Fetch</h3>
          <p>Request sent with <code>Accept: text/markdown</code> via Cloudflare edge network.</p>
        </div>
        <div class="step">
          <div class="step-num">iii</div>
          <h3>Clean Output</h3>
          <p>Receive formatted Markdown &mdash; rendered preview or raw text via API.</p>
        </div>
      </div>
    </div>

    <div class="how-section" style="margin-top:3.5rem">
      <h2>API Reference</h2>
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:16px;padding:2rem 1.75rem;font-size:0.82rem;line-height:1.8;color:var(--text-secondary)">
        <div style="margin-bottom:1rem"><strong style="color:var(--text-primary)">GET /{url}</strong> &mdash; Convert a single URL to Markdown</div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">Query Parameters:</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1rem">
          <code>?raw=true</code> &mdash; Return raw Markdown (no HTML wrapper)<br>
          <code>?format=</code><code>markdown</code>|<code>html</code>|<code>text</code>|<code>json</code> &mdash; Output format<br>
          <code>?selector=.article</code> &mdash; Extract only matching CSS selector<br>
          <code>?force_browser=true</code> &mdash; Force headless browser rendering<br>
          <code>?no_cache=true</code> &mdash; Bypass cache, fetch fresh content
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">Response Headers:</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1rem">
          <code>X-Markdown-Method</code> &mdash; native | readability+turndown | browser+readability+turndown<br>
          <code>X-Cache-Status</code> &mdash; HIT | MISS<br>
          <code>X-Source-URL</code> &mdash; The original target URL
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">POST /api/batch</strong> &mdash; Convert up to 10 URLs (requires <code>Authorization: Bearer &lt;token&gt;</code>)</div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.75rem;margin-bottom:1.5rem">
          Body: <code>{"urls": ["https://...", "https://..."]}</code><br>
          Returns: <code>{"results": [{url, markdown, title, method}, ...]}</code>
        </div>
        <div style="margin-bottom:0.5rem"><strong style="color:var(--accent)">curl Examples:</strong></div>
        <div style="padding-left:1rem;font-family:var(--font-mono);font-size:0.72rem;line-height:2;color:var(--text-muted)">
          <code style="display:block;margin-bottom:0.4rem"># Get raw markdown</code>
          <code style="display:block;margin-bottom:0.75rem">curl -H "Accept: text/markdown" ${h}/https://example.com</code>
          <code style="display:block;margin-bottom:0.4rem"># Get JSON output</code>
          <code style="display:block;margin-bottom:0.75rem">curl "${h}/https://example.com?raw=true&amp;format=json"</code>
          <code style="display:block;margin-bottom:0.4rem"># Batch conversion</code>
          <code style="display:block">curl -X POST ${h}/api/batch -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"urls":["https://example.com"]}'</code>
        </div>
      </div>
    </div>

    <div class="example-box">
      <div class="example-label">Try an example</div>
      <div class="example-url" onclick="window.location.href='/https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/'">
        <span class="hl">${h}/</span>https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
      </div>
    </div>
  </div>

  <footer>
    Built on Cloudflare Workers &mdash; <a href="https://blog.cloudflare.com/markdown-for-agents/" target="_blank">Markdown for Agents</a>
  </footer>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "${h}",
    "description": "Convert any URL to clean, readable Markdown instantly. For AI agents, LLMs, and developers.",
    "url": "https://${h}/",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Any",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
  }
  </script>
  <script>
    function handleSubmit(e) {
      e.preventDefault();
      var input = document.getElementById('urlInput').value.trim();
      if (!input) return false;
      window.location.href = '/' + input;
      return false;
    }
    // On mobile, prefix is hidden — update placeholder to show full URL hint
    if (window.matchMedia('(max-width: 768px)').matches) {
      document.getElementById('urlInput').placeholder = 'https://example.com/article';
    }
  </script>
</body>
</html>`;
}
