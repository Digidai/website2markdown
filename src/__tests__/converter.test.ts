import { describe, it, expect } from "vitest";
import { htmlToMarkdown, htmlToText, proxyImageUrls } from "../converter";

describe("htmlToMarkdown", () => {
  it("converts simple HTML to markdown", () => {
    const html = "<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p></body></html>";
    const { markdown, title } = htmlToMarkdown(html, "https://example.com");
    expect(title).toBe("Test");
    expect(markdown).toContain("Hello");
    expect(markdown).toContain("World");
  });

  it("handles HTML fragments (no <html> tag)", () => {
    const html = "<h1>Title</h1><p>Content</p>";
    const { markdown } = htmlToMarkdown(html, "https://example.com");
    expect(markdown).toContain("Title");
    expect(markdown).toContain("Content");
  });

  it("converts links preserving href", () => {
    const html = '<html><body><p><a href="/relative">Link</a></p></body></html>';
    const { markdown } = htmlToMarkdown(html, "https://example.com");
    expect(markdown).toContain("[Link]");
    // linkedom/Readability may not resolve relative links in all cases
    expect(markdown).toContain("/relative");
  });

  it("converts headings to ATX style", () => {
    const html = "<html><body><h1>H1</h1><h2>H2</h2><h3>H3</h3></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://example.com");
    expect(markdown).toContain("# H1");
    expect(markdown).toContain("## H2");
    expect(markdown).toContain("### H3");
  });

  it("converts code blocks with fences", () => {
    const html = '<html><body><pre><code>const x = 1;</code></pre></body></html>';
    const { markdown } = htmlToMarkdown(html, "https://example.com");
    expect(markdown).toContain("```");
    expect(markdown).toContain("const x = 1;");
  });

  it("converts strikethrough", () => {
    const html = "<html><body><p><del>deleted</del> and <s>struck</s></p></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://example.com");
    expect(markdown).toContain("~~deleted~~");
    expect(markdown).toContain("~~struck~~");
  });

  it("extracts only selected element when selector provided", () => {
    const html = `<html><body>
      <div class="sidebar">Sidebar noise</div>
      <div class="article"><h1>Article</h1><p>Content</p></div>
    </body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://example.com", ".article");
    expect(markdown).toContain("Article");
    expect(markdown).toContain("Content");
    expect(markdown).not.toContain("Sidebar noise");
  });

  it("returns contentHtml from Readability extraction", () => {
    const html = `<html><head><title>Test</title></head><body>
      <article><h1>Main</h1><p>Body text here</p></article>
      <footer>footer noise</footer>
    </body></html>`;
    const { contentHtml } = htmlToMarkdown(html, "https://example.com");
    expect(contentHtml).toContain("Body text");
    expect(typeof contentHtml).toBe("string");
  });
});

describe("htmlToText", () => {
  it("strips markdown formatting", () => {
    const html = "<html><body><h1>Title</h1><p>**bold** text</p></body></html>";
    const text = htmlToText(html, "https://example.com");
    expect(text).not.toContain("# ");
    expect(text).toContain("Title");
  });

  it("respects selector scoping", () => {
    const html = `<html><body>
      <div class="sidebar">Sidebar text</div>
      <article class="main"><h1>Main</h1><p>Body</p></article>
    </body></html>`;
    const text = htmlToText(html, "https://example.com", ".main");
    expect(text).toContain("Main");
    expect(text).toContain("Body");
    expect(text).not.toContain("Sidebar text");
  });
});

describe("proxyImageUrls", () => {
  it("rewrites WeChat image URLs", () => {
    const md = "![alt](https://mmbiz.qpic.cn/mmbiz_jpg/abc123/640)";
    const result = proxyImageUrls(md, "md.example.com");
    expect(result).toContain("md.example.com/img/");
    expect(result).toContain(encodeURIComponent("https://mmbiz.qpic.cn/mmbiz_jpg/abc123/640"));
  });

  it("does not rewrite non-WeChat images", () => {
    const md = "![alt](https://example.com/image.jpg)";
    const result = proxyImageUrls(md, "md.example.com");
    expect(result).toBe(md);
  });
});
