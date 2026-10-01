import { buildRawRequestPath, escapeHtml } from "../security";
import { FONT_READING, PROSE_CSS, READING_CHROME, THEME_BASE, THEME_BOOT, THEME_TOKENS } from "./theme";

export function loadingPageHTML(
  host: string,
  targetUrl: string,
  extraStreamParams: string,
  rawRequestPath: string = buildRawRequestPath(targetUrl),
): string {
  const h = escapeHtml(host);
  const streamUrl = `/api/stream?url=${encodeURIComponent(targetUrl)}${extraStreamParams}`;
  const displayUrl =
    targetUrl.length > 70 ? targetUrl.slice(0, 67) + "..." : targetUrl;
  // Escape characters unsafe in inline <script>: </script> injection, U+2028/2029 line terminators
  const config = JSON.stringify({ host, targetUrl, streamUrl, rawRequestPath })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const rawHref = escapeHtml(rawRequestPath);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Converting\u2026 \u2014 ${h}</title>
  <meta name="robots" content="noindex, nofollow">
  <noscript><meta http-equiv="refresh" content="0;url=${rawHref}"></noscript>
  ${THEME_BOOT}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONT_READING}" rel="stylesheet">
  <style>
    ${THEME_TOKENS}
    ${THEME_BASE}
    ${READING_CHROME}
    ${PROSE_CSS}

    #loading-view {
      min-height: 100dvh; display: flex; flex-direction: column;
      align-items: flex-start; justify-content: center;
      padding: 32px 20px; max-width: 32rem; margin: 0 auto;
    }
    .loading-logo { font-weight: 600; font-size: 15px; color: var(--text-primary); text-decoration: none; margin-bottom: 28px; }
    .loading-title { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 8px; }
    .loading-url {
      font-family: var(--font-mono); font-size: 13px; color: var(--text-muted);
      margin-bottom: 24px; overflow-wrap: anywhere;
    }
    .steps-list { width: 100%; border-top: 1px solid var(--border); }
    .step { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .step.pending { color: var(--text-muted); }
    .step.hidden { display: none; }
    .step-icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .icon-ring { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--border); }
    .step.active .icon-ring, .step.done .icon-ring { display: none; }
    .icon-spinner { display: none; width: 16px; height: 16px; }
    .step.active .icon-spinner { display: block; animation: spin 0.8s linear infinite; }
    .icon-spinner circle { stroke: var(--accent); fill: none; stroke-width: 2; stroke-dasharray: 36; stroke-dashoffset: 12; stroke-linecap: round; }
    .icon-check { display: none; }
    .step.done .icon-check { display: block; }
    .icon-check path { stroke: var(--success); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .step-label { font-size: 15px; color: var(--text-secondary); }
    .step.active .step-label { color: var(--text-primary); font-weight: 600; }
    .step.done .step-label { color: var(--text-primary); }
    .loading-timer { margin-top: 16px; font-family: var(--font-mono); font-size: 13px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .loading-home { display: inline-block; margin-top: 20px; font-size: 14px; font-weight: 600; color: var(--accent-text); text-decoration: none; }
    .loading-home:hover { text-decoration: underline; text-underline-offset: 3px; }
    #result-view { display: none; }
    #error-view { display: none; min-height: 100dvh; align-items: center; justify-content: center; padding: 32px 20px; }
    .error-card { max-width: 28rem; width: 100%; }
    .error-code { font-family: var(--font-mono); font-size: 28px; font-weight: 600; color: var(--danger); margin-bottom: 8px; font-variant-numeric: tabular-nums; }
    .error-card h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 8px; }
    .error-card p { color: var(--text-secondary); line-height: 1.6; margin-bottom: 20px; }
    .error-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn-retry, .btn-home {
      min-height: 36px; padding: 6px 12px; border-radius: var(--radius);
      font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none;
    }
    .btn-retry { background: var(--accent); color: var(--accent-on); border: 1px solid var(--accent); }
    .btn-retry:hover { background: var(--accent-hover); }
    .btn-home { background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border); }
    .btn-home:hover { background: var(--bg-elevated); }
  </style>

