// OG 图片生成处理

/** Generate a branded SVG OG image for social sharing. */
export function handleOgImage(url: URL, host: string): Response {
  const title = url.searchParams.get("title") || "";
  const displayTitle = title.length > 80 ? title.slice(0, 79) + "\u2026" : title;

  const lines: string[] = [];
  if (displayTitle) {
    const words = displayTitle.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line && (line + " " + word).length > 40) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) lines.push(line);
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const titleLines = lines
    .slice(0, 3)
    .map((l, i) => `<text x="80" y="${title ? 280 + i * 56 : 320}" font-family="system-ui,sans-serif" font-size="44" font-weight="600" fill="#eeeef2">${esc(l)}</text>`)
    .join("\n    ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07080c"/>
      <stop offset="100%" stop-color="#0c0d12"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="50%" stop-color="#67e8f9"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="4" fill="url(#accent)"/>
  <circle cx="1050" cy="120" r="200" fill="#22d3ee" opacity="0.04"/>
  <circle cx="150" cy="500" r="150" fill="#22d3ee" opacity="0.03"/>
  <text x="80" y="120" font-family="system-ui,sans-serif" font-size="24" font-weight="600" fill="#22d3ee">${esc(host)}</text>
  <text x="80" y="160" font-family="system-ui,sans-serif" font-size="18" fill="#8b8da3">Any URL to Markdown, instantly</text>
  <line x1="80" y1="200" x2="300" y2="200" stroke="#23252f" stroke-width="1"/>
  ${titleLines || `<text x="80" y="340" font-family="Georgia,serif" font-size="52" font-style="italic" font-weight="400" fill="#eeeef2">Any URL to</text>
    <text x="80" y="400" font-family="Georgia,serif" font-size="52" font-style="italic" font-weight="400" fill="url(#accent)">Markdown</text>`}
  <text x="80" y="580" font-family="system-ui,sans-serif" font-size="16" fill="#555770">Powered by Cloudflare Workers</text>
  <rect x="940" y="560" width="180" height="40" rx="8" fill="#22d3ee" opacity="0.1"/>
  <text x="980" y="586" font-family="monospace" font-size="14" font-weight="500" fill="#22d3ee">Convert &rarr;</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
