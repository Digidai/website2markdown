import { describe, expect, it } from "vitest";
import { landingPageHTML } from "../templates/landing";
import { renderedPageHTML } from "../templates/rendered";
import { loadingPageHTML } from "../templates/loading";
import { errorPageHTML } from "../templates/error";

describe("templates", () => {
  it("escapes host in landing page", () => {
    const html = landingPageHTML('md.example.com"><script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("POST /api/deepcrawl");
    const docs = landingPageHTML('md.example.com"><script>alert(1)</script>', "en", "docs");
    expect(docs).toContain("GET /api/stream");
    expect(docs).toContain("POST /api/deepcrawl");
    expect(docs).toContain('curl -H "Accept: text/markdown" https://md.example.com');
    expect(docs).not.toContain('<script>alert(1)</script>');
  });

  it("renders Chinese landing page when lang is zh", () => {
    const html = landingPageHTML("md.example.com", "zh");
    expect(html).toContain('href="/?lang=zh"');
    expect(html).toContain('class="lang-link active" href="/?lang=zh"');
    expect(html).toContain("任意 URL 转");
    expect(html).toContain("转换");
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain("任务编排和 Deep Crawl");
    expect(html).not.toContain("id=\"tab-docs\"");
    const docs = landingPageHTML("md.example.com", "zh", "docs");
    expect(docs).toContain("/api/extract");
    expect(docs).toContain("/api/jobs");
    expect(docs).toContain("/api/deepcrawl");
    expect(docs).toContain("PUBLIC_API_TOKEN");
  });

  it("escapes title and message in error page", () => {
    const html = errorPageHTML("Oops <b>x</b>", 'Bad "msg" <img src=x>');
    expect(html).toContain("Oops &lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("Bad &quot;msg&quot; &lt;img src=x&gt;");
    expect(html).not.toContain("<img src=x>");
  });

  it("renders loading page with encoded stream URL config", () => {
    const html = loadingPageHTML(
      "md.example.com",
      "https://example.com/path?q=<x>",
      "&selector=.main",
      "/https%3A%2F%2Fexample.com%2Fpath%3Fq%3D%3Cx%3E?raw=true&selector=.main&engine=jina",
    );
    expect(html).toContain("/api/stream?url=");
    expect(html).toContain('/https%3A%2F%2Fexample.com%2Fpath%3Fq%3D%3Cx%3E?raw=true&selector=.main&engine=jina');
    expect(html).toContain("\\u003c");
    expect(html).toContain("selector=.main");
    expect(html).toContain("C.rawRequestPath");
  });

  it("escapes rendered content and metadata", () => {
    const html = renderedPageHTML(
      "md.example.com",
      '# title\n\n<script>alert("x")</script>',
      'https://example.com/"x"',
      "123",
      "fallback",
      true,
      'Art "Title"',
      '/https%3A%2F%2Fexample.com%2F%22x%22?raw=true&selector=.main',
    );
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("Art &quot;Title&quot;");
    expect(html).toContain('content="noindex, follow"');
    expect(html).toContain('rel="canonical" href="https://example.com/&quot;x&quot;"');
    expect(html).toContain("CACHED");
    expect(html).toContain('/https%3A%2F%2Fexample.com%2F%22x%22?raw=true&amp;selector=.main');
    expect(html).not.toContain('<script>alert("x")</script>');
  });
});
