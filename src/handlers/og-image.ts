// OG image for link previews.

function wrapTitle(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  const pieces = words.length > 1 ? words : Array.from(text);
  let line = "";
  const joiner = words.length > 1 ? " " : "";
  for (const piece of pieces) {
    const next = line ? line + joiner + piece : piece;
    if (line && next.length > maxChars) {
      lines.push(line);
      line = piece;
    } else {
      line = next;
    }
    if (lines.length === 3) break;
  }
  if (line && lines.length < 3) lines.push(line);
  return lines;
}

/** Generate a branded SVG OG image for social sharing. */
export function handleOgImage(url: URL, host: string): Response {
  const title = url.searchParams.get("title") || "";
  const displayTitle = title.length > 80 ? title.slice(0, 79) + "\u2026" : title;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const lines = displayTitle ? wrapTitle(displayTitle, 28) : ["Any web page, read as Markdown"];
  const titleLines = lines
    .map((l, i) => `<text x="72" y="${220 + i * 64}" font-family="system-ui, sans-serif" font-size="46" font-weight="600" fill="#1c2128">${esc(l)}</text>`)
    .join("\n    ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f3f4f6"/>
  <rect x="0" y="0" width="10" height="630" fill="#1b4f8a"/>
  <text x="72" y="92" font-family="system-ui, sans-serif" font-size="22" font-weight="600" fill="#1c2128">${esc(host)}</text>
  ${titleLines}
  <text x="72" y="574" font-family="system-ui, sans-serif" font-size="16" fill="#5c6573">URL to Markdown</text>
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
