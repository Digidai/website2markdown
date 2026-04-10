import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { handleLlmsTxt, fetchTargetLlmsTxt } from "../handlers/llms-txt";
import { createMockEnv, mockCtx } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /llms.txt", () => {
  it("returns correct content with text/plain content type", async () => {
    const req = new Request("https://md.example.com/llms.txt");
    const res = await worker.fetch(req, createMockEnv().env, mockCtx());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const text = await res.text();
    expect(text).toContain("# md.example.com");
    expect(text).toContain("URL-to-Markdown conversion API");
    expect(text).toContain("/api/batch");
    expect(text).toContain("/api/stream");
  });

  it("GET /.well-known/llms.txt returns same content as /llms.txt", async () => {
    const req1 = new Request("https://md.example.com/llms.txt");
    const req2 = new Request("https://md.example.com/.well-known/llms.txt");
    const env = createMockEnv().env;

    const res1 = await worker.fetch(req1, env, mockCtx());
    const res2 = await worker.fetch(req2, env, mockCtx());

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const text1 = await res1.text();
    const text2 = await res2.text();
    expect(text1).toBe(text2);
  });

  it("handleLlmsTxt includes the host in the response", () => {
    const res = handleLlmsTxt("api.example.org");
    const text = res.clone().text();

    return text.then((body) => {
      expect(body).toContain("# api.example.org");
      expect(body).toContain("https://api.example.org/");
    });
  });
});

describe("fetchTargetLlmsTxt", () => {
  it("returns cached content on cache hit", async () => {
    const kvGet = vi.fn(async () => "# Example llms.txt content");
    const kvPut = vi.fn(async () => {});
    const kv = { get: kvGet, put: kvPut } as unknown as KVNamespace;

    const result = await fetchTargetLlmsTxt(kv, "https://example.com/page");

    expect(result).toBe("# Example llms.txt content");
    expect(kvGet).toHaveBeenCalledWith("llmstxt:example.com", "text");
    expect(kvPut).not.toHaveBeenCalled();
  });

  it("fetches and caches on cache miss", async () => {
    const kvGet = vi.fn(async () => null);
    const kvPut = vi.fn(async () => {});
    const kv = { get: kvGet, put: kvPut } as unknown as KVNamespace;

    const llmsContent = "# Target Site\n> Some description";
    const mockFetch = vi.fn(async () =>
      new Response(llmsContent, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchTargetLlmsTxt(kv, "https://example.com/page");

    expect(result).toBe(llmsContent);
    expect(kvGet).toHaveBeenCalledWith("llmstxt:example.com", "text");
    expect(kvPut).toHaveBeenCalledWith(
      "llmstxt:example.com",
      llmsContent,
      { expirationTtl: 86400 },
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/llms.txt",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("returns null and caches 'NONE' for missing llms.txt", async () => {
    const kvGet = vi.fn(async () => null);
    const kvPut = vi.fn(async () => {});
    const kv = { get: kvGet, put: kvPut } as unknown as KVNamespace;

    const mockFetch = vi.fn(async () =>
      new Response("Not Found", { status: 404 }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchTargetLlmsTxt(kv, "https://example.com/page");

    expect(result).toBeNull();
    expect(kvPut).toHaveBeenCalledWith(
      "llmstxt:example.com",
      "NONE",
      { expirationTtl: 3600 },
    );
    // Should have tried both /llms.txt and /.well-known/llms.txt
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns null from negative cache without re-fetching", async () => {
    const kvGet = vi.fn(async () => "NONE");
    const kvPut = vi.fn(async () => {});
    const kv = { get: kvGet, put: kvPut } as unknown as KVNamespace;

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchTargetLlmsTxt(kv, "https://example.com/page");

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(kvPut).not.toHaveBeenCalled();
  });

  it("handles timeout gracefully", async () => {
    const kvGet = vi.fn(async () => null);
    const kvPut = vi.fn(async () => {});
    const kv = { get: kvGet, put: kvPut } as unknown as KVNamespace;

    const mockFetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchTargetLlmsTxt(kv, "https://slow-site.com/page");

    expect(result).toBeNull();
    // Should cache negative result after timeout
    expect(kvPut).toHaveBeenCalledWith(
      "llmstxt:slow-site.com",
      "NONE",
      { expirationTtl: 3600 },
    );
  });
});
