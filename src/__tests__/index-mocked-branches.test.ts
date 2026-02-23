import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockEnv } from "./test-helpers";

const mocked = vi.hoisted(() => ({
  browser: {
    fetchWithBrowser: vi.fn(),
    alwaysNeedsBrowser: vi.fn(),
    getAdapter: vi.fn(),
  },
  paywall: {
    applyPaywallHeaders: vi.fn(),
    extractJsonLdArticle: vi.fn(),
    removePaywallElements: vi.fn(),
    looksPaywalled: vi.fn(),
    getPaywallRule: vi.fn(),
    fetchWaybackSnapshot: vi.fn(),
    fetchArchiveToday: vi.fn(),
    extractAmpLink: vi.fn(),
    stripAmpAccessControls: vi.fn(),
  },
  converter: {
    htmlToMarkdown: vi.fn(),
    htmlToText: vi.fn(),
    proxyImageUrls: vi.fn(),
  },
  cache: {
    getCached: vi.fn(),
    setCache: vi.fn(),
    getImage: vi.fn(),
  },
  proxy: {
    parseProxyUrl: vi.fn(),
    parseProxyPool: vi.fn(),
    fetchViaProxy: vi.fn(),
    fetchViaProxyPool: vi.fn(),
  },
}));

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

vi.mock("../browser", () => ({
  fetchWithBrowser: mocked.browser.fetchWithBrowser,
  alwaysNeedsBrowser: mocked.browser.alwaysNeedsBrowser,
  getAdapter: mocked.browser.getAdapter,
}));

vi.mock("../paywall", () => ({
  applyPaywallHeaders: mocked.paywall.applyPaywallHeaders,
  extractJsonLdArticle: mocked.paywall.extractJsonLdArticle,
  removePaywallElements: mocked.paywall.removePaywallElements,
  looksPaywalled: mocked.paywall.looksPaywalled,
  getPaywallRule: mocked.paywall.getPaywallRule,
  fetchWaybackSnapshot: mocked.paywall.fetchWaybackSnapshot,
  fetchArchiveToday: mocked.paywall.fetchArchiveToday,
  extractAmpLink: mocked.paywall.extractAmpLink,
  stripAmpAccessControls: mocked.paywall.stripAmpAccessControls,
}));

vi.mock("../converter", () => ({
  htmlToMarkdown: mocked.converter.htmlToMarkdown,
  htmlToText: mocked.converter.htmlToText,
  proxyImageUrls: mocked.converter.proxyImageUrls,
}));

vi.mock("../cache", () => ({
  getCached: mocked.cache.getCached,
  setCache: mocked.cache.setCache,
  getImage: mocked.cache.getImage,
}));

vi.mock("../proxy", () => ({
  parseProxyUrl: mocked.proxy.parseProxyUrl,
  parseProxyPool: mocked.proxy.parseProxyPool,
  fetchViaProxy: mocked.proxy.fetchViaProxy,
  fetchViaProxyPool: mocked.proxy.fetchViaProxyPool,
}));

import worker from "../index";
import { createProxyRetrySignal } from "../browser/proxy-retry";

