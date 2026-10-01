import { buildRawRequestPath, escapeHtml } from "../security";
import { FONT_READING, PROSE_CSS, READING_CHROME, THEME_BASE, THEME_BOOT, THEME_TOKENS } from "./theme";

/** Extract a plain-text snippet from markdown for use as description. */
function contentSnippet(content: string, maxLen = 160): string {
  const plain = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s/gm, "")
    .replace(/^>\s/gm, "")
    .replace(/\n+/g, " ")
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen - 1) + "\u2026" : plain;
}

export function renderedPageHTML(
  host: string,
  content: string,
  sourceUrl: string,
  tokenCount: string,
  method: "native" | "fallback" | "browser" | "proxy" | "jina" | "firecrawl" | "cloudflare",
  cached: boolean = false,
  articleTitle: string = "",
  rawRequestPath: string = buildRawRequestPath(sourceUrl),
): string {
  const escapedContent = escapeHtml(content);
  const ogTitle = articleTitle || sourceUrl;
  const ogDescription = contentSnippet(content);
  const ogImageUrl = `https://${host}/api/og?title=${encodeURIComponent(ogTitle)}`;
  const statusConfig: Record<string, { label: string; cls: string }> = {
    native: { label: "Native Markdown", cls: "st-native" },
    fallback: { label: "Readability + Turndown", cls: "st-fallback" },
    browser: { label: "Browser Rendered", cls: "st-browser" },
    proxy: { label: "Residential Proxy", cls: "st-browser" },
    jina: { label: "Jina Reader", cls: "st-jina" },
    firecrawl: { label: "Firecrawl", cls: "st-firecrawl" },
    cloudflare: { label: "Cloudflare REST", cls: "st-native" },
  };
  const status = statusConfig[method];
  const cacheLabel = cached ? '<span class="cache-pill">CACHED</span>' : '';
  const rawHref = escapeHtml(rawRequestPath);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(ogTitle)} &mdash; ${escapeHtml(host)}</title>
  <meta name="description" content="${escapeHtml(ogDescription)}">
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${escapeHtml(sourceUrl)}">
  <link rel="alternate" type="text/markdown" href="${rawHref}" title="Markdown">
  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  <meta property="og:url" content="https://${escapeHtml(host)}/${escapeHtml(sourceUrl)}">
  <meta property="og:site_name" content="${escapeHtml(host)}">
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}">
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">
  ${THEME_BOOT}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONT_READING}" rel="stylesheet">
  <style>
    ${THEME_TOKENS}
    ${THEME_BASE}
    ${READING_CHROME}
    ${PROSE_CSS}
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <a href="/" class="logo">${escapeHtml(host)}</a>
      <a href="${escapeHtml(sourceUrl)}" class="source-url" target="_blank" rel="noreferrer" title="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a>
    </div>
    <div class="toolbar-right">
      <span class="status-pill ${status.cls}">${status.label}</span>
      ${cacheLabel}
      ${tokenCount ? '<span class="tokens">' + escapeHtml(tokenCount) + " tokens</span>" : ""}
      <button class="btn" id="copy-btn" onclick="copyRaw()">Copy</button>
      <a href="${rawHref}" class="btn btn-accent" target="_blank">Raw</a>
    </div>
  </div>

  <div class="tab-bar" role="tablist">
    <button type="button" class="tab active" id="tab-rendered" role="tab" aria-selected="true" onclick="switchTab('rendered')">Rendered</button>
    <button type="button" class="tab" id="tab-source" role="tab" aria-selected="false" onclick="switchTab('source')">Source</button>
  </div>

  <div class="panel active" id="rendered-panel">
    <div class="markdown-body" id="markdown-rendered"></div>
    <noscript><pre class="raw-content">${escapedContent}</pre></noscript>
  </div>

  <div class="panel" id="source-panel">
    <div class="raw-content" id="raw-content">${escapedContent}</div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js" integrity="sha384-H+hy9ULve6xfxRkWIh/YOtvDdpXgV2fmAGQkIDTxIgZwNoaoBal14Di2YTMR6MzR" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js" integrity="sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu" crossorigin="anonymous"></script>
  <script>
    var rawContent = document.getElementById('raw-content').textContent;
    if (typeof DOMPurify !== 'undefined' && typeof marked !== 'undefined') {
      document.getElementById('markdown-rendered').innerHTML = DOMPurify.sanitize(marked.parse(rawContent));
    } else {
      document.getElementById('markdown-rendered').textContent = rawContent;
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
      var activeTab = document.getElementById(tab === 'rendered' ? 'tab-rendered' : 'tab-source');
      activeTab.classList.add('active');
      activeTab.setAttribute('aria-selected', 'true');
      document.getElementById(tab === 'rendered' ? 'rendered-panel' : 'source-panel').classList.add('active');
    }

    function copyRaw() {
      navigator.clipboard.writeText(rawContent).then(function() {
        var btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      }).catch(function() {});
    }
  </script>
</body>
</html>`;
}
