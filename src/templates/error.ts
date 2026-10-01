import { escapeHtml } from "../security";
import { FONT_UI, THEME_BASE, THEME_BOOT, THEME_TOKENS } from "./theme";

export function errorPageHTML(title: string, message: string, statusCode?: number): string {
  const statusDisplay = statusCode
    ? `<p class="error-code">${statusCode}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error — ${escapeHtml(title)}</title>
  <meta name="robots" content="noindex, nofollow">
  <meta property="og:title" content="Error — ${escapeHtml(title)}">
  <meta property="og:type" content="website">
  ${THEME_BOOT}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONT_UI}" rel="stylesheet">
  <style>
    ${THEME_TOKENS}
    ${THEME_BASE}
    body { min-height: 100dvh; display: flex; align-items: center; padding: 32px 20px; }
    main { max-width: 32rem; }
    .error-code { font-family: var(--font-mono); font-size: 15px; font-weight: 600; color: var(--danger); margin-bottom: 8px; font-variant-numeric: tabular-nums; }
    h1 { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; margin-bottom: 12px; }
    p { color: var(--text-secondary); line-height: 1.6; margin-bottom: 24px; max-width: 52ch; }
    a.back {
      display: inline-flex; align-items: center; min-height: 36px; padding: 6px 12px;
      background: var(--accent); color: var(--accent-on); text-decoration: none;
      border-radius: var(--radius); font-weight: 600; font-size: 14px;
    }
    a.back:hover { background: var(--accent-hover); }
  </style>
</head>
<body>
  <main>
    ${statusDisplay}
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a class="back" href="/">Back to home</a>
  </main>
</body>
</html>`;
}
