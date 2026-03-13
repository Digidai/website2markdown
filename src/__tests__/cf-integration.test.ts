import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockEnv } from "./test-helpers";

const mocked = vi.hoisted(() => {
  // Sentinel object used to verify genericAdapter identity checks
  const fakeGenericAdapter = {
    match: () => true,
    alwaysBrowser: false,
    configurePage: async () => {},
    extract: async () => null,
  };

  return {
  browser: {
    fetchWithBrowser: vi.fn(),
    alwaysNeedsBrowser: vi.fn(),
    getAdapter: vi.fn(),
    getBrowserCapacityStats: vi.fn(),
    genericAdapter: fakeGenericAdapter,
  },
  cfRest: {
    fetchViaCfMarkdown: vi.fn(),
    fetchViaCfContent: vi.fn(),
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
};
});

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

vi.mock("../browser", () => ({
  fetchWithBrowser: mocked.browser.fetchWithBrowser,
  alwaysNeedsBrowser: mocked.browser.alwaysNeedsBrowser,
  getAdapter: mocked.browser.getAdapter,
  getBrowserCapacityStats: mocked.browser.getBrowserCapacityStats,
  genericAdapter: mocked.browser.genericAdapter,
}));

vi.mock("../cf-rest", () => ({
  fetchViaCfMarkdown: mocked.cfRest.fetchViaCfMarkdown,
  fetchViaCfContent: mocked.cfRest.fetchViaCfContent,
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
  // Default to genericAdapter so CF eligibility passes
  mocked.browser.getAdapter.mockReturnValue(mocked.browser.genericAdapter);
  mocked.browser.getBrowserCapacityStats.mockReturnValue({
    active: 0, queued: 0, maxConcurrent: 2, maxQueueLength: 50, queueTimeoutMs: 10000,
  });

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

  mocked.cfRest.fetchViaCfMarkdown.mockResolvedValue({
    markdown: "# CF Title\n\nSome long content from CF that is definitely more than two hundred characters in length to pass the threshold check. Adding extra sentences to ensure we comfortably exceed the minimum quality threshold for CJK-friendly validation.",
    browserMsUsed: 0,
  });
  mocked.cfRest.fetchViaCfContent.mockResolvedValue(
    "<html><body><h1>CF Title</h1><p>Content from CF that is definitely more than two hundred characters in length to pass the threshold check plus some extra padding text to make sure it is long enough for the test.</p></body></html>",
  );
});

function cfEnv(overrides?: Record<string, unknown>) {
  return createMockEnv({
    CF_ACCOUNT_ID: "test-account-id",
    CF_API_TOKEN: "test-api-token",
    ...overrides,
  } as any);
}

describe("CF REST API integration in convertUrl", () => {
  it("uses CF /markdown for eligible URLs with engine=cf", async () => {
    const { env } = cfEnv();
    const req = new Request("https://md.example.com/https://example.com/page?raw=true&engine=cf", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("# CF Title");
    expect(res.headers.get("X-Markdown-Method")).toBe("cf");
    expect(mocked.cfRest.fetchViaCfMarkdown).toHaveBeenCalledTimes(1);
  });

  it("auto-selects CF for eligible URLs without engine param", async () => {
    const { env } = cfEnv();
    const req = new Request("https://md.example.com/https://example.com/page?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("cf");
    expect(mocked.cfRest.fetchViaCfMarkdown).toHaveBeenCalledTimes(1);
  });

  it("skips CF for adapter-matched URLs (non-generic adapter)", async () => {
    const specialAdapter = makeAdapter();
    mocked.browser.getAdapter.mockReturnValue(specialAdapter);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>static body</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const { env } = cfEnv();
    const req = new Request("https://md.example.com/https://mp.weixin.qq.com/s/abc?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(mocked.cfRest.fetchViaCfMarkdown).not.toHaveBeenCalled();
  });

  it("skips CF for paywalled URLs", async () => {
    mocked.paywall.getPaywallRule.mockReturnValue({ name: "test" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>paywall body</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const { env } = cfEnv();
    const req = new Request("https://md.example.com/https://example.com/paywalled?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(mocked.cfRest.fetchViaCfMarkdown).not.toHaveBeenCalled();
  });

  it("skips CF for negative-cached domains", async () => {
    const { env, mocks } = cfEnv();
    // Simulate negative cache hit
    mocks.kvGet.mockImplementation(async (key: string) => {
      if (key.startsWith("cf_blocked:")) return "1";
      return null;
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>fallback body</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/blocked?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(mocked.cfRest.fetchViaCfMarkdown).not.toHaveBeenCalled();
  });

  it("falls back to local pipeline when CF returns short content", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocked.cfRest.fetchViaCfMarkdown.mockResolvedValue({
      markdown: "short",
      browserMsUsed: 0,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>fallback content</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const { env } = cfEnv();
    const req = new Request("https://md.example.com/https://example.com/cf-empty?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    // Should have attempted CF, then fallen back
    expect(mocked.cfRest.fetchViaCfMarkdown).toHaveBeenCalledTimes(1);
    // Fallback path should have produced content
    const text = await res.text();
    expect(text).toContain("# md body");
  });

  it("falls back to local pipeline when CF throws an error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocked.cfRest.fetchViaCfMarkdown.mockRejectedValue(new Error("CF API timeout"));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>fallback after error</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const { env } = cfEnv();
    const req = new Request("https://md.example.com/https://example.com/cf-error?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(mocked.cfRest.fetchViaCfMarkdown).toHaveBeenCalledTimes(1);
    const text = await res.text();
    expect(text).toContain("# md body");
  });

  it("caches CF results in KV", async () => {
    const { env } = cfEnv();
    const req = new Request("https://md.example.com/https://example.com/cacheable?raw=true&engine=cf", {
      headers: { Accept: "text/markdown" },
    });
    await worker.fetch(req, env);

    expect(mocked.cache.setCache).toHaveBeenCalledTimes(1);
    const setCacheArgs = mocked.cache.setCache.mock.calls[0];
    expect(setCacheArgs[3]).toMatchObject({ method: "cf" });
  });

  it("skips CF when CF_ACCOUNT_ID is not configured", async () => {
    const { env } = createMockEnv(); // no CF credentials

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>no-cf body</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/no-cf?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(mocked.cfRest.fetchViaCfMarkdown).not.toHaveBeenCalled();
  });
});

describe("CF integration in batch handler", () => {
  it("auto-selects CF for eligible URLs in batch", async () => {
    const { env } = cfEnv({ API_TOKEN: "batch-token" });

    const req = new Request("https://md.example.com/api/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer batch-token",
      },
      body: JSON.stringify({
        urls: ["https://example.com/a", "https://example.com/b"],
      }),
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toHaveLength(2);
    // Both should have been processed via CF
    expect(mocked.cfRest.fetchViaCfMarkdown).toHaveBeenCalledTimes(2);
    expect(body.results[0].method).toBe("cf");
    expect(body.results[1].method).toBe("cf");
  });

  it("mixes CF and non-CF conversion in same batch", async () => {
    const specialAdapter = makeAdapter();
    mocked.browser.getAdapter.mockImplementation((url: string) => {
      if (url.includes("special.com")) return specialAdapter;
      return mocked.browser.genericAdapter;
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>static body</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const { env } = cfEnv({ API_TOKEN: "batch-token" });

    const req = new Request("https://md.example.com/api/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer batch-token",
      },
      body: JSON.stringify({
        urls: [
          "https://example.com/generic",
          "https://special.com/page",
        ],
      }),
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toHaveLength(2);
    // First URL should use CF, second should not
    expect(body.results[0].method).toBe("cf");
    expect(body.results[1].method).not.toBe("cf");
  });
});
