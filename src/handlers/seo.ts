import { CORS_HEADERS } from "../config";

const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "Amazonbot",
  "CCBot",
  "Bytespider",
  "Meta-ExternalAgent",
  "cohere-ai",
];

export function handleRobotsTxt(host = "md.genedai.me"): Response {
  const rules = `Allow: /
Allow: /llms.txt
Allow: /.well-known/llms.txt
Allow: /api/health
Disallow: /api/batch
Disallow: /api/extract
Disallow: /api/deepcrawl
Disallow: /api/jobs
Disallow: /api/stream
Disallow: /portal
Disallow: /admin
Disallow: /r2img/
Disallow: /img/`;
  const groups = ["*", ...AI_CRAWLERS]
    .map((agent) => `User-agent: ${agent}\n${rules}`)
    .join("\n\n");
  const content = `${groups}

# Converted pages are reading views of other sites. They send noindex.
# Cite the source URL, not this host.

Sitemap: https://${host}/sitemap.xml
`;
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      ...CORS_HEADERS,
    },
  });
}

export function handleSitemap(host: string): Response {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://${host}/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://${host}/"/>
    <xhtml:link rel="alternate" hreflang="zh" href="https://${host}/?lang=zh"/>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://${host}/?lang=zh</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://${host}/examples</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://${host}/examples"/>
    <xhtml:link rel="alternate" hreflang="zh" href="https://${host}/examples?lang=zh"/>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://${host}/docs</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://${host}/docs"/>
    <xhtml:link rel="alternate" hreflang="zh" href="https://${host}/docs?lang=zh"/>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://${host}/integrations</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://${host}/integrations"/>
    <xhtml:link rel="alternate" hreflang="zh" href="https://${host}/integrations?lang=zh"/>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://${host}/llms.txt</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>`;
  return new Response(content, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      ...CORS_HEADERS,
    },
  });
}
