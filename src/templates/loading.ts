import { buildRawRequestPath, escapeHtml } from "../security";

export function loadingPageHTML(
  host: string,
  targetUrl: string,
  extraStreamParams: string,
): string {
  const h = escapeHtml(host);
  const streamUrl = `/api/stream?url=${encodeURIComponent(targetUrl)}${extraStreamParams}`;
  const displayUrl =
    targetUrl.length > 70 ? targetUrl.slice(0, 67) + "..." : targetUrl;
  // Escape characters unsafe in inline <script>: </script> injection, U+2028/2029 line terminators
  const config = JSON.stringify({ host, targetUrl, streamUrl })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const rawHref = escapeHtml(buildRawRequestPath(targetUrl));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Converting\u2026 \u2014 ${h}</title>
  <meta name="robots" content="noindex, nofollow">
  <noscript><meta http-equiv="refresh" content="0;url=${rawHref}"></noscript>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.8.1/github-markdown-dark.min.css">
  <style>
    :root{
      --bg-deep:#07080c;--bg-base:#0c0d12;--bg-surface:#111318;--bg-elevated:#191b22;
      --border:#23252f;--border-subtle:#1a1c26;
      --text-primary:#eeeef2;--text-secondary:#8b8da3;--text-muted:#555770;
      --accent:#22d3ee;--accent-hover:#06b6d4;
      --green:#34d399;--amber:#fbbf24;--violet:#a78bfa;--red:#f87171;
      --font-display:'Instrument Serif',Georgia,serif;
      --font-body:'DM Sans',system-ui,sans-serif;
      --font-mono:'JetBrains Mono','Fira Code',monospace;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:var(--font-body);background:var(--bg-deep);color:var(--text-primary);min-height:100vh}

    /* ── Loading view ── */
    #loading-view{
      min-height:100vh;display:flex;flex-direction:column;
      align-items:center;justify-content:center;padding:2rem;position:relative;overflow:hidden;
    }
    .bg-glow{position:fixed;inset:0;pointer-events:none;z-index:0}
    .bg-glow::before{
      content:'';position:absolute;width:500px;height:500px;border-radius:50%;
      background:radial-gradient(circle,rgba(34,211,238,.06) 0%,transparent 70%);
      top:-180px;right:-100px;animation:drift 20s ease-in-out infinite;
    }
    @keyframes drift{0%,100%{transform:translate(0,0)}50%{transform:translate(-30px,20px)}}

    .loading-logo{
      font-weight:600;font-size:.9rem;color:var(--accent);text-decoration:none;
      margin-bottom:3rem;position:relative;z-index:1;animation:fadeUp .5s ease both;
    }
    .loading-card{
      position:relative;z-index:1;width:100%;max-width:420px;
      background:var(--bg-surface);border:1px solid var(--border);
      border-radius:18px;padding:2.5rem 2rem;text-align:center;
      animation:fadeUp .5s ease .1s both;
    }
    .loading-title{
      font-family:var(--font-display);font-size:1.8rem;font-weight:400;
      font-style:italic;color:var(--text-primary);margin-bottom:.75rem;
    }
    .dots span{opacity:0;animation:blink 1.4s infinite}
    .dots span:nth-child(2){animation-delay:.2s}
    .dots span:nth-child(3){animation-delay:.4s}
    @keyframes blink{0%,20%{opacity:0}40%,60%{opacity:1}80%,100%{opacity:0}}

    .loading-url{
      font-family:var(--font-mono);font-size:.72rem;color:var(--text-muted);
      margin-bottom:2rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      max-width:100%;padding:0 .5rem;
    }
    .steps-list{text-align:left;margin:0 auto;display:inline-block}
    .step{display:flex;align-items:center;gap:.75rem;padding:.5rem 0;transition:opacity .3s ease}
    .step.pending{opacity:.3}
    .step.active{opacity:1}
    .step.done{opacity:.6}
    .step.hidden{display:none}

    .step-icon{width:18px;height:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .icon-ring{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--text-muted)}
    .step.active .icon-ring,.step.done .icon-ring{display:none}
    .icon-spinner{display:none;width:16px;height:16px}
    .step.active .icon-spinner{display:block;animation:spin .8s linear infinite}
    .icon-spinner circle{stroke:var(--accent);fill:none;stroke-width:2;stroke-dasharray:36;stroke-dashoffset:12;stroke-linecap:round}
    .icon-check{display:none}
    .step.done .icon-check{display:block}
    .icon-check path{stroke:var(--green)}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

    .step-label{font-size:.82rem;color:var(--text-secondary);font-weight:400}
    .step.active .step-label{color:var(--text-primary);font-weight:500}

    .loading-timer{margin-top:1.5rem;font-family:var(--font-mono);font-size:.7rem;color:var(--text-muted);letter-spacing:.02em}
    .loading-home{
      display:inline-block;margin-top:2rem;font-size:.78rem;color:var(--text-muted);
      text-decoration:none;position:relative;z-index:1;transition:color .2s;
      animation:fadeUp .5s ease .2s both;
    }
    .loading-home:hover{color:var(--text-secondary)}

    /* ── Transitions ── */
    .view-out{animation:viewOut .35s ease forwards}
    .view-in{animation:viewIn .35s ease forwards}
    @keyframes viewOut{to{opacity:0;transform:scale(.97)}}
    @keyframes viewIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}

    /* ── Result view (mirrors rendered.ts) ── */
    #result-view{display:none}
    .toolbar{
      position:sticky;top:0;z-index:100;display:flex;align-items:center;
      justify-content:space-between;gap:1rem;padding:0 1.5rem;height:52px;
      background:rgba(7,8,12,.82);backdrop-filter:blur(16px) saturate(180%);
      -webkit-backdrop-filter:blur(16px) saturate(180%);border-bottom:1px solid var(--border-subtle);
    }
    .toolbar-left{display:flex;align-items:center;gap:.75rem;min-width:0}
    .logo{font-weight:600;font-size:.88rem;color:var(--accent);text-decoration:none;white-space:nowrap}
    .sep{width:1px;height:16px;background:var(--border);flex-shrink:0}
    .source-url{
      font-family:var(--font-mono);font-size:.72rem;color:var(--text-muted);
      text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .2s;
    }
    .source-url:hover{color:var(--text-secondary)}
    .toolbar-right{display:flex;align-items:center;gap:.5rem;flex-shrink:0}
    .status-pill{
      padding:.2rem .65rem;border-radius:6px;font-family:var(--font-mono);
      font-size:.65rem;font-weight:500;letter-spacing:.02em;white-space:nowrap;
    }
    .st-native{background:rgba(52,211,153,.08);color:var(--green);border:1px solid rgba(52,211,153,.18)}
    .st-fallback{background:rgba(251,191,36,.08);color:var(--amber);border:1px solid rgba(251,191,36,.18)}
    .st-browser{background:rgba(167,139,250,.08);color:var(--violet);border:1px solid rgba(167,139,250,.18)}
    .cache-pill{
      padding:.2rem .5rem;border-radius:6px;font-family:var(--font-mono);
      font-size:.6rem;font-weight:500;display:none;
      background:rgba(52,211,153,.08);color:var(--green);border:1px solid rgba(52,211,153,.18);
    }
    .tokens{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);white-space:nowrap}
    .btn{
      padding:.3rem .8rem;border-radius:7px;border:1px solid var(--border);
      background:var(--bg-surface);color:var(--text-secondary);font-size:.75rem;
      font-family:var(--font-body);font-weight:500;cursor:pointer;transition:all .15s ease;white-space:nowrap;
    }
    .btn:hover{background:var(--bg-elevated);color:var(--text-primary)}
    .btn-accent{
      background:var(--accent);border-color:transparent;color:var(--bg-deep);
      font-weight:600;text-decoration:none;display:inline-flex;align-items:center;
    }
    .btn-accent:hover{background:var(--accent-hover)}
    .tab-bar{display:flex;gap:0;padding:0 2rem;background:var(--bg-base);border-bottom:1px solid var(--border-subtle)}
    .tab{
      padding:.7rem 1.15rem;font-size:.8rem;font-weight:500;color:var(--text-muted);
      cursor:pointer;border-bottom:2px solid transparent;transition:all .15s ease;margin-bottom:-1px;
    }
    .tab.active{color:var(--accent);border-bottom-color:var(--accent)}
    .tab:hover:not(.active){color:var(--text-secondary)}
    .panel{display:none;padding:2.5rem 2rem;max-width:860px;margin:0 auto;width:100%}
    .panel.active{display:block;animation:panelIn .2s ease}
    @keyframes panelIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    .markdown-body{background:transparent !important;font-size:15px}
    .raw-content{
      font-family:var(--font-mono);font-size:.8rem;line-height:1.8;
      white-space:pre-wrap;word-break:break-word;color:var(--text-secondary);
      background:var(--bg-surface);padding:1.5rem;border-radius:10px;border:1px solid var(--border-subtle);
    }

    /* ── Error view ── */
    #error-view{display:none;min-height:100vh;align-items:center;justify-content:center;padding:2rem}
    .error-card{
      max-width:440px;width:100%;padding:3rem 2.5rem;background:var(--bg-surface);
      border:1px solid var(--border);border-radius:18px;text-align:center;
    }
    .error-code{font-family:var(--font-mono);font-size:3rem;color:var(--red);opacity:.5;line-height:1;margin-bottom:1.25rem;font-weight:600}
    .error-card h1{font-family:var(--font-display);font-style:italic;font-size:1.4rem;font-weight:400;margin-bottom:.75rem}
    .error-card p{color:var(--text-secondary);line-height:1.7;margin-bottom:2rem;font-size:.88rem;font-weight:300}
    .error-actions{display:flex;gap:.75rem;justify-content:center}
    .btn-retry{
      padding:.55rem 1.4rem;background:var(--accent);color:var(--bg-deep);
      border:none;border-radius:9px;font-weight:600;font-size:.82rem;
      cursor:pointer;font-family:var(--font-body);transition:background .2s;
    }
    .btn-retry:hover{background:var(--accent-hover)}
    .btn-home{
      padding:.55rem 1.4rem;background:var(--bg-elevated);color:var(--text-secondary);
      border:1px solid var(--border);border-radius:9px;font-weight:500;
      font-size:.82rem;text-decoration:none;transition:all .2s;
    }
    .btn-home:hover{color:var(--text-primary)}

    @media(max-width:768px){
      .toolbar{padding:0 1rem}
      .source-url,.sep{display:none}
      .panel{padding:1.25rem 1rem}
      .tab-bar{padding:0 1rem}
      .loading-card{padding:2rem 1.5rem}
    }
  </style>
