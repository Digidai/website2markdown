import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { convertUrl } from "../handlers/convert";
import { setCache } from "../cache";
import { createMockEnv, mockCtx } from "./test-helpers";
import { SEARCH_PAGE_API_KEY_MESSAGE } from "../policy/anonymous-guards";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function page(status: number, statusText: string): Response {
  return new Response("upstream", {
    status,
    statusText,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function article(): Response {
  return new Response(
    "<!doctype html><html><head><title>Paper</title></head><body><article><h1>Paper title</h1><p>This is the article body used by the conversion test.</p></article></body></html>",
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function convert(url: string, env = createMockEnv().env, headers: HeadersInit = { Accept: "application/json" }) {
  return worker.fetch(new Request(url, { headers }), env, mockCtx());
}

describe("anonymous origin failure cache", () => {
  it("replays an anonymous 404 without a second fetch, and still fetches for other callers", async () => {
    const target = "https://neg-404.example/missing";
    const fetchMock = vi.fn().mockResolvedValue(page(404, "Not Found"));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createMockEnv();
    const first = await convert(`https://md.example.com/${target}?raw=true`, env);
    const firstBody = await first.json() as { message?: string };

    expect(first.status).toBe(502);
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(firstBody.message).toContain("Status: 404");
    const afterFirst = fetchMock.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    const second = await convert(`https://md.example.com/${target}?raw=true`, env);
    const secondBody = await second.json() as { message?: string };
    expect(second.status).toBe(502);
    expect(second.headers.get("Cache-Control")).toBe("private, no-store");
    expect(secondBody.message).toBe(firstBody.message);
    expect(fetchMock.mock.calls.length).toBe(afterFirst);

    const keyed = await convert(
      `https://md.example.com/${target}?raw=true`,
      createMockEnv({ API_TOKEN: "keyed-token" }).env,
      { Accept: "application/json", Authorization: "Bearer keyed-token" },
    );
    expect(keyed.status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);

    const afterKeyed = fetchMock.mock.calls.length;
    await expect(convertUrl(
      target,
      env,
      "md.example.com",
      "markdown",
      undefined,
      false,
      false,
      undefined,
      undefined,
      undefined,
      true,
      false,
      undefined,
      false,
    )).rejects.toThrow(/Status: 404/);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterKeyed);

    const afterExplicitFetch = fetchMock.mock.calls.length;
    await expect(convertUrl(
      target,
      env,
      "md.example.com",
      "markdown",
      undefined,
      false,
      false,
      undefined,
      undefined,
      undefined,
      true,
      true,
      undefined,
      true,
    )).rejects.toThrow(/Status: 404/);
    expect(fetchMock.mock.calls.length).toBe(afterExplicitFetch);
  });

  it("does not remember 500 or 412 responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page(500, "Internal Server Error"))
      .mockResolvedValueOnce(page(500, "Internal Server Error"))
      .mockResolvedValueOnce(page(500, "Internal Server Error"))
      .mockResolvedValueOnce(page(500, "Internal Server Error"))
      .mockResolvedValueOnce(page(500, "Internal Server Error"))
      .mockResolvedValueOnce(page(500, "Internal Server Error"))
      .mockResolvedValue(page(412, "Precondition Failed"));
    vi.stubGlobal("fetch", fetchMock);
    const { env, mocks } = createMockEnv();
    const serverError = await convert("https://md.example.com/https://neg-500.example/boom?raw=true", env);
    expect(serverError.status).toBe(502);
    expect(serverError.headers.get("Cache-Control")).toBeNull();
    const afterFirst = fetchMock.mock.calls.length;
    const serverErrorAgain = await convert("https://md.example.com/https://neg-500.example/boom?raw=true", env);
    expect(serverErrorAgain.status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);

    const precondition = await convert("https://md.example.com/https://neg-412.example/gone?raw=true", env);
    expect(precondition.status).toBe(502);
    expect(precondition.headers.get("Cache-Control")).toBeNull();
    const after412 = fetchMock.mock.calls.length;
    await convert("https://md.example.com/https://neg-412.example/gone?raw=true", env);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(after412);
    const remembered = mocks.kvPut.mock.calls.filter((call) => String(call[0]).includes("https://md-neg/"));
    expect(remembered).toHaveLength(0);
  });
});

describe("anonymous search-page gate", () => {
  it("returns HTTP 401 before cache, fetch, and the anonymous rate-limit write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(article());
    vi.stubGlobal("fetch", fetchMock);
    const sqls: string[] = [];
    const prepare = vi.fn((sql: string) => {
      sqls.push(sql);
      const stmt = {
        bind: vi.fn(() => stmt),
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ success: true })),
      };
      return stmt;
    });
    const { env, mocks } = createMockEnv({
      AUTH_DB: { prepare } as unknown as ReturnType<typeof createMockEnv>["env"]["AUTH_DB"],
    });
    const bing = "https://www.bing.com/search?q=cached";
    await setCache(env, bing, "markdown", {
      content: "# bing results that must stay hidden",
      method: "readability+turndown",
      title: "Bing",
    });

    const json = await convert(
      "https://md.example.com/https://www.bing.com/search?q=cached&raw=true",
      env,
      { Accept: "application/json", "cf-connecting-ip": "203.0.113.10" },
    );
    const jsonBody = await json.json() as { error?: string; message?: string };
    expect(json.status).toBe(401);
    expect(jsonBody).toEqual({
      error: "Unauthorized",
      message: SEARCH_PAGE_API_KEY_MESSAGE,
      status: 401,
    });
    expect(json.headers.get("Cache-Control")).toBe("private, no-store");
    expect(jsonBody.message).not.toBe("engine selection requires an API key.");

    const document = await worker.fetch(
      new Request("https://md.example.com/https://www.bing.com/search?q=cached", {
        headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
      }),
      env,
      mockCtx(),
    );
    const documentBody = await document.text();
    expect(document.status).toBe(401);
    expect(document.headers.get("Cache-Control")).toBe("private, no-store");
    expect(documentBody).not.toContain("bing results that must stay hidden");

    const stream = await worker.fetch(
      new Request("https://md.example.com/api/stream?url=https%3A%2F%2Fwww.bing.com%2Fsearch%3Fq%3Dcached"),
      env,
      mockCtx(),
    );
    const streamBody = await stream.json() as { message?: string };
    expect(stream.status).toBe(401);
    expect(stream.headers.get("Content-Type")).toContain("application/json");
    expect(stream.headers.get("Content-Type")).not.toContain("text/event-stream");
    expect(streamBody.message).toBe(SEARCH_PAGE_API_KEY_MESSAGE);
    expect(stream.headers.get("Cache-Control")).toBe("private, no-store");

    await expect(convertUrl(
      bing,
      env,
      "md.example.com",
      "markdown",
      undefined,
      false,
      false,
      undefined,
      undefined,
      undefined,
      false,
      false,
      undefined,
      true,
    )).rejects.toMatchObject({ statusCode: 401, message: SEARCH_PAGE_API_KEY_MESSAGE });

    const cachedForKeyed = await convertUrl(
      bing,
      env,
      "md.example.com",
      "markdown",
      undefined,
      false,
      false,
    );
    expect(cachedForKeyed.content).toContain("bing results that must stay hidden");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sqls.some((sql) => sql.includes("anon-rl"))).toBe(false);
    expect(mocks.kvPut.mock.calls.some((call) => String(call[0]).includes("https://md-neg/"))).toBe(false);
  });

  it("blocks the three search paths and leaves articles, other paths, and keyed callers alone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(article());
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createMockEnv();
    const blocked = [
      "https://www.bing.com/search?q=1",
      "https://searx.be/search?q=1",
      "https://html.duckduckgo.com/html/?q=1",
    ];
    for (const target of blocked) {
      const res = await convert(`https://md.example.com/${target}&raw=true`, env);
      const body = await res.json() as { message?: string };
      expect(res.status).toBe(401);
      expect(body.message).toBe(SEARCH_PAGE_API_KEY_MESSAGE);
    }

    const allowed = [
      "https://www.bing.com/news",
      "https://cn.bing.com/search?q=1",
      "https://duckduckgo.com/?q=1",
      "https://arxiv.org/abs/1234.5678",
      "https://openprescribing.net/chemical/",
      "https://mp.weixin.qq.com/s/not-a-search",
    ];
    for (const target of allowed) {
      const res = await convert(`https://md.example.com/${target}?raw=true`, env);
      expect(res.status).not.toBe(401);
    }
    expect(fetchMock).toHaveBeenCalled();

    const keyed = await convert(
      "https://md.example.com/https://www.bing.com/search?q=keyed&raw=true",
      createMockEnv({ API_TOKEN: "keyed-token" }).env,
      { Accept: "application/json", Authorization: "Bearer keyed-token" },
    );
    expect(keyed.status).not.toBe(401);

    const legacyStream = await worker.fetch(
      new Request("https://md.example.com/api/stream?url=https%3A%2F%2Fwww.bing.com%2Fsearch%3Fq%3Dlegacy&token=public-token"),
      createMockEnv({ PUBLIC_API_TOKEN: "public-token" }).env,
      mockCtx(),
    );
    expect(legacyStream.status).toBe(200);
    expect(legacyStream.headers.get("Content-Type")).toContain("text/event-stream");
    expect(legacyStream.headers.get("Cache-Control")).toBe("no-cache");
    expect(await legacyStream.text()).not.toContain(SEARCH_PAGE_API_KEY_MESSAGE);
  });

  it("replays an anonymous stream failure as HTTP 200 SSE and does not fetch again", async () => {
    const target = "https://neg-stream-404.example/missing";
    const fetchMock = vi.fn().mockResolvedValue(page(404, "Not Found"));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createMockEnv();
    const first = await worker.fetch(
      new Request(`https://md.example.com/api/stream?url=${encodeURIComponent(target)}`),
      env,
      mockCtx(),
    );
    const firstBody = await first.text();
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toContain("text/event-stream");
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(firstBody).toContain("event: fail");
    expect(firstBody).toContain("Status: 404");
    const afterFirst = fetchMock.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    const second = await worker.fetch(
      new Request(`https://md.example.com/api/stream?url=${encodeURIComponent(target)}`),
      env,
      mockCtx(),
    );
    const secondBody = await second.text();
    expect(second.status).toBe(200);
    expect(second.headers.get("Cache-Control")).toBe("private, no-store");
    expect(secondBody).toContain("event: fail");
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });
});