function makeAdapter(overrides?: Record<string, unknown>): any {
  return {
    match: vi.fn(() => true),
    alwaysBrowser: false,
    configurePage: vi.fn(async () => {}),
    extract: vi.fn(async () => null),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.browser.fetchWithBrowser.mockResolvedValue("<html><body>browser-content</body></html>");
  mocked.browser.alwaysNeedsBrowser.mockReturnValue(false);
  mocked.browser.getAdapter.mockReturnValue(makeAdapter());

  mocked.cache.getCached.mockResolvedValue(null);
  mocked.cache.setCache.mockResolvedValue(undefined);
  mocked.cache.getImage.mockResolvedValue(null);

  mocked.paywall.applyPaywallHeaders.mockImplementation(() => {});
  mocked.paywall.extractJsonLdArticle.mockReturnValue(null);
  mocked.paywall.removePaywallElements.mockImplementation((html: string) => html);
  mocked.paywall.looksPaywalled.mockReturnValue(false);
  mocked.paywall.getPaywallRule.mockReturnValue(null);
  mocked.paywall.fetchWaybackSnapshot.mockResolvedValue(null);
  mocked.paywall.fetchArchiveToday.mockResolvedValue(null);
  mocked.paywall.extractAmpLink.mockReturnValue(null);
  mocked.paywall.stripAmpAccessControls.mockImplementation((html: string) => html);

  mocked.converter.htmlToMarkdown.mockReturnValue({
    markdown: "# md body",
    title: "Title",
    contentHtml: "<article>md body</article>",
  });
  mocked.converter.htmlToText.mockReturnValue("plain text");
  mocked.converter.proxyImageUrls.mockImplementation((markdown: string) => `proxied:${markdown}`);

  mocked.proxy.parseProxyUrl.mockReturnValue(null);
  mocked.proxy.parseProxyPool.mockReturnValue([]);
  mocked.proxy.fetchViaProxy.mockResolvedValue({
    status: 200,
    headers: {},
    body: "<html>proxy body</html>",
  });
  mocked.proxy.fetchViaProxyPool.mockResolvedValue({
    status: 200,
    headers: {},
    body: "<html>proxy pool body</html>",
    proxyIndex: 0,
    proxy: {
      host: "proxy.example.com",
      port: 8080,
      username: "u",
      password: "p",
    },
    variant: "desktop",
    attempts: 1,
    errors: [],
  });
});