</head>
<body>
  <!-- Loading View -->
  <div id="loading-view">
    <div class="bg-glow"></div>
    <a href="/" class="loading-logo">${h}</a>
    <div class="loading-card">
      <h1 class="loading-title">Converting<span class="dots"><span>.</span><span>.</span><span>.</span></span></h1>
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
    <a href="/" class="loading-home">&larr; Back to home</a>
  </div>

  <!-- Result View -->
  <div id="result-view">
    <div class="toolbar">
      <div class="toolbar-left">
        <a href="/" class="logo">${h}</a>
        <div class="sep"></div>
        <a href="" class="source-url" id="r-source" target="_blank"></a>
      </div>
      <div class="toolbar-right">
        <span class="status-pill" id="r-method"></span>
        <span class="cache-pill" id="r-cache">CACHED</span>
        <span class="tokens" id="r-tokens"></span>
        <button class="btn" id="copy-btn" onclick="copyRaw()">Copy</button>
        <a href="" class="btn btn-accent" id="r-raw" target="_blank">Raw</a>
      </div>
    </div>
    <div class="tab-bar">
      <div class="tab active" id="tab-rendered" onclick="switchTab('rendered')">Rendered</div>
      <div class="tab" id="tab-source" onclick="switchTab('source')">Source</div>
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
      window.location.href = '/'+ encodeURIComponent(C.targetUrl) + '?raw=true';
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
      else { mp.className = 'status-pill st-fallback'; mp.textContent = 'Readability + Turndown'; }

      if (data.cached) document.getElementById('r-cache').style.display = '';
      if (data.tokenCount) document.getElementById('r-tokens').textContent = data.tokenCount + ' tokens';

      var rawUrl = data.rawUrl || ('/' + encodeURIComponent(C.targetUrl) + '?raw=true');
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

      var lv = document.getElementById('loading-view');
      lv.classList.add('view-out');
      setTimeout(function() {
        lv.style.display = 'none';
        var rv = document.getElementById('result-view');
        rv.style.display = 'block';
        rv.classList.add('view-in');
      }, 350);
    }

    function showError(data) {
      document.getElementById('e-code').textContent = data.status || '!';
      document.getElementById('e-title').textContent = data.title || 'Error';
      document.getElementById('e-message').textContent = data.message || 'An unexpected error occurred.';

      var lv = document.getElementById('loading-view');
      lv.classList.add('view-out');
      setTimeout(function() {
        lv.style.display = 'none';
        var ev = document.getElementById('error-view');
        ev.style.display = 'flex';
        ev.classList.add('view-in');
      }, 350);
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
      document.getElementById(tab === 'rendered' ? 'tab-rendered' : 'tab-source').classList.add('active');
      document.getElementById(tab === 'rendered' ? 'rendered-panel' : 'source-panel').classList.add('active');
    }

    function copyRaw() {
      navigator.clipboard.writeText(rawMarkdown).then(function() {
        var btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      }).catch(function() {});
    }
  </script>
</body>
</html>`;
}
