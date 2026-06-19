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
      origin: "md-genedai@1.0.0",
    });
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
