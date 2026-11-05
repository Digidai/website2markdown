import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { wechatUnavailableError } from "../handlers/convert";
import { createMockEnv, mockCtx } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function convert(target: string, response: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  const res = await worker.fetch(new Request(`https://md.example.com/${target}?raw=true`, {
    headers: { Accept: "application/json" },
  }), createMockEnv().env, mockCtx());
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("failure reasons for callers", () => {
  it("names the site's answer, whether to retry, and what to try instead", async () => {
    const cases: Array<[number, string, string, boolean]> = [
      [404, "Not Found", "target_not_found", false],
      [410, "Gone", "target_gone", false],
      [412, "Precondition Failed", "target_rejected", false],
      [500, "Internal Server Error", "target_error", true],
      [530, "", "target_unreachable", true],
    ];
    for (const [status, text, code, retryable] of cases) {
      const { body } = await convert(`https://news.example.com/story-${status}`, () =>
        new Response("upstream", { status, statusText: text, headers: { "Content-Type": "text/html" } }));
      expect(body).toMatchObject({ code, cause: "target", retryable, target_status: status });
      expect(String(body.hint)).not.toBe("");
    }
  });

  it("says a file is not a web page, naming only the site's content type", async () => {
    const { status, body } = await convert("https://files.example.com/report.pdf", () =>
      new Response("%PDF-1.7", { status: 200, headers: { "Content-Type": "application/pdf; name=report.pdf" } }));
    expect(status).toBe(415);
    expect(body).toMatchObject({ code: "unsupported_content", cause: "target", retryable: false });
    expect(body.message).toBe("This URL returns application/pdf rather than a web page. Only HTML and plain-text pages can be converted.");
  });

  it("does not pass a thrown error's text to the caller", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("upstream-vendor-x tunnel 407 auth failed"); }));
    const res = await worker.fetch(new Request("https://md.example.com/https://news.example.com/story?raw=true", {
      headers: { Accept: "application/json" },
    }), createMockEnv().env, mockCtx());
    const text = await res.text();
    expect(text).not.toMatch(/vendor|tunnel|407/);
    expect(JSON.parse(text)).toMatchObject({ code: "target_unreadable", retryable: true });
  });

  it("does not report a status the site never sent", () => {
    // WeChat answers 200 for deleted and video posts; the 410 only sizes the negative cache.
    const deleted = wechatUnavailableError('<div class="weui-msg__title">该内容已被发布者删除</div>')!.toPublic();
    expect(deleted).toMatchObject({ code: "target_gone", cause: "target" });
    expect(deleted.targetStatus).toBeUndefined();
    const video = wechatUnavailableError("var item_show_type = '5';")!.toPublic();
    expect(video).toMatchObject({ code: "no_content" });
    expect(video.targetStatus).toBeUndefined();
  });

  it("does not replay a negative-cache entry written before reasons were stored", async () => {
    // Older entries held WeChat's synthesized 410 in targetStatus, indistinguishable from a real one.
    const { env, mocks } = createMockEnv();
    mocks.kvGet.mockImplementation(async (key: string) =>
      key.startsWith("https://md-neg/") ? JSON.stringify({ title: "Gone", message: "old", statusCode: 410, targetStatus: 410 }) : null);
    const fetchMock = vi.fn(async () => new Response("<html><body><h1>Hi</h1></body></html>", {
      status: 404, headers: { "Content-Type": "text/html" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await worker.fetch(new Request("https://md.example.com/https://legacy.example.com/post?raw=true", {
      headers: { Accept: "application/json" },
    }), env, mockCtx());
    expect(fetchMock).toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ code: "target_not_found", target_status: 404 });
  });

  it("tells a Free key that the option needs Pro, not to create a key", async () => {
    const db = {
      prepare: () => {
        const stmt = {
          bind: () => stmt,
          first: async () => ({
            key_id: "key_free", account_id: "acct_free", revoked_at: null, tier: "free",
            monthly_credits_used: 0, monthly_credits_reset_at: "2099-01-01T00:00:00.000Z",
          }),
          run: async () => ({ success: true }),
        };
        return stmt;
      },
      batch: async () => [],
    } as unknown as D1Database;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unused")));
    const res = await worker.fetch(new Request("https://md.example.com/https://news.example.com/a?raw=true&no_cache=true", {
      headers: { Accept: "application/json", Authorization: "Bearer mk_free_key" },
    }), createMockEnv({ AUTH_DB: db }).env, mockCtx());
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ code: "plan_required", cause: "account" });
    expect(String(body.hint)).not.toMatch(/free API key/i);
  });
});
