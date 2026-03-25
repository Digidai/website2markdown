import { describe, it, expect, vi, afterEach } from "vitest";
import { convertUrl, buildApiUrl, buildHeaders } from "../../packages/mcp/src/convert";

describe("MCP Server — buildApiUrl", () => {
  it("builds URL with default API base and markdown format", () => {
    const url = buildApiUrl({ url: "https://example.com/page" });
    expect(url).toBe(
      "https://md.genedai.me/https%3A%2F%2Fexample.com%2Fpage?format=markdown"
    );
  });

  it("builds URL with custom API base", () => {
    const url = buildApiUrl({
      url: "https://example.com",
      apiUrl: "https://custom.api.dev",
    });
    expect(url).toContain("https://custom.api.dev/");
  });

  it("includes selector parameter when provided", () => {
    const url = buildApiUrl({
      url: "https://example.com",
      selector: "article.main",
    });
    expect(url).toContain("selector=article.main");
  });

  it("includes force_browser parameter when true", () => {
    const url = buildApiUrl({
      url: "https://example.com",
      force_browser: true,
    });
    expect(url).toContain("force_browser=true");
  });

  it("uses specified format", () => {
    const url = buildApiUrl({
      url: "https://example.com",
      format: "json",
    });
    expect(url).toContain("format=json");
  });
});

describe("MCP Server — buildHeaders", () => {
  it("includes Accept header", () => {
    const headers = buildHeaders();
    expect(headers.Accept).toBe("text/markdown");
  });

  it("includes Authorization header when token provided", () => {
    const headers = buildHeaders("my-secret-token");
    expect(headers.Authorization).toBe("Bearer my-secret-token");
  });

  it("omits Authorization header when no token", () => {
    const headers = buildHeaders();
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("MCP Server — convertUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // Test 1: convert_url tool returns markdown for a valid URL
  it("returns markdown content for a valid URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# Hello World\n\nThis is content.",
    } as unknown as Response);

    const result = await convertUrl({
      url: "https://example.com/article",
      apiUrl: "https://md.genedai.me",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("# Hello World\n\nThis is content.");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://md.genedai.me/https%3A%2F%2Fexample.com%2Farticle"),
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "text/markdown" }),
      })
    );
  });

  // Test 2: convert_url tool handles API errors (500, 429, 401)
  it("handles API 500 server error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as unknown as Response);

    const result = await convertUrl({ url: "https://example.com" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error 500");
    expect(result.content[0].text).toContain("Internal Server Error");
  });

  it("handles API 429 rate limit error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    } as unknown as Response);

    const result = await convertUrl({ url: "https://example.com" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error 429");
    expect(result.content[0].text).toContain("Rate limit exceeded");
  });

  it("handles API 401 auth failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as unknown as Response);

    const result = await convertUrl({
      url: "https://example.com",
      apiToken: "bad-token",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error 401");
    expect(result.content[0].text).toContain("Unauthorized");

    // Verify token was sent in headers
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer bad-token" }),
      })
    );
  });

  // Test 3: convert_url tool with format=json
  it("passes format=json to the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"title":"Test","markdown":"# Test"}',
    } as unknown as Response);

    const result = await convertUrl({
      url: "https://example.com",
      format: "json",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('{"title":"Test","markdown":"# Test"}');

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("format=json");
  });

  // Test 4: convert_url tool with selector parameter
  it("passes selector parameter to the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# Selected Content",
    } as unknown as Response);

    const result = await convertUrl({
      url: "https://example.com",
      selector: "article.main",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("# Selected Content");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("selector=article.main");
  });

  // Test 5: convert_url tool with force_browser=true
  it("passes force_browser=true to the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# Browser Rendered",
    } as unknown as Response);

    const result = await convertUrl({
      url: "https://spa-app.com/page",
      force_browser: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("# Browser Rendered");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("force_browser=true");
  });

  // Test 6: convert_url tool handles network timeout
  it("handles network timeout gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("The operation was aborted due to timeout"));

    const result = await convertUrl({ url: "https://slow-site.com" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to convert URL");
    expect(result.content[0].text).toContain("timeout");
  });

  // Test 7: convert_url tool with custom API URL env var
  it("uses custom API URL from options", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# Custom API",
    } as unknown as Response);

    const result = await convertUrl({
      url: "https://example.com",
      apiUrl: "https://custom-api.example.dev",
    });

    expect(result.isError).toBeUndefined();

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://custom-api.example.dev/")).toBe(true);
    expect(calledUrl).not.toContain("md.genedai.me");
  });
});
