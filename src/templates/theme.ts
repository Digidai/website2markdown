/**
 * Shared visual system for every HTML surface.
 *
 * One cool paper/ink palette, one sans for UI, one mono for code,
 * and a serif only where someone is actually reading an article.
 * Accent is a press blue, used on actions and links.
 */

export const FONT_UI =
  "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap";

export const FONT_READING =
  "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap";

/** Runs before paint so a saved theme does not flash the wrong palette. */
export const THEME_BOOT = `<script>(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>`;

export const THEME_TOKENS = `
    :root {
      --bg: #f3f4f6;
      --bg-surface: #ffffff;
      --bg-elevated: #e7eaee;
      --text-primary: #1c2128;
      --text-secondary: #3d4654;
      --text-muted: #5c6573;
      --accent: #1b4f8a;
      --accent-hover: #163f6e;
      --accent-text: #1b4f8a;
      --accent-soft: rgba(27, 79, 138, 0.08);
      --accent-on: #f4f6f8;
      --border: #d0d5dc;
      --danger: #a3262c;
      --success: #1a6b45;
      --warning: #8a5a12;
      --font-body: "Source Sans 3", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
      --font-reading: "Source Serif 4", "Songti SC", "Noto Serif SC", "Source Han Serif SC", Georgia, serif;
      --font-mono: "IBM Plex Mono", "Sarasa Mono SC", ui-monospace, monospace;
      --radius: 4px;
      --max-w: 1120px;
      --header-h: 56px;
      color-scheme: light dark;
    }

    :root[data-theme="dark"] {
      --bg: #14171c;
      --bg-surface: #1c2027;
      --bg-elevated: #262b34;
      --text-primary: #e7e9ed;
      --text-secondary: #c5cbd4;
      --text-muted: #9aa3b2;
      --accent: #c5d8f5;
      --accent-hover: #d7e4f8;
      --accent-text: #c5d8f5;
      --accent-soft: rgba(197, 216, 245, 0.12);
      --accent-on: #12161c;
      --border: #3a4250;
      --danger: #f0a8a8;
      --success: #8dcea9;
      --warning: #e6c48a;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #14171c;
        --bg-surface: #1c2027;
        --bg-elevated: #262b34;
        --text-primary: #e7e9ed;
        --text-secondary: #c5cbd4;
        --text-muted: #9aa3b2;
        --accent: #c5d8f5;
        --accent-hover: #d7e4f8;
        --accent-text: #c5d8f5;
        --accent-soft: rgba(197, 216, 245, 0.12);
        --accent-on: #12161c;
        --border: #3a4250;
        --danger: #f0a8a8;
        --success: #8dcea9;
        --warning: #e6c48a;
      }
    }
`;

export const THEME_BASE = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--text-primary);
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    :focus { outline: none; }
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    ::selection { background: var(--accent-soft); color: var(--text-primary); }
    .skip {
      position: absolute;
      left: 12px;
      top: -48px;
      z-index: 40;
      background: var(--accent);
      color: var(--accent-on);
      padding: 8px 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
    }
    .skip:focus { top: 12px; }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
`;

export const READING_CHROME = `
    body { min-height: 100dvh; }
    .toolbar {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px 16px; flex-wrap: wrap;
      padding: 8px 20px; min-height: var(--header-h);
      background: var(--bg); border-bottom: 1px solid var(--border);
    }
    .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
    .logo { font-weight: 600; font-size: 15px; color: var(--text-primary); text-decoration: none; letter-spacing: -0.01em; }
    .logo:hover { color: var(--accent-text); }
    .source-url {
      font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);
      text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 42vw;
    }
    .source-url:hover { color: var(--text-secondary); }
    .status-pill, .cache-pill {
      padding: 2px 8px; border-radius: var(--radius); border: 1px solid var(--border);
      font-size: 12px; font-weight: 600; white-space: nowrap; color: var(--text-secondary); background: var(--bg-surface);
    }
    .st-native, .cache-pill { color: var(--success); border-color: color-mix(in srgb, var(--success) 45%, var(--border)); }
    .st-fallback, .st-jina { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 45%, var(--border)); }
    .st-browser, .st-firecrawl { color: var(--accent-text); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
    .tokens { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .btn {
      padding: 6px 10px; min-height: 32px; border-radius: var(--radius);
      border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-primary);
      font-size: 14px; font-family: inherit; font-weight: 600; cursor: pointer; text-decoration: none;
      display: inline-flex; align-items: center;
    }
    .btn:hover { background: var(--bg-elevated); }
    .btn:active { transform: translateY(1px); }
    .btn-accent { background: var(--accent); border-color: var(--accent); color: var(--accent-on); }
    .btn-accent:hover { background: var(--accent-hover); }
    .tab-bar { display: flex; gap: 4px; padding: 0 20px; background: var(--bg); border-bottom: 1px solid var(--border); }
    .tab {
      appearance: none; background: none; border: 0; border-bottom: 2px solid transparent;
      margin-bottom: -1px; padding: 10px 12px; min-height: 40px;
      font-family: inherit; font-size: 14px; font-weight: 600; color: var(--text-muted); cursor: pointer;
    }
    .tab.active { color: var(--text-primary); border-bottom-color: var(--accent); }
    .tab:hover { color: var(--text-primary); }
    .panel { display: none; padding: 32px 20px 64px; max-width: 44rem; margin: 0 auto; width: 100%; }
    .panel.active { display: block; }
    .raw-content {
      font-family: var(--font-mono); font-size: 13px; line-height: 1.7;
      white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary);
      background: var(--bg-surface); padding: 16px; border: 1px solid var(--border); border-radius: var(--radius);
    }
    @media (max-width: 720px) {
      .source-url { display: none; }
      .toolbar, .tab-bar { padding-left: 12px; padding-right: 12px; }
      .panel { padding: 20px 12px 48px; }
    }
`;

export const PROSE_CSS = `
    .markdown-body {
      font-family: var(--font-reading);
      font-size: 1.0625rem;
      line-height: 1.75;
      color: var(--text-primary);
      overflow-wrap: break-word;
    }
    .markdown-body > *:first-child { margin-top: 0; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
      font-family: var(--font-body);
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.25;
      margin: 1.6em 0 0.5em;
    }
    .markdown-body h1 { font-size: 1.75rem; }
    .markdown-body h2 { font-size: 1.35rem; }
    .markdown-body h3 { font-size: 1.15rem; }
    .markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote, .markdown-body pre, .markdown-body table {
      margin: 0.8em 0;
    }
    .markdown-body ul, .markdown-body ol { padding-left: 1.4em; }
    .markdown-body li + li { margin-top: 0.25em; }
    .markdown-body a { color: var(--accent-text); text-underline-offset: 3px; }
    .markdown-body blockquote {
      border-left: 3px solid var(--border);
      padding-left: 1em;
      color: var(--text-secondary);
    }
    .markdown-body code {
      font-family: var(--font-mono);
      font-size: 0.84em;
      background: var(--bg-elevated);
      padding: 0.1em 0.35em;
      border-radius: 3px;
    }
    .markdown-body pre {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      padding: 14px 16px;
      overflow-x: auto;
      line-height: 1.6;
    }
    .markdown-body pre code { background: none; padding: 0; font-size: 0.8rem; }
    .markdown-body img { max-width: 100%; height: auto; }
    .markdown-body table { width: 100%; border-collapse: collapse; font-family: var(--font-body); font-size: 0.92rem; display: block; overflow-x: auto; }
    .markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; }
    .markdown-body th { font-weight: 600; background: var(--bg-elevated); }
    .markdown-body hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
`;
