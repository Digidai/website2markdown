import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));

import { handleRobotsTxt, handleSitemap } from "../handlers/seo";

describe("SEO handlers", () => {
  it("robots.txt returns correct content", () => {
    const res = handleRobotsTxt();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    return res.text().then(body => {
      expect(body).toContain("User-agent: *");
      expect(body).toContain("Disallow: /api/batch");
      expect(body).toContain("Sitemap:");
      expect(body).toContain("Allow: /llms.txt");
    });
  });

  it("sitemap.xml returns valid XML", () => {
    const res = handleSitemap("md.genedai.me");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    return res.text().then(body => {
      expect(body).toContain('<?xml version="1.0"');
      expect(body).toContain("<loc>https://md.genedai.me/</loc>");
      expect(body).toContain('hreflang="zh"');
      expect(body).toContain("llms.txt");
    });
  });
});
