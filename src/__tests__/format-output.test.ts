import { describe, it, expect } from "vitest";
import { formatOutput } from "../helpers/format";

const SAMPLE = {
  markdown: "# Hello\n\nThis is **bold** and *italic*.",
  url: "https://example.com/post/123",
  title: "Test Article",
  method: "readability+turndown" as const,
};

describe("formatOutput", () => {
  it("returns markdown as-is when format is 'markdown'", () => {
    const result = formatOutput(SAMPLE.markdown, "markdown", SAMPLE.url, SAMPLE.title, SAMPLE.method);
    expect(result).toBe(SAMPLE.markdown);
  });

  it("converts to HTML when format is 'html'", () => {
    const result = formatOutput(SAMPLE.markdown, "html", SAMPLE.url, SAMPLE.title, SAMPLE.method);
    expect(result).toMatch(/^<pre>.*<\/pre>$/s);
    expect(result).not.toContain("<h1>");
    expect(result).toContain("# Hello");
  });

  it("converts to plain text when format is 'text'", () => {
    const result = formatOutput(SAMPLE.markdown, "text", SAMPLE.url, SAMPLE.title, SAMPLE.method);
    expect(result).not.toContain("#");
    expect(result).not.toContain("**");
    expect(result).not.toContain("*italic*");
    expect(result).toContain("Hello");
    expect(result).toContain("bold");
    expect(result).toContain("italic");
  });

  it("returns JSON with content and metadata when format is 'json'", () => {
    const result = formatOutput(SAMPLE.markdown, "json", SAMPLE.url, SAMPLE.title, SAMPLE.method);
    const parsed = JSON.parse(result);
    expect(parsed.url).toBe(SAMPLE.url);
    expect(parsed.title).toBe(SAMPLE.title);
    expect(parsed.markdown).toBe(SAMPLE.markdown);
    expect(parsed.method).toBe(SAMPLE.method);
    expect(parsed.timestamp).toBeDefined();
    expect(() => new Date(parsed.timestamp)).not.toThrow();
  });
});
