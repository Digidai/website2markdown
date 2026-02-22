import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

import puppeteer from "@cloudflare/puppeteer";
import { fetchWithBrowser } from "../browser";
import { createMockEnv } from "./test-helpers";

type RequestRecord = {
  abort: ReturnType<typeof vi.fn>;
  continue: ReturnType<typeof vi.fn>;
};

function createMockBrowser(html = "<html><body>browser</body></html>") {
  let requestHandler: ((req: any) => void) | null = null;

  const blockedReq: RequestRecord = { abort: vi.fn(), continue: vi.fn() };
  const lowValueReq: RequestRecord = { abort: vi.fn(), continue: vi.fn() };
  const paywallReq: RequestRecord = { abort: vi.fn(), continue: vi.fn() };
  const allowedReq: RequestRecord = { abort: vi.fn(), continue: vi.fn() };

  const page = {
    setUserAgent: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    setExtraHTTPHeaders: vi.fn(async () => {}),
    on: vi.fn((event: string, cb: (req: any) => void) => {
      if (event === "request") {
        requestHandler = cb;
      }
    }),
    setRequestInterception: vi.fn(async () => {
      if (!requestHandler) return;
      requestHandler({
        url: () => "http://127.0.0.1/private",
        resourceType: () => "document",
        abort: blockedReq.abort,
        continue: blockedReq.continue,
      });
      requestHandler({
        url: () => "https://example.com/font.woff2",
        resourceType: () => "font",
        abort: lowValueReq.abort,
        continue: lowValueReq.continue,
      });
      requestHandler({
        url: () => "https://cdn.tinypass.com/tinypass.js",
        resourceType: () => "script",
        abort: paywallReq.abort,
        continue: paywallReq.continue,
      });
      requestHandler({
        url: () => "https://example.com/article",
        resourceType: () => "document",
        abort: allowedReq.abort,
        continue: allowedReq.continue,
      });
    }),
    goto: vi.fn(async () => {}),
    content: vi.fn(async () => html),
  };

  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };

  return {
    browser,
    page,
    requests: {
      blockedReq,
      lowValueReq,
      paywallReq,
      allowedReq,
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("fetchWithBrowser", () => {
  it("uses adapter flow, applies request interception rules, and closes browser", async () => {
    const mock = createMockBrowser("<html><body>ok-adapter</body></html>");
    vi.mocked(puppeteer.launch).mockResolvedValue(mock.browser as any);

    const result = await fetchWithBrowser(
      "https://www.163.com/dy/article/abc.html",
      createMockEnv().env,
      "md.example.com",
    );

    expect(result).toContain("ok-adapter");
    expect(mock.browser.newPage).toHaveBeenCalledTimes(1);
    expect(mock.page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(mock.requests.blockedReq.abort).toHaveBeenCalledWith("accessdenied");
    expect(mock.requests.lowValueReq.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(mock.requests.paywallReq.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(mock.requests.allowedReq.continue).toHaveBeenCalledTimes(1);
    expect(mock.browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes browser on extraction failure", async () => {
    const mock = createMockBrowser();
    mock.page.content.mockRejectedValueOnce(new Error("content failed"));
    vi.mocked(puppeteer.launch).mockResolvedValue(mock.browser as any);

    await expect(fetchWithBrowser(
      "https://www.163.com/dy/article/error.html",
      createMockEnv().env,
      "md.example.com",
    )).rejects.toThrow("Browser rendering failed");

    expect(mock.browser.close).toHaveBeenCalledTimes(1);
  });

  it("short-circuits when abort signal is already aborted", async () => {
    vi.mocked(puppeteer.launch).mockClear();
    const controller = new AbortController();
    controller.abort();

    await expect(fetchWithBrowser(
      "https://www.163.com/dy/article/abort.html",
      createMockEnv().env,
      "md.example.com",
      controller.signal,
    )).rejects.toThrow("aborted");

    expect(vi.mocked(puppeteer.launch)).not.toHaveBeenCalled();
  });
});
