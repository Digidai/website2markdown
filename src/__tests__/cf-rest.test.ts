import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchViaCfMarkdown,
  fetchViaCfContent,
  submitCfCrawlJob,
  getCfCrawlResults,
  cancelCfCrawlJob,
  type CfRestConfig,
} from "../cf-rest";

const ACCOUNT_ID = "test-account-id";
const API_TOKEN = "test-api-token";
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/browser-rendering`;

function cfg(overrides?: Partial<CfRestConfig>): CfRestConfig {
  return { accountId: ACCOUNT_ID, apiToken: API_TOKEN, ...overrides };
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("fetchViaCfMarkdown", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns markdown on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: "# Hello\n\nWorld" }),
    );

    const result = await fetchViaCfMarkdown("https://example.com", cfg());

    expect(result.markdown).toBe("# Hello\n\nWorld");
    expect(result.browserMsUsed).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BASE}/markdown`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("parses x-browser-ms-used header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        { success: true, result: "# Page" },
        200,
        { "x-browser-ms-used": "1234" },
      ),
    );

    const result = await fetchViaCfMarkdown("https://example.com", cfg(), { render: true });
    expect(result.browserMsUsed).toBe(1234);
  });

  it("sends render option in body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: "md" }),
    );

    await fetchViaCfMarkdown("https://example.com", cfg(), { render: false });

    const callBody = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(callBody.render).toBe(false);
    expect(callBody.url).toBe("https://example.com");
  });

  it("sends optional parameters when provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: "md" }),
    );

    await fetchViaCfMarkdown("https://example.com", cfg(), {
      waitForSelector: "#main",
      userAgent: "custom-ua",
      rejectResourceTypes: ["image"],
      gotoOptions: { waitUntil: "networkidle0" },
    });

    const callBody = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(callBody.waitForSelector).toBe("#main");
    expect(callBody.userAgent).toBe("custom-ua");
    expect(callBody.rejectResourceTypes).toEqual(["image"]);
    expect(callBody.gotoOptions).toEqual({ waitUntil: "networkidle0" });
  });

  it("returns empty string when result is null", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: null }),
    );

    const result = await fetchViaCfMarkdown("https://example.com", cfg());
    expect(result.markdown).toBe("");
  });

  it("throws on 429 rate limit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: "rate limited" }, 429),
    );

    await expect(
      fetchViaCfMarkdown("https://example.com", cfg()),
    ).rejects.toThrow("CF /markdown rate limited (429)");
  });

  it("throws on 500 server error with detail", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => "Internal Server Error",
      json: async () => ({}),
    } as unknown as Response);

    await expect(
      fetchViaCfMarkdown("https://example.com", cfg()),
    ).rejects.toThrow("CF /markdown returned HTTP 500: Internal Server Error");
  });

  it("throws on 403 forbidden", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: "forbidden" }, 403),
    );

    await expect(
      fetchViaCfMarkdown("https://example.com", cfg()),
    ).rejects.toThrow("CF /markdown returned HTTP 403");
  });

  it("throws timeout error when fetch times out", async () => {
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

    await expect(
      fetchViaCfMarkdown("https://example.com", cfg({ timeoutMs: 1 })),
    ).rejects.toThrow("CF /markdown timed out");
  });

  it("throws 'Request aborted' when caller signal is already aborted", async () => {
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
      fetchViaCfMarkdown("https://example.com", cfg(), { signal: controller.signal }),
    ).rejects.toThrow("Request aborted");
  });

  it("uses CF_REST_TIMEOUT_MS default when timeoutMs not set", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: "ok" }),
    );

    // Should not throw — just verify it completes with default timeout
    const result = await fetchViaCfMarkdown("https://example.com", cfg());
    expect(result.markdown).toBe("ok");
  });
});

