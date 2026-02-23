import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithSafeRedirects } from "../security";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchWithSafeRedirects resilience", () => {
  it("retries idempotent request on transient network error and succeeds", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network reset"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchWithSafeRedirects(
      "https://example.com/resource",
      {},
      5,
      { maxRetries: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    );

    expect(result.response.status).toBe(200);
    expect(result.finalUrl).toBe("https://example.com/resource");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("fails after exceeding retry limit on repeated network errors", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("network down"));

    vi.stubGlobal("fetch", mockFetch);

    await expect(
      fetchWithSafeRedirects(
        "https://example.com/resource",
        {},
        5,
        { maxRetries: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
      ),
    ).rejects.toThrow("network down");

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("retries 429 and 5xx responses for idempotent requests", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchWithSafeRedirects(
      "https://example.com/retry",
      { method: "GET" },
      5,
      { maxRetries: 3, retryDelayMs: 0, maxRetryDelayMs: 0 },
    );

    expect(result.response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-idempotent requests", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchWithSafeRedirects(
      "https://example.com/post",
      { method: "POST", body: "x=1" },
      5,
      { maxRetries: 3, retryDelayMs: 0, maxRetryDelayMs: 0 },
    );

    expect(result.response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("blocks unsafe redirect targets on every hop (SSRF cannot be bypassed)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://safe.example/path" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/admin" },
        }),
      );

    vi.stubGlobal("fetch", mockFetch);

    await expect(
      fetchWithSafeRedirects(
        "https://example.com/start",
        {},
        5,
        { maxRetries: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
      ),
    ).rejects.toThrow("Redirect target blocked by SSRF protection");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const calledUrls = mockFetch.mock.calls.map((call) => call[0] as string);
    expect(calledUrls).toEqual([
      "https://example.com/start",
      "https://safe.example/path",
    ]);
    expect(calledUrls).not.toContain("http://127.0.0.1/admin");
  });

  it("aborts retry backoff immediately when signal is canceled", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const mockFetch = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
      vi.stubGlobal("fetch", mockFetch);

      const run = fetchWithSafeRedirects(
        "https://example.com/retry-abort",
        { method: "GET", signal: controller.signal },
        5,
        { maxRetries: 3, retryDelayMs: 1000, maxRetryDelayMs: 1000 },
      );

      await Promise.resolve();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      controller.abort();
      await expect(run).rejects.toThrow("aborted");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
