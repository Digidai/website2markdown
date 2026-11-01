import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));

import { handleRobotsTxt, handleSitemap } from "../handlers/seo";
import worker from "../index";
import { createMockEnv, mockCtx } from "./test-helpers";

describe("SEO handlers", () => {
  it("robots.txt returns correct content", () => {
    const res = handleRobotsTxt();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    return res.text().then(body => {
      expect(body).toContain("User-agent: *");
      expect(body).toContain("User-agent: GPTBot");
      expect(body).toContain("User-agent: ClaudeBot");
      expect(body).toContain("Disallow: /api/batch");
      expect(body).toContain("Sitemap: https://mdget.dev/sitemap.xml");
      expect(body).toContain("Allow: /llms.txt");
      const hosted = handleRobotsTxt("md.example.com");
      return hosted.text().then(next => {
        expect(next).toContain("Sitemap: https://md.example.com/sitemap.xml");
      });
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

  it("names mdget.dev as canonical on the old domain and keeps other hosts", async () => {
    const { env } = createMockEnv();
    const page = async (url: string) => (await worker.fetch(new Request(url), env, mockCtx())).text();
    const legacy = await page("https://md.genedai.me/docs");
    expect(legacy).toContain('<link rel="canonical" href="https://mdget.dev/docs">');
    expect(legacy).not.toContain("https://md.genedai.me/");
    expect(await page("https://md.genedai.me/robots.txt")).toContain("Sitemap: https://mdget.dev/sitemap.xml");
    // A self-hosted deployment keeps its own domain.
    expect(await page("https://md.example.com/docs")).toContain('<link rel="canonical" href="https://md.example.com/docs">');
  });
});
