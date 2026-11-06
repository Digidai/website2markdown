import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaFirecrawl } from "../firecrawl";

describe("fetchViaFirecrawl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses keyless mode by omitting Authorization when no API key is configured", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: {
          markdown: "# Firecrawl\n\nContent",
          metadata: { title: "Firecrawl Title" },
        },
      }),
    );

    const result = await fetchViaFirecrawl("https://example.com");

    expect(result).toEqual({
      markdown: "# Firecrawl\n\nContent",
      title: "Firecrawl Title",
    });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(init.body)).toMatchObject({
      url: "https://example.com",
      formats: ["markdown"],
      excludeTags: ["script", "style"],
      origin: "md-genedai@1.0.0",
    });
  });

  it("drops a leading speculation-rules block that Firecrawl leaks as text", async () => {
    // Shape copied from a production Home Depot response.
    const leaked = [
      "{",
      ' "prefetch": \\[\\',
      " {\\",
      ' "where": {"and": \\[\\',
      ' {"href\\_matches": "/\\*"},\\',
      ' { "not": { "href\\_matches": "/cart" } }\\',
      " \\]},\\",
      ' "eagerness": "moderate"\\',
      " }\\",
      " \\]",
      " }",
      "",
      "",
      "",
    ].join("\n");
    const body = "HDX Scouring Pad - The Home Depot\n\n```json\n{\n}\n```";
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ success: true, data: { markdown: leaked + body } }),
    );

    const result = await fetchViaFirecrawl("https://www.homedepot.com/p/1");

    expect(result.markdown).toBe(body);
  });

  // Line copied from production Home Depot responses (2026-11-06).
  const referrer = 'Object.defineProperty(document, "referrer", {get : function(){ return "https://www.google.com/"; }})';

  it.each([
    ["alone", `${referrer}\n\n\n\n\n `],
    ["after the speculation rules", `{"prefetch": \\[{"where": {"href\\_matches": "/\\*"}}\\]}\n\n${referrer}\n\n`],
    ["before the speculation rules", `${referrer}\n\n{"prefetch": \\[{"where": {"href\\_matches": "/\\*"}}\\]}\n\n`],
  ])("drops a leading referrer override %s", async (_, leaked) => {
    const body = "HDX Scouring Pad - The Home Depot\n\n[Specials & Offers](https://www.homedepot.com/c/Savings_Center)";
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ success: true, data: { markdown: leaked + body } }),
    );

    const result = await fetchViaFirecrawl("https://www.homedepot.com/p/1");

    expect(result.markdown).toBe(body);
  });

  it("keeps a referrer override that is part of the page", async () => {
    const markdown = `# Faking document.referrer\n\nRun this before the page script:\n\n${referrer}\n`;
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ success: true, data: { markdown } }),
    );

    const result = await fetchViaFirecrawl("https://example.com");

    expect(result.markdown).toBe(markdown);
  });

  it("stops at the rules' own closing brace when they are on one line", async () => {
    const leaked = '{"prerender": \\[{"where": {"href\\_matches": "/\\*"}}\\]} ';
    const body = "# Title\n\nIntro\n\n```json\n{\n \"a\": 1\n}\n```\n\nEnd";
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ success: true, data: { markdown: leaked + body } }),
    );

    const result = await fetchViaFirecrawl("https://example.com");

    expect(result.markdown).toBe(body);
  });

  it.each([
    '{\n "prefetch": false,\n "name": "Configuration reference"\n}\n\nBody',
    '{\n "prefetch": \\[\\\n "a", "b"\\\n \\]\n}\n\nBody',
  ])("keeps a page that starts with ordinary JSON: %s", async (markdown) => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({ success: true, data: { markdown } }),
    );

    const result = await fetchViaFirecrawl("https://example.com");

    expect(result.markdown).toBe(markdown);
  });

  it("sends Authorization when an API key is configured", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: { markdown: "ok", title: "Title" },
      }),
    );

    await fetchViaFirecrawl(
      "https://example.com",
      { apiKey: "fc-test-key" },
    );

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer fc-test-key",
    });
  });

  it("throws a clear error for keyless upstream blocks", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          success: false,
          error: "Unfortunately, your IP address looks suspicious.",
        },
        { status: 403 },
      ),
    );

    await expect(fetchViaFirecrawl("https://example.com")).rejects.toThrow(
      "Firecrawl returned HTTP 403",
    );
  });

  it("throws on empty markdown responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: { markdown: "" },
      }),
    );

    await expect(fetchViaFirecrawl("https://example.com")).rejects.toThrow(
      "Firecrawl returned empty markdown",
    );
  });
});
