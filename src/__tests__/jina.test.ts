import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchViaJina } from "../jina";

describe("fetchViaJina", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns markdown and title on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        data: {
          url: "https://example.com",
          title: "Example Title",
          content: "# Hello World\n\nThis is the content.",
        },
      }),
    });

    const result = await fetchViaJina("https://example.com");

    expect(result.markdown).toBe("# Hello World\n\nThis is the content.");
    expect(result.title).toBe("Example Title");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://r.jina.ai/https://example.com",
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("returns empty title when not provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        data: { url: "https://example.com", title: "", content: "Some content" },
      }),
    });

    const result = await fetchViaJina("https://example.com");
    expect(result.title).toBe("");
    expect(result.markdown).toBe("Some content");
  });

  it("throws on 429 rate limit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    });

    await expect(fetchViaJina("https://example.com")).rejects.toThrow(
      "Jina Reader rate limited (429)",
    );
  });

  it("throws on non-200 errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    await expect(fetchViaJina("https://example.com")).rejects.toThrow(
      "Jina Reader returned HTTP 503",
    );
  });

  it("throws on empty content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        data: { url: "https://example.com", title: "Title", content: "" },
      }),
    });

    await expect(fetchViaJina("https://example.com")).rejects.toThrow(
      "Jina Reader returned empty content",
    );
  });

  it("throws on null data.content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        data: { url: "https://example.com", title: "Title" },
      }),
    });

    await expect(fetchViaJina("https://example.com")).rejects.toThrow(
      "Jina Reader returned empty content",
    );
  });

  it("handles timeout via AbortSignal", async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        if (init?.signal?.aborted) {
          onAbort();
          return;
        }
        init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
    });

    // Use a very short timeout to trigger abort
    await expect(fetchViaJina("https://example.com", 1)).rejects.toThrow(
      "Jina Reader timed out",
    );
  });

  it("throws 'Request aborted' when caller signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
      });
    });

    await expect(
      fetchViaJina("https://example.com", 15_000, controller.signal),
    ).rejects.toThrow("Request aborted");
  });
});

describe("engine=jina integration", () => {
  it("extractTargetUrl strips engine param", async () => {
    const { extractTargetUrl } = await import("../security");
    const result = extractTargetUrl("/https://example.com", "?engine=jina&foo=bar");
    expect(result).toBe("https://example.com?foo=bar");
    expect(result).not.toContain("engine");
  });

  it("extractTargetUrl strips engine param when it is the only param", async () => {
    const { extractTargetUrl } = await import("../security");
    const result = extractTargetUrl("/https://example.com", "?engine=jina");
    expect(result).toBe("https://example.com");
  });
});
