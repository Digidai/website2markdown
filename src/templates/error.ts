import { escapeHtml } from "../security";

export function errorPageHTML(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error &mdash; ${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-deep: #07080c; --bg-surface: #111318; --border: #23252f;
      --text-primary: #eeeef2; --text-secondary: #8b8da3; --red: #f87171;
      --accent: #22d3ee; --accent-hover: #06b6d4;
      --font-display: 'Instrument Serif', Georgia, serif;
      --font-body: 'DM Sans', system-ui, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-body); background: var(--bg-deep); color: var(--text-primary);
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem;
    }

    .error-card {
      max-width: 440px; width: 100%; padding: 3rem 2.5rem; background: var(--bg-surface);
      border: 1px solid var(--border); border-radius: 18px; text-align: center;
      animation: fadeUp 0.5s ease both;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .error-glyph { font-family: var(--font-display); font-style: italic; font-size: 3.5rem; color: var(--red); opacity: 0.35; line-height: 1; margin-bottom: 1.25rem; }
    h1 { font-family: var(--font-display); font-style: italic; font-size: 1.4rem; font-weight: 400; margin-bottom: 0.75rem; color: var(--text-primary); }
    p { color: var(--text-secondary); line-height: 1.7; margin-bottom: 2rem; font-size: 0.88rem; font-weight: 300; }

    a {
      display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.4rem;
      background: var(--accent); color: var(--bg-deep); text-decoration: none;
      border-radius: 9px; font-weight: 600; font-size: 0.82rem; transition: background 0.2s ease;
    }
    a:hover { background: var(--accent-hover); }
  </style>
</head>
<body>
  <div class="error-card">
    <div class="error-glyph">!</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      Back to Home
    </a>
  </div>
</body>
</html>`;
}
