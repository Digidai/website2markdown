import { escapeHtml } from "../security";

export function renderedPageHTML(
  host: string,
  content: string,
  sourceUrl: string,
  tokenCount: string,
  method: "native" | "fallback" | "browser",
  cached: boolean = false,
): string {
  const escapedContent = escapeHtml(content);
  const statusConfig: Record<string, { label: string; cls: string }> = {
    native: { label: "Native Markdown", cls: "st-native" },
    fallback: { label: "Readability + Turndown", cls: "st-fallback" },
    browser: { label: "Browser Rendered", cls: "st-browser" },
  };
  const status = statusConfig[method];
  const cacheLabel = cached ? '<span class="cache-pill">CACHED</span>' : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MD &mdash; ${escapeHtml(sourceUrl)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.8.1/github-markdown-dark.min.css">
  <style>
    :root {
      --bg-deep: #07080c; --bg-base: #0c0d12; --bg-surface: #111318; --bg-elevated: #191b22;
      --border: #23252f; --border-subtle: #1a1c26;
      --text-primary: #eeeef2; --text-secondary: #8b8da3; --text-muted: #555770;
      --accent: #22d3ee; --accent-hover: #06b6d4;
      --green: #34d399; --amber: #fbbf24; --violet: #a78bfa;
      --font-body: 'DM Sans', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body { font-family: var(--font-body); background: var(--bg-deep); color: var(--text-primary); min-height: 100vh; }

    .toolbar {
      position: sticky; top: 0; z-index: 100; display: flex; align-items: center;
      justify-content: space-between; gap: 1rem; padding: 0 1.5rem; height: 52px;
      background: rgba(7,8,12,0.82); backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%); border-bottom: 1px solid var(--border-subtle);
    }

    .toolbar-left { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
    .logo { font-weight: 600; font-size: 0.88rem; color: var(--accent); text-decoration: none; white-space: nowrap; letter-spacing: -0.01em; }
    .sep { width: 1px; height: 16px; background: var(--border); flex-shrink: 0; }
    .source-url { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color 0.2s; }
    .source-url:hover { color: var(--text-secondary); }

    .toolbar-right { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
    .status-pill { padding: 0.2rem 0.65rem; border-radius: 6px; font-family: var(--font-mono); font-size: 0.65rem; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; }
    .st-native { background: rgba(52,211,153,0.08); color: var(--green); border: 1px solid rgba(52,211,153,0.18); }
    .st-fallback { background: rgba(251,191,36,0.08); color: var(--amber); border: 1px solid rgba(251,191,36,0.18); }
    .st-browser { background: rgba(167,139,250,0.08); color: var(--violet); border: 1px solid rgba(167,139,250,0.18); }
    .cache-pill { padding: 0.2rem 0.5rem; border-radius: 6px; font-family: var(--font-mono); font-size: 0.6rem; font-weight: 500; background: rgba(52,211,153,0.08); color: var(--green); border: 1px solid rgba(52,211,153,0.18); }
    .tokens { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); white-space: nowrap; }

    .btn { padding: 0.3rem 0.8rem; border-radius: 7px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-secondary); font-size: 0.75rem; font-family: var(--font-body); font-weight: 500; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; }
    .btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
    .btn-accent { background: var(--accent); border-color: transparent; color: var(--bg-deep); font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; }
    .btn-accent:hover { background: var(--accent-hover); }

    .tab-bar { display: flex; gap: 0; padding: 0 2rem; background: var(--bg-base); border-bottom: 1px solid var(--border-subtle); }
    .tab { padding: 0.7rem 1.15rem; font-size: 0.8rem; font-weight: 500; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s ease; margin-bottom: -1px; }
    .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab:hover:not(.active) { color: var(--text-secondary); }

    .panel { display: none; padding: 2.5rem 2rem; max-width: 860px; margin: 0 auto; width: 100%; }
    .panel.active { display: block; animation: panelIn 0.2s ease; }
    @keyframes panelIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    .markdown-body { background: transparent !important; font-size: 15px; }
    .raw-content { font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.8; white-space: pre-wrap; word-break: break-word; color: var(--text-secondary); background: var(--bg-surface); padding: 1.5rem; border-radius: 10px; border: 1px solid var(--border-subtle); }

    @media (max-width: 768px) {
      .toolbar { padding: 0 1rem; }
      .source-url, .sep { display: none; }
      .panel { padding: 1.25rem 1rem; }
      .tab-bar { padding: 0 1rem; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <a href="/" class="logo">${escapeHtml(host)}</a>
      <div class="sep"></div>
      <a href="${escapeHtml(sourceUrl)}" class="source-url" target="_blank" title="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a>
    </div>
    <div class="toolbar-right">
      <span class="status-pill ${status.cls}">${status.label}</span>
      ${cacheLabel}
      ${tokenCount ? '<span class="tokens">' + escapeHtml(tokenCount) + " tokens</span>" : ""}
      <button class="btn" onclick="copyRaw()">Copy</button>
      <a href="/${escapeHtml(sourceUrl)}${sourceUrl.includes("?") ? "&" : "?"}raw=true" class="btn btn-accent" target="_blank">Raw</a>
    </div>
  </div>

  <div class="tab-bar">
    <div class="tab active" onclick="switchTab('rendered')">Rendered</div>
    <div class="tab" onclick="switchTab('source')">Source</div>
  </div>

  <div class="panel active" id="rendered-panel">
    <div class="markdown-body" id="markdown-rendered"></div>
  </div>

  <div class="panel" id="source-panel">
    <div class="raw-content" id="raw-content">${escapedContent}</div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js"></script>
  <script>
    var rawContent = document.getElementById('raw-content').textContent;
    document.getElementById('markdown-rendered').innerHTML = DOMPurify.sanitize(marked.parse(rawContent));

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
      if (tab === 'rendered') {
        document.querySelectorAll('.tab')[0].classList.add('active');
        document.getElementById('rendered-panel').classList.add('active');
      } else {
        document.querySelectorAll('.tab')[1].classList.add('active');
        document.getElementById('source-panel').classList.add('active');
      }
    }

    function copyRaw() {
      navigator.clipboard.writeText(rawContent).then(function() {
        var btn = document.querySelector('.btn');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      });
    }
  </script>
</body>
</html>`;
}
