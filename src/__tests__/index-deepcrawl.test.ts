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

function deepcrawlRequest(body: unknown, token?: string): Request {
  return new Request("https://md.example.com/api/deepcrawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function setupInMemoryKv() {
  const store = new Map<string, string>();
  const { env, mocks } = createMockEnv({ API_TOKEN: "token" });
  mocks.kvGet.mockImplementation(async (key: string) => store.get(key) ?? null);
  mocks.kvPut.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  return { env, store };
}

function stubGraphFetch(pages: Record<string, string>): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const lookup = rawUrl.split("#")[0];
    const html = pages[lookup];

    if (!html) {
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }));
}

describe("POST /api/deepcrawl", () => {
  const seed = "https://crawl.example.com/start";
  const graph: Record<string, string> = {
    "https://crawl.example.com/start": `
      <html><body><article>
        <a href="/a">keyword target</a>
        <a href="/b">normal target</a>
      </article></body></html>
    `,
    "https://crawl.example.com/a": "<html><body><article><a href='/c'>to-c</a></article></body></html>",
    "https://crawl.example.com/b": "<html><body><article><a href='/d'>to-d</a></article></body></html>",
    "https://crawl.example.com/c": "<html><body><article>C page</article></body></html>",
    "https://crawl.example.com/d": "<html><body><article>D page</article></body></html>",
  };

  it("runs non-stream deep crawl and persists checkpoint", async () => {
    stubGraphFetch(graph);
    const { env, store } = setupInMemoryKv();

    const req = deepcrawlRequest({
      seed,
      max_depth: 2,
      max_pages: 5,
      strategy: "best_first",
      filters: {
        allow_domains: ["crawl.example.com"],
      },
      scorer: {
        keywords: ["keyword"],
        weight: 2,
        score_threshold: 0,
      },
      output: {
        include_markdown: true,
      },
      checkpoint: {
        crawl_id: "crawl-1",
        snapshot_interval: 1,
      },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      crawlId?: string;
      results?: Array<{ url: string; depth: number }>;
      stats?: { crawledPages: number; succeededPages: number };
    };

    expect(res.status).toBe(200);
    expect(payload.crawlId).toBe("crawl-1");
    expect(payload.results?.length).toBeGreaterThan(0);
    expect(payload.results?.[0]?.url).toBe(seed);
    expect(typeof payload.results?.[0]?.depth).toBe("number");
    expect(payload.stats?.crawledPages).toBeGreaterThan(0);
    expect(payload.stats?.succeededPages).toBeGreaterThan(0);
    expect(store.has("deepcrawl:v1:crawl-1")).toBe(true);
  });

  it("streams start/node/done events in stream mode", async () => {
    stubGraphFetch(graph);
    const { env } = setupInMemoryKv();

    const req = deepcrawlRequest({
      seed,
      max_depth: 1,
      max_pages: 3,
      stream: true,
      checkpoint: {
        crawl_id: "crawl-stream",
      },
    }, "token");

    const res = await worker.fetch(req, env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(body).toContain("event: start");
    expect(body).toContain("event: node");
    expect(body).toContain("event: done");
  });

  it("resumes from checkpoint when checkpoint.resume is true", async () => {
    stubGraphFetch(graph);
    const { env } = setupInMemoryKv();

    const firstReq = deepcrawlRequest({
      seed,
      max_depth: 2,
      max_pages: 2,
      checkpoint: {
        crawl_id: "crawl-resume",
        snapshot_interval: 1,
      },
    }, "token");
    const firstRes = await worker.fetch(firstReq, env);
    const firstPayload = await firstRes.json() as {
      results?: Array<{ url: string }>;
      resumed?: boolean;
    };

    const resumeReq = deepcrawlRequest({
      seed,
      max_depth: 2,
      max_pages: 5,
      checkpoint: {
        crawl_id: "crawl-resume",
        resume: true,
        snapshot_interval: 1,
      },
    }, "token");
    const resumeRes = await worker.fetch(resumeReq, env);
    const resumePayload = await resumeRes.json() as {
      results?: Array<{ url: string }>;
      resumed?: boolean;
    };

    expect(firstRes.status).toBe(200);
    expect(firstPayload.results?.length).toBe(2);
    expect(resumeRes.status).toBe(200);
    expect(resumePayload.resumed).toBe(true);
    expect(resumePayload.results?.length).toBeGreaterThan(2);
  });

  it("returns 400 when resume is true without checkpoint.crawl_id", async () => {
    const { env } = setupInMemoryKv();
    const req = deepcrawlRequest({
      seed,
      checkpoint: {
        resume: true,
      },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid request");
    expect(payload.message).toContain("checkpoint.crawl_id is required");
  });

  it("returns 400 for out-of-range max_depth and max_pages", async () => {
    const { env } = setupInMemoryKv();

    const badDepthReq = deepcrawlRequest({
      seed,
      max_depth: 7,
    }, "token");
    const badDepthRes = await worker.fetch(badDepthReq, env);
    const badDepthPayload = await badDepthRes.json() as { error?: string; message?: string };
    expect(badDepthRes.status).toBe(400);
    expect(badDepthPayload.error).toBe("Invalid request");
    expect(badDepthPayload.message).toContain("max_depth must be between 0 and 6");

    const badPagesReq = deepcrawlRequest({
      seed,
      max_pages: 0,
    }, "token");
    const badPagesRes = await worker.fetch(badPagesReq, env);
    const badPagesPayload = await badPagesRes.json() as { error?: string; message?: string };
    expect(badPagesRes.status).toBe(400);
    expect(badPagesPayload.error).toBe("Invalid request");
    expect(badPagesPayload.message).toContain("max_pages must be between 1 and 200");
  });

  it("returns 400 for non-integer deepcrawl numeric fields", async () => {
    const { env } = setupInMemoryKv();
    const req = deepcrawlRequest({
      seed,
      max_depth: 1.5,
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid request");
    expect(payload.message).toContain("max_depth must be an integer");
  });

  it("returns 400 for oversized filter list entries", async () => {
    const { env } = setupInMemoryKv();
    const req = deepcrawlRequest({
      seed,
      filters: {
        allow_domains: [`${"a".repeat(513)}.example.com`],
      },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid request");
    expect(payload.message).toContain("allow_domains");
    expect(payload.message).toContain("at most 512 characters");
  });

  it("returns 400 for invalid checkpoint.crawl_id characters", async () => {
    const { env } = setupInMemoryKv();
    const req = deepcrawlRequest({
      seed,
      checkpoint: {
        crawl_id: "invalid/id",
      },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid request");
    expect(payload.message).toContain("checkpoint.crawl_id");
    expect(payload.message).toContain("unsupported characters");
  });

  it("returns 400 for invalid allow_domains entries", async () => {
    const { env } = setupInMemoryKv();
    const req = deepcrawlRequest({
      seed,
      filters: {
        allow_domains: ["bad domain value"],
      },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid request");
    expect(payload.message).toContain("filters.allow_domains");
    expect(payload.message).toContain("invalid domain");
  });
});