describe("fetchViaCfContent", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns HTML on success", async () => {
    const html = "<html><body><h1>Hello</h1></body></html>";
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: html }),
    );

    const result = await fetchViaCfContent("https://example.com", cfg());

    expect(result).toBe(html);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BASE}/content`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends render option", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: "<html></html>" }),
    );

    await fetchViaCfContent("https://example.com", cfg(), { render: false });

    const callBody = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(callBody.render).toBe(false);
  });

  it("returns empty string when result is null", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: null }),
    );

    const result = await fetchViaCfContent("https://example.com", cfg());
    expect(result).toBe("");
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: "bad request" }, 400),
    );

    await expect(
      fetchViaCfContent("https://example.com", cfg()),
    ).rejects.toThrow("CF /content returned HTTP 400");
  });

  it("throws timeout error", async () => {
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

    await expect(
      fetchViaCfContent("https://example.com", cfg({ timeoutMs: 1 })),
    ).rejects.toThrow("CF /content timed out");
  });
});

describe("submitCfCrawlJob", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns job ID on success", async () => {
    const jobId = "c7f8s2d9-a8e7-4b6e-8e4d-3d4a1b2c3f4e";
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: jobId }),
    );

    const result = await submitCfCrawlJob("https://example.com", cfg());

    expect(result).toBe(jobId);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BASE}/crawl`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("passes all options correctly", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: "job-123" }),
    );

    await submitCfCrawlJob("https://example.com", cfg(), {
      limit: 50,
      depth: 2,
      formats: ["markdown"],
      render: false,
      includePatterns: ["**/api/*"],
      excludePatterns: ["*/admin/*"],
      includeExternalLinks: true,
      includeSubdomains: false,
    });

    const callBody = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(callBody.url).toBe("https://example.com");
    expect(callBody.limit).toBe(50);
    expect(callBody.depth).toBe(2);
    expect(callBody.formats).toEqual(["markdown"]);
    expect(callBody.render).toBe(false);
    expect(callBody.options).toEqual({
      includePatterns: ["**/api/*"],
      excludePatterns: ["*/admin/*"],
      includeExternalLinks: true,
      includeSubdomains: false,
    });
  });

  it("omits options object when no crawl options specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: "job-123" }),
    );

    await submitCfCrawlJob("https://example.com", cfg(), { limit: 10 });

    const callBody = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(callBody.options).toBeUndefined();
    expect(callBody.limit).toBe(10);
  });

  it("throws on empty job ID", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, result: "" }),
    );

    await expect(
      submitCfCrawlJob("https://example.com", cfg()),
    ).rejects.toThrow("CF /crawl POST returned empty job ID");
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: "unauthorized" }, 401),
    );

    await expect(
      submitCfCrawlJob("https://example.com", cfg()),
    ).rejects.toThrow("CF /crawl POST returned HTTP 401");
  });
});

describe("getCfCrawlResults", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns parsed crawl results", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          id: "job-123",
          status: "completed",
          browserSecondsUsed: 42.5,
          total: 10,
          finished: 10,
          records: [
            {
              url: "https://example.com/",
              status: "completed",
              markdown: "# Example",
              metadata: { status: 200, title: "Example", url: "https://example.com/" },
            },
            {
              url: "https://example.com/about",
              status: "completed",
              markdown: "# About",
              metadata: { status: 200, title: "About", url: "https://example.com/about" },
            },
          ],
          cursor: 10,
        },
      }),
    );

    const result = await getCfCrawlResults("job-123", cfg());

    expect(result.jobId).toBe("job-123");
    expect(result.status).toBe("completed");
    expect(result.browserSecondsUsed).toBe(42.5);
    expect(result.total).toBe(10);
    expect(result.finished).toBe(10);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].markdown).toBe("# Example");
    expect(result.cursor).toBe(10);
  });

  it("sends query parameters for pagination", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          id: "job-123",
          status: "running",
          browserSecondsUsed: 0,
          total: 50,
          finished: 5,
          records: [],
        },
      }),
    );

    await getCfCrawlResults("job-123", cfg(), {
      limit: 10,
      cursor: 5,
      status: "completed",
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUrl).toContain("limit=10");
    expect(calledUrl).toContain("cursor=5");
    expect(calledUrl).toContain("status=completed");
  });

  it("uses GET method with Authorization header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          id: "job-123",
          status: "running",
          browserSecondsUsed: 0,
          total: 0,
          finished: 0,
          records: [],
        },
      }),
    );

    await getCfCrawlResults("job-123", cfg());

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BASE}/crawl/job-123`,
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );
  });

  it("handles missing optional fields with defaults", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        result: {
          id: "job-456",
          status: "running",
        },
      }),
    );

    const result = await getCfCrawlResults("job-456", cfg());

    expect(result.browserSecondsUsed).toBe(0);
    expect(result.total).toBe(0);
    expect(result.finished).toBe(0);
    expect(result.records).toEqual([]);
    expect(result.cursor).toBeUndefined();
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: "not found" }, 404),
    );

    await expect(
      getCfCrawlResults("nonexistent-job", cfg()),
    ).rejects.toThrow("CF /crawl GET returned HTTP 404");
  });
});

describe("cancelCfCrawlJob", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends DELETE request successfully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true }, 200),
    );

    await cancelCfCrawlJob("job-123", cfg());

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BASE}/crawl/job-123`,
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: "not found" }, 404),
    );

    await expect(
      cancelCfCrawlJob("nonexistent-job", cfg()),
    ).rejects.toThrow("CF /crawl DELETE returned HTTP 404");
  });

  it("throws timeout error", async () => {
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

    await expect(
      cancelCfCrawlJob("job-123", cfg({ timeoutMs: 1 })),
    ).rejects.toThrow("CF /crawl DELETE timed out");
  });
});
