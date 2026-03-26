import { CORS_HEADERS } from "../config";

export function handleRobotsTxt(): Response {
  const content = `User-agent: *
Allow: /
Allow: /llms.txt
Allow: /.well-known/llms.txt
Allow: /api/health
Disallow: /api/batch
Disallow: /api/extract
Disallow: /api/deepcrawl
Disallow: /api/jobs
Disallow: /api/stream
Disallow: /r2img/
Disallow: /img/

# AI crawlers — welcome on public pages, same Disallow rules apply

Sitemap: https://md.genedai.me/sitemap.xml
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