describe("index mocked branch coverage", () => {
  it("uses adapter transformUrl + fetchDirect path", async () => {
    const adapter = makeAdapter({
      transformUrl: vi.fn((url: string) => `${url}?t=1`),
      fetchDirect: vi.fn(async () => "<html><body>direct body</body></html>"),
    });
    mocked.browser.getAdapter.mockReturnValue(adapter);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://md.example.com/https://example.com/a?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("# md body");
    expect((adapter.transformUrl as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("https://example.com/a");
    expect((adapter.fetchDirect as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("https://example.com/a?t=1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to static fetch when fetchDirect throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = makeAdapter({
      fetchDirect: vi.fn(async () => {
        throw new Error("direct failed");
      }),
    });
    mocked.browser.getAdapter.mockReturnValue(adapter);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>static body</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/static?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("# md body");
  });

  it("returns fetch failed when browser asks proxy retry but PROXY_URL is missing", async () => {
    mocked.browser.alwaysNeedsBrowser.mockReturnValue(true);
    mocked.browser.fetchWithBrowser.mockRejectedValueOnce(new Error("PROXY_RETRY:SID=abc"));

    const req = new Request("https://md.example.com/https://example.com/proxy-missing", {
      headers: { Accept: "application/json" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(502);
    expect(payload.error).toBe("Fetch Failed");
    expect(payload.message).toContain("configure PROXY_URL");
  });

  it("retries through proxy and succeeds after PROXY_RETRY signal", async () => {
    mocked.browser.alwaysNeedsBrowser.mockReturnValue(true);
    mocked.browser.fetchWithBrowser.mockRejectedValueOnce(
      new Error("Browser rendering failed: PROXY_RETRY:SID=abc"),
    );
    mocked.proxy.parseProxyUrl.mockReturnValue({
      host: "proxy.example.com",
      port: 8080,
      username: "u",
      password: "p",
    });
    mocked.proxy.fetchViaProxy.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: `<html><body>${"x".repeat(1500)}</body></html>`,
    });

    const { env } = createMockEnv({
      PROXY_URL: "u:p@proxy.example.com:8080",
    });
    const req = new Request("https://md.example.com/https://example.com/proxy-ok?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("browser+readability+turndown");
    expect(mocked.proxy.fetchViaProxy).toHaveBeenCalled();
    const headersArg = mocked.proxy.fetchViaProxy.mock.calls[0]?.[2] as Record<string, string>;
    expect(headersArg.Cookie).toBe("SID=abc");
  });

  it("retries through proxy when browser returns PROXY_RETRY_TOKEN signal", async () => {
    mocked.browser.alwaysNeedsBrowser.mockReturnValue(true);
    const retrySignal = createProxyRetrySignal([{ name: "SID", value: "token-cookie" }]);
    if (!retrySignal) {
      throw new Error("retry signal was not generated");
    }
    mocked.browser.fetchWithBrowser.mockRejectedValueOnce(
      new Error(`Browser rendering failed: ${retrySignal}`),
    );
    mocked.proxy.parseProxyUrl.mockReturnValue({
      host: "proxy.example.com",
      port: 8080,
      username: "u",
      password: "p",
    });
    mocked.proxy.fetchViaProxy.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: `<html><body>${"x".repeat(1500)}</body></html>`,
    });

    const { env } = createMockEnv({
      PROXY_URL: "u:p@proxy.example.com:8080",
    });
    const req = new Request("https://md.example.com/https://example.com/proxy-token?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("browser+readability+turndown");
    const headersArg = mocked.proxy.fetchViaProxy.mock.calls[0]?.[2] as Record<string, string>;
    expect(headersArg.Cookie).toBe("SID=token-cookie");
  });

  it("returns proxy access failure when proxy returns login/challenge html", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocked.browser.alwaysNeedsBrowser.mockReturnValue(true);
    mocked.browser.fetchWithBrowser.mockRejectedValueOnce(new Error("PROXY_RETRY:sid=abc"));
    mocked.proxy.parseProxyUrl.mockReturnValue({
      host: "proxy.example.com",
      port: 8080,
      username: "u",
      password: "p",
    });
    mocked.proxy.fetchViaProxy.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: `<html><body>${"z".repeat(1200)}passport.weibo qrcode_login</body></html>`,
    });

    const { env } = createMockEnv({
      PROXY_URL: "u:p@proxy.example.com:8080",
    });
    const req = new Request("https://md.example.com/https://example.com/proxy-garbage", {
      headers: { Accept: "application/json" },
    });
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(502);
    expect(payload.error).toBe("Fetch Failed");
    expect(payload.message).toContain("Proxy access failed");
  });

  it("uses proxy pool rotation path when PROXY_POOL is configured", async () => {
    mocked.browser.alwaysNeedsBrowser.mockReturnValue(true);
    mocked.browser.fetchWithBrowser.mockRejectedValueOnce(
      new Error("Browser rendering failed: PROXY_RETRY:SID=pool"),
    );
    mocked.proxy.parseProxyPool.mockReturnValue([
      {
        host: "proxy-1.example.com",
        port: 8080,
        username: "u1",
        password: "p1",
      },
      {
        host: "proxy-2.example.com",
        port: 8080,
        username: "u2",
        password: "p2",
      },
    ]);
    mocked.proxy.fetchViaProxyPool.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: `<html><body>${"y".repeat(1600)}</body></html>`,
      proxyIndex: 1,
      proxy: {
        host: "proxy-2.example.com",
        port: 8080,
        username: "u2",
        password: "p2",
      },
      variant: "mobile",
      attempts: 2,
      errors: [],
    });

    const { env } = createMockEnv({
      PROXY_POOL: "u1:p1@proxy-1.example.com:8080,u2:p2@proxy-2.example.com:8080",
    });
    const req = new Request("https://md.example.com/https://example.com/proxy-pool?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Fallbacks")).toContain("proxy_pool_2_mobile");
    expect(mocked.proxy.fetchViaProxyPool).toHaveBeenCalled();
    expect(mocked.proxy.fetchViaProxy).not.toHaveBeenCalled();
  });

  it("uses paywall wayback fallback when static fetch is blocked", async () => {
    mocked.paywall.getPaywallRule.mockReturnValue({ domains: ["example.com"] });
    mocked.paywall.fetchWaybackSnapshot.mockResolvedValueOnce(
      `<html><body>${"w".repeat(1600)}</body></html>`,
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("forbidden", {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "text/html" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/paywall-wayback?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(mocked.paywall.fetchWaybackSnapshot).toHaveBeenCalled();
    expect(mocked.paywall.fetchArchiveToday).not.toHaveBeenCalled();
  });

  it("uses archive.today fallback when wayback is unavailable", async () => {
    mocked.paywall.getPaywallRule.mockReturnValue({ domains: ["example.com"] });
    mocked.paywall.fetchWaybackSnapshot.mockResolvedValueOnce(null);
    mocked.paywall.fetchArchiveToday.mockResolvedValueOnce(
      `<html><body>${"a".repeat(1600)}</body></html>`,
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("forbidden", {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "text/html" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/paywall-archive?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(mocked.paywall.fetchArchiveToday).toHaveBeenCalled();
  });

  it("returns fetch failed when paywall archives are unavailable", async () => {
    mocked.paywall.getPaywallRule.mockReturnValue({ domains: ["example.com"] });
    mocked.paywall.fetchWaybackSnapshot.mockResolvedValueOnce(null);
    mocked.paywall.fetchArchiveToday.mockResolvedValueOnce(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("forbidden", {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "text/html" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/paywall-fail", {
      headers: { Accept: "application/json" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(502);
    expect(payload.error).toBe("Fetch Failed");
    expect(payload.message).toContain("Status: 403 Forbidden");
  });

  it("prefers JSON-LD content when markdown is short and paywalled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>short static</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));
    mocked.paywall.looksPaywalled.mockReturnValue(true);
    mocked.paywall.extractJsonLdArticle.mockReturnValue("<html><body>jsonld article</body></html>");
    mocked.converter.htmlToMarkdown
      .mockReturnValueOnce({
        markdown: "short",
        title: "Old",
        contentHtml: "<p>old</p>",
      })
      .mockReturnValueOnce({
        markdown: "jsonld content ".repeat(60),
        title: "Json Title",
        contentHtml: "<p>json</p>",
      });

    const req = new Request("https://md.example.com/https://example.com/jsonld?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("jsonld content");
    expect(mocked.converter.htmlToMarkdown.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      mocked.converter.htmlToMarkdown.mock.calls.some(
        (call) => typeof call[0] === "string" && call[0].includes("jsonld article"),
      ),
    ).toBe(true);
  });

  it("tries wayback then archive when paywalled markdown remains short", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>short static</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));
    mocked.paywall.looksPaywalled.mockReturnValue(true);
    mocked.paywall.getPaywallRule.mockReturnValue({ domains: ["example.com"] });
    mocked.paywall.fetchWaybackSnapshot.mockResolvedValueOnce("<html><body>wayback</body></html>");
    mocked.paywall.fetchArchiveToday.mockResolvedValueOnce("<html><body>archive</body></html>");
    mocked.converter.htmlToMarkdown
      .mockReturnValueOnce({
        markdown: "tiny",
        title: "T1",
        contentHtml: "<p>1</p>",
      })
      .mockReturnValueOnce({
        markdown: "still short",
        title: "T2",
        contentHtml: "<p>2</p>",
      })
      .mockReturnValueOnce({
        markdown: "archive-long ".repeat(60),
        title: "T3",
        contentHtml: "<p>3</p>",
      });

    const req = new Request("https://md.example.com/https://example.com/archive-fallback?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("archive-long");
    expect(mocked.paywall.fetchWaybackSnapshot).toHaveBeenCalled();
    expect(mocked.paywall.fetchArchiveToday).toHaveBeenCalled();
  });

  it("replaces final html with AMP content when amp page is available", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("<html><body>orig</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }))
      .mockResolvedValueOnce(new Response("<html><body>amp raw</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    mocked.paywall.looksPaywalled
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    mocked.paywall.getPaywallRule.mockReturnValue({ domains: ["example.com"] });
    mocked.paywall.extractAmpLink.mockReturnValue("https://amp.example.com/article");
    mocked.paywall.stripAmpAccessControls.mockReturnValue(
      `<html><body>${"AMP_REPLACED ".repeat(80)}</body></html>`,
    );
    mocked.converter.htmlToMarkdown.mockImplementation((html: string) => ({
      markdown: html.includes("AMP_REPLACED") ? "amp-markdown" : "orig-markdown",
      title: "Amp",
      contentHtml: "<p>amp</p>",
    }));

    const req = new Request("https://md.example.com/https://example.com/amp?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("amp-markdown");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocked.paywall.stripAmpAccessControls).toHaveBeenCalled();
  });

  it("uses browser fallback when static html looks like challenge and keeps static on browser failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html>cf-challenge<script>document.location='/'</script></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));
    mocked.browser.fetchWithBrowser.mockRejectedValueOnce(new Error("render failed"));

    const req = new Request("https://md.example.com/https://example.com/challenge?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("# md body");
    expect(mocked.browser.fetchWithBrowser).toHaveBeenCalled();
  });

  it("proxies wechat markdown image urls when output format is markdown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>wechat</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));
    mocked.converter.htmlToMarkdown.mockReturnValue({
      markdown: "![a](https://mmbiz.qpic.cn/mmbiz_png/a1/640)",
      title: "wechat",
      contentHtml: "<p>wechat</p>",
    });

    const req = new Request("https://md.example.com/https://mp.weixin.qq.com/s/abc?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("proxied:");
    expect(mocked.converter.proxyImageUrls).toHaveBeenCalled();
  });

  it("returns timeout and generic fetch errors from static fetch path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("request timed out")));

    const timeoutReq = new Request("https://md.example.com/https://example.com/timeout", {
      headers: { Accept: "application/json" },
    });
    const timeoutRes = await worker.fetch(timeoutReq, createMockEnv().env);
    const timeoutPayload = await timeoutRes.json() as { error?: string };

    expect(timeoutRes.status).toBe(504);
    expect(timeoutPayload.error).toBe("Fetch Timeout");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const failedReq = new Request("https://md.example.com/https://example.com/fail", {
      headers: { Accept: "application/json" },
    });
    const failedRes = await worker.fetch(failedReq, createMockEnv().env);
    const failedPayload = await failedRes.json() as { error?: string; message?: string };

    expect(failedRes.status).toBe(502);
    expect(failedPayload.error).toBe("Fetch Failed");
    expect(failedPayload.message).toContain("boom");
  });

  it("applies runtime body-size check in batch even when Content-Length is small", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const hugeBody = JSON.stringify({
      urls: ["https://example.com"],
      pad: "x".repeat(120_000),
    });
    const req = new Request("https://md.example.com/api/batch", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
        "Content-Length": "0",
      },
      body: hugeBody,
    });
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(413);
    expect(payload.error).toBe("Request too large");
  });

  it("returns ConvertError message for batch item unsupported content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("binary", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    ));
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = new Request("https://md.example.com/api/batch", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: ["https://example.com/a"] }),
    });
    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      results?: Array<{ error?: string }>;
    };

    expect(res.status).toBe(200);
    expect(payload.results?.[0].error).toContain("Only HTML and text pages");
  });

  it("returns generic error when unexpected exception happens inside batch item", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>ok</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));
    mocked.converter.htmlToMarkdown.mockImplementationOnce(() => {
      throw new Error("converter exploded");
    });

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = new Request("https://md.example.com/api/batch", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: ["https://example.com/b"] }),
    });
    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      results?: Array<{ error?: string }>;
    };

    expect(res.status).toBe(200);
    expect(payload.results?.[0].error).toBe("Failed to process this URL.");
  });
});