</head>
<body>
  <!-- Loading View -->
  <div id="loading-view">
    <a href="/" class="loading-logo">${h}</a>
    <div class="loading-card">
      <h1 class="loading-title">Converting</h1>
      <div class="loading-url" title="${escapeHtml(targetUrl)}">${escapeHtml(displayUrl)}</div>
      <div class="steps-list">
        <div class="step active" id="step-fetch">
          <div class="step-icon">
            <div class="icon-ring"></div>
            <svg class="icon-spinner" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>
            <svg class="icon-check" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <span class="step-label">Fetching page</span>
        </div>
        <div class="step pending" id="step-analyze">
          <div class="step-icon">
            <div class="icon-ring"></div>
            <svg class="icon-spinner" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>
            <svg class="icon-check" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <span class="step-label">Analyzing content</span>
        </div>
        <div class="step pending hidden" id="step-browser">
          <div class="step-icon">
            <div class="icon-ring"></div>
            <svg class="icon-spinner" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>
            <svg class="icon-check" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <span class="step-label">Rendering with browser</span>
        </div>
        <div class="step pending" id="step-convert">
          <div class="step-icon">
            <div class="icon-ring"></div>
            <svg class="icon-spinner" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>
            <svg class="icon-check" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <span class="step-label">Converting to Markdown</span>
        </div>
      </div>
      <div class="loading-timer"><span id="elapsed">0</span>s elapsed</div>
    </div>
    <a href="/" class="loading-home">Back to home</a>
  </div>

  <!-- Result View -->
  <div id="result-view">
    <div class="toolbar">
      <div class="toolbar-left">
        <a href="/" class="logo">${h}</a>
        <a href="" class="source-url" id="r-source" target="_blank"></a>
      </div>
      <div class="toolbar-right">
        <span class="status-pill" id="r-method"></span>
        <span class="cache-pill" id="r-cache" hidden>CACHED</span>
        <span class="tokens" id="r-tokens"></span>
        <button class="btn" id="copy-btn" onclick="copyRaw()">Copy</button>
        <a href="" class="btn btn-accent" id="r-raw" target="_blank">Raw</a>
      </div>
    </div>
    <div class="tab-bar" role="tablist">
      <button type="button" class="tab active" id="tab-rendered" role="tab" aria-selected="true" onclick="switchTab('rendered')">Rendered</button>
      <button type="button" class="tab" id="tab-source" role="tab" aria-selected="false" onclick="switchTab('source')">Source</button>
    </div>
    <div class="panel active" id="rendered-panel">
      <div class="markdown-body" id="markdown-rendered"></div>
    </div>
    <div class="panel" id="source-panel">
      <div class="raw-content" id="raw-content"></div>
    </div>
  </div>

  <!-- Error View -->
  <div id="error-view">
    <div class="error-card">
      <div class="error-code" id="e-code"></div>
      <h1 id="e-title"></h1>
      <p id="e-message"></p>
      <div class="error-actions">
        <button class="btn-retry" onclick="location.reload()">Retry</button>
        <a href="/" class="btn-home">Back to Home</a>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js" integrity="sha384-H+hy9ULve6xfxRkWIh/YOtvDdpXgV2fmAGQkIDTxIgZwNoaoBal14Di2YTMR6MzR" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js" integrity="sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu" crossorigin="anonymous"></script>
  <script>
    var C = ${config};
    var handled = false;
    var elapsed = 0;
    var stepOrder = ['fetch', 'analyze', 'browser', 'convert'];
    var rawMarkdown = '';

    // Fallback for environments without EventSource support
    if (typeof EventSource === 'undefined') {
      window.location.href = C.rawRequestPath || ('/' + encodeURIComponent(C.targetUrl) + '?raw=true');
      throw new Error('redirect');
    }

    var timer = setInterval(function() {
      elapsed++;
      document.getElementById('elapsed').textContent = elapsed;
    }, 1000);

    var timeout = setTimeout(function() {
      if (handled) return;
      handled = true;
      es.close();
      clearInterval(timer);
      showError({ title: 'Timeout', message: 'The conversion is taking too long. Please try again.', status: 504 });
    }, 90000);

    var es = new EventSource(C.streamUrl);

    es.addEventListener('step', function(e) {
      if (handled) return;
      var data = JSON.parse(e.data);
      activateStep(data.id);
    });

    es.addEventListener('done', function(e) {
      if (handled) return;
      handled = true;
      es.close();
      clearInterval(timer);
      clearTimeout(timeout);
      var data = JSON.parse(e.data);
      stepOrder.forEach(function(id) {
        var el = document.getElementById('step-' + id);
        if (el && !el.classList.contains('hidden')) el.className = 'step done';
      });
      setTimeout(function() { showResult(data); }, 400);
    });

    es.addEventListener('fail', function(e) {
      if (handled) return;
      handled = true;
      es.close();
      clearInterval(timer);
      clearTimeout(timeout);
      var data = JSON.parse(e.data);
      showError(data);
    });

    es.onerror = function() {
      if (handled) return;
      if (es.readyState === EventSource.CLOSED) {
        handled = true;
        clearInterval(timer);
        clearTimeout(timeout);
        showError({ title: 'Connection Lost', message: 'Lost connection to the server. Please try again.' });
      }
    };

    function activateStep(id) {
      if (id === 'browser') {
        document.getElementById('step-browser').classList.remove('hidden');
      }
      for (var i = 0; i < stepOrder.length; i++) {
        var el = document.getElementById('step-' + stepOrder[i]);
        if (!el) continue;
        if (stepOrder[i] === id) {
          el.className = el.classList.contains('hidden') ? 'step active hidden' : 'step active';
          break;
        }
        if (!el.classList.contains('hidden')) el.className = 'step done';
      }
    }

    function showResult(data) {
      var src = document.getElementById('r-source');
      src.href = C.targetUrl;
      src.textContent = C.targetUrl;
      src.title = C.targetUrl;

      var mp = document.getElementById('r-method');
      var m = data.method || '';
      if (m.indexOf('browser') !== -1) { mp.className = 'status-pill st-browser'; mp.textContent = 'Browser Rendered'; }
      else if (m === 'native') { mp.className = 'status-pill st-native'; mp.textContent = 'Native Markdown'; }
      else if (m === 'jina') { mp.className = 'status-pill st-jina'; mp.textContent = 'Jina Reader'; }
      else if (m === 'firecrawl') { mp.className = 'status-pill st-firecrawl'; mp.textContent = 'Firecrawl'; }
      else { mp.className = 'status-pill st-fallback'; mp.textContent = 'Readability + Turndown'; }

      if (data.cached) document.getElementById('r-cache').hidden = false;
      if (data.tokenCount) document.getElementById('r-tokens').textContent = data.tokenCount + ' tokens';

      var rawUrl = data.rawUrl || C.rawRequestPath || ('/' + encodeURIComponent(C.targetUrl) + '?raw=true');
      document.getElementById('r-raw').href = rawUrl;

      if (data.title) document.title = data.title + ' \\u2014 ' + C.host;

      // Fetch markdown content separately to avoid large SSE payloads
      fetch(rawUrl, { headers: { 'Accept': 'text/markdown' } })
        .then(function(r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function(md) {
          rawMarkdown = md;
          document.getElementById('raw-content').textContent = rawMarkdown;
          var rendered = document.getElementById('markdown-rendered');
          if (typeof DOMPurify !== 'undefined' && typeof marked !== 'undefined') {
            rendered.innerHTML = DOMPurify.sanitize(marked.parse(rawMarkdown));
          } else {
            rendered.textContent = rawMarkdown;
          }
        })
        .catch(function() {
          document.getElementById('raw-content').textContent = 'Failed to load content. Please try the Raw link above.';
          document.getElementById('markdown-rendered').textContent = 'Failed to load content.';
        });

      document.getElementById('loading-view').style.display = 'none';
      document.getElementById('result-view').style.display = 'block';
    }

    function showError(data) {
      var code = document.getElementById('e-code');
      if (data.status) {
        code.hidden = false;
        code.textContent = String(data.status);
      } else {
        code.hidden = true;
        code.textContent = '';
      }
      document.getElementById('e-title').textContent = data.title || 'Error';
      document.getElementById('e-message').textContent = data.message || 'Something went wrong. Try again.';
      document.getElementById('loading-view').style.display = 'none';
      document.getElementById('error-view').style.display = 'flex';
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
      navigator.clipboard.writeText(rawMarkdown).then(function() {
        var btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      }).catch(function() {});
    }
  </script>
</body>
</html>`;
}
