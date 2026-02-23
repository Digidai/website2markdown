import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { createMockEnv } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function batchRequest(
  body: unknown,
  token?: string,
  headers?: Record<string, string>,
): Request {
  return new Request("https://md.example.com/api/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/batch", () => {
  it("returns 503 when API_TOKEN is missing", async () => {
    const req = batchRequest({ urls: ["https://example.com"] }, "token");
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(503);
    expect(payload.error).toBe("Service misconfigured");
  });

  it("returns 401 for invalid bearer token", async () => {
    const { env } = createMockEnv({ API_TOKEN: "correct-token" });
    const req = batchRequest({ urls: ["https://example.com"] }, "wrong-token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
  });

  it("returns 413 for oversized request body via Content-Length", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = batchRequest(
      { urls: ["https://example.com"] },
      "token",
      { "Content-Length": "100001" },
    );
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(413);
    expect(payload.error).toBe("Request too large");
  });

  it("returns 413 for oversized request body without trusted Content-Length", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const oversizedBody = `{"urls":["https://example.com/${"a".repeat(110_000)}"]}`;
    const req = batchRequest(oversizedBody, "token", { "Content-Length": "0" });
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(413);
    expect(payload.error).toBe("Request too large");
  });

  it("returns 400 for invalid JSON body", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = batchRequest("{invalid-json", "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid request body");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("returns 500 when an internal error occurs after request parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("# hello from source", {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      }),
    ));
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("log sink unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = batchRequest({ urls: ["https://example.com/internal-error-case"] }, "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(500);
    expect(payload.error).toBe("Internal Error");
    expect(payload.message).toContain("Failed to process batch");
  });

  it("returns 400 when urls is missing", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = batchRequest({ foo: "bar" }, "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toContain("urls");
  });

  it("returns 400 when urls length exceeds 10", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    const req = batchRequest({ urls }, "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toContain("Maximum 10 URLs");
  });

  it("returns 400 when urls contains non-string items", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = batchRequest({
      urls: ["https://example.com/a", 123, { bad: "item" }],
    }, "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toContain("Each batch item");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when urls contains blank URL items", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = batchRequest({
      urls: ["   ", { url: "   ", format: "markdown" }],
    }, "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toContain("Each batch item");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts object-style batch items with per-item options", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body><article><h1>Hello</h1><p>World</p></article></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = batchRequest({
      urls: [
        {
          url: "https://example.com/a",
          format: "text",
          selector: "article",
          force_browser: false,
          no_cache: true,
        },
      ],
    }, "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      results?: Array<{
        url?: string;
        format?: string;
        content?: string;
        markdown?: string;
      }>;
    };

    expect(res.status).toBe(200);
    expect(payload.results?.[0].url).toBe("https://example.com/a");
    expect(payload.results?.[0].format).toBe("text");
    expect(payload.results?.[0].content).toContain("Hello");
    expect(payload.results?.[0].markdown).toBeUndefined();
  });

  it("returns per-item errors for invalid or blocked URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = batchRequest({
      urls: ["not-a-url", "http://127.0.0.1/private"],
    }, "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      results?: Array<{ url?: string; error?: string }>;
    };

    expect(res.status).toBe(200);
    expect(payload.results?.[0].error).toBe("Invalid or blocked URL");
    expect(payload.results?.[1].error).toBe("Invalid or blocked URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts valid URLs in batch mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("# hello from source", {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      }),
    ));

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = batchRequest({ urls: ["https://example.com/a"] }, "token");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      results?: Array<{
        url?: string;
        markdown?: string;
        method?: string;
        cached?: boolean;
        error?: string;
      }>;
    };

    expect(res.status).toBe(200);
    expect(payload.results?.length).toBe(1);
    expect(payload.results?.[0].url).toBe("https://example.com/a");
    expect(payload.results?.[0].markdown).toContain("hello from source");
    expect(payload.results?.[0].method).toBe("native");
    expect(payload.results?.[0].cached).toBe(false);
    expect(payload.results?.[0].error).toBeUndefined();
  });

  it("stops in-flight batch conversion promptly after request abort", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const controller = new AbortController();
    const req = new Request("https://md.example.com/api/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify({
        urls: [{ url: "https://example.com/abort-case", no_cache: true }],
      }),
      signal: controller.signal,
    });

    const responsePromise = worker.fetch(req, env);
    setTimeout(() => controller.abort(), 20);

    const race = await Promise.race([
      responsePromise.then(async (response) => ({
        settled: true as const,
        response,
        payload: await response.json() as {
          results?: Array<{ error?: string }>;
        },
      })),
      new Promise<{ settled: false }>((resolve) => setTimeout(() => resolve({ settled: false }), 300)),
    ]);

    expect(race.settled).toBe(true);
    if (race.settled) {
      expect(race.response.status).toBe(200);
      expect(race.payload.results?.[0].error).toBeTruthy();
      expect(fetchMock).toHaveBeenCalled();
    }
  });
});
