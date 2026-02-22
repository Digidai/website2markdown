import { describe, expect, it, vi } from "vitest";
import { htmlToMarkdown, htmlToText, proxyImageUrls } from "../converter";

describe("converter edge behavior", () => {
  it("returns empty result for empty html input", () => {
    const result = htmlToMarkdown("", "https://example.com");
    expect(result).toEqual({
      markdown: "",
      title: "",
      contentHtml: "",
    });
  });

  it("falls back to full-page extraction when selector is invalid", () => {
    const html = "<html><body><h1>Main Title</h1><p>Main body</p></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://example.com", "div[");
    expect(markdown).toContain("Main Title");
    expect(markdown).toContain("Main body");
  });

  it("keeps selected node outer html when selector points to an empty element", () => {
    const html = "<html><head><title>Only Title</title></head><body><div id=\"empty\"></div></body></html>";
    const result = htmlToMarkdown(html, "https://example.com", "#empty");
    expect(result.title).toBe("Only Title");
    expect(result.markdown).toContain("# Only Title");
    expect(result.markdown).toContain("<div id=\"empty\"></div>");
    expect(result.contentHtml).toBe("<div id=\"empty\"></div>");
  });

  it("converts simple tables and escapes cell separators/newlines", () => {
    const html = `
      <html><body>
        <table>
          <tr><th>Name</th><th>Notes</th></tr>
          <tr><td>Alice</td><td>hello|world\nline2</td></tr>
        </table>
      </body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://example.com");
    expect(markdown).toContain("| Name | Notes |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("hello\\|world line2");
  });

  it("handles nested tables without crashing conversion", () => {
    const html = `
      <html><body>
        <table>
          <tr>
            <td>
              <table>
                <tr><th>Inner</th></tr>
                <tr><td>Value</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </body></html>`;
    const { markdown } = htmlToMarkdown(html, "https://example.com", "body");
    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown).toContain("Inner");
  });

  it("does not duplicate title heading when markdown already starts with same title", () => {
    const html = "<html><head><title>Doc</title></head><body><h1>Doc</h1><p>Body</p></body></html>";
    const { markdown } = htmlToMarkdown(html, "https://example.com");
    const headingMatches = markdown.match(/^#\s+Doc/gm) || [];
    expect(headingMatches.length).toBe(1);
  });

  it("clamps long markdown lines when converting to plain text", () => {
    const long = "a".repeat(25_000);
    const html = `<html><head><title>T</title></head><body><p>${long}</p></body></html>`;
    const text = htmlToText(html, "https://example.com");

    const lines = text.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20_000);
    }
    expect(text).toContain("T");
  });

  it("returns empty text when markdown extraction is empty", () => {
    const text = htmlToText("", "https://example.com");
    expect(text).toBe("");
  });

  it("rewrites multiple WeChat images while keeping non-WeChat urls unchanged", () => {
    const markdown = [
      "![a](https://mmbiz.qpic.cn/mmbiz_png/a1/640)",
      "![b](https://example.com/normal.png)",
      "![c](https://mmbiz.qpic.cn/mmbiz_jpg/a2/640)",
    ].join("\n");
    const result = proxyImageUrls(markdown, "md.example.com");

    expect(result).toContain(encodeURIComponent("https://mmbiz.qpic.cn/mmbiz_png/a1/640"));
    expect(result).toContain(encodeURIComponent("https://mmbiz.qpic.cn/mmbiz_jpg/a2/640"));
    expect(result).toContain("https://example.com/normal.png");
  });
});

describe("converter fallback on parser failure", () => {
  it("returns fallback markdown when parser throws", async () => {
    vi.resetModules();
    vi.doMock("linkedom", async () => {
      const actual = await vi.importActual<typeof import("linkedom")>("linkedom");
      return {
        ...actual,
        parseHTML: vi.fn(() => {
          throw new Error("parse failed");
        }),
      };
    });

    try {
      const { htmlToMarkdown: mockedHtmlToMarkdown } = await import("../converter");
      const result = mockedHtmlToMarkdown("  <div>raw-fallback</div>  ", "https://example.com");

      expect(result.markdown).toBe("<div>raw-fallback</div>");
      expect(result.contentHtml).toBe("  <div>raw-fallback</div>  ");
    } finally {
      vi.doUnmock("linkedom");
      vi.resetModules();
    }
  });
});
