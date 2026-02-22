import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

import puppeteer from "@cloudflare/puppeteer";
import { fetchWithBrowser } from "../browser";
import { createMockEnv } from "./test-helpers";

type MockReqRecord = {
  abort: ReturnType<typeof vi.fn>;
  continue: ReturnType<typeof vi.fn>;
};

type BrowserFixtureOptions = {
  html?: string;
  gotoError?: unknown;
  gotoImpl?: () => Promise<void>;
  evaluateResult?: unknown;
  title?: unknown;
  closeError?: Error;
  responseEvents?: Array<{
    status: number;
    url: string;
    contentType?: string;
    buffer?: Uint8Array;
  }>;
  onSetRequestInterception?: () => void;
};

function createBrowserFixture(options: BrowserFixtureOptions = {}) {
  let requestHandler: ((req: any) => void) | null = null;
  let responseHandler: ((resp: any) => void) | null = null;

  const reqRecord: MockReqRecord = { abort: vi.fn(), continue: vi.fn() };

  const page = {
    setUserAgent: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    setExtraHTTPHeaders: vi.fn(async () => {}),
    evaluateOnNewDocument: vi.fn(async () => {}),
    on: vi.fn((event: string, cb: (arg: any) => void) => {
      if (event === "request") requestHandler = cb;
      if (event === "response") responseHandler = cb;
    }),
    setRequestInterception: vi.fn(async () => {
      options.onSetRequestInterception?.();
      if (!requestHandler) return;
      requestHandler({
        url: () => "https://example.com/article",
        resourceType: () => "document",
        abort: reqRecord.abort,
        continue: reqRecord.continue,
      });
    }),
    goto: vi.fn(async () => {
      if (options.gotoImpl) return options.gotoImpl();
      if (options.gotoError) throw options.gotoError;
      if (responseHandler) {
        const events = options.responseEvents ?? [
          {
            status: 500,
            url: "https://docs.feishu.cn/asset.png",
            contentType: "image/png",
            buffer: new Uint8Array(),
          },
        ];
        for (const event of events) {
          responseHandler({
            status: () => event.status,
            url: () => event.url,
            headers: () => ({ "content-type": event.contentType ?? "image/png" }),
            buffer: vi.fn(async () => event.buffer ?? new Uint8Array()),
          });
        }
      }
    }),
    click: vi.fn(async () => {}),
    keyboard: {
      press: vi.fn(async () => {}),
    },
    evaluate: vi.fn(async () => options.evaluateResult ?? null),
    title: vi.fn(async () => options.title ?? "Doc Title"),
    content: vi.fn(async () => options.html ?? "<html><body>fallback</body></html>"),
  };

  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {
      if (options.closeError) throw options.closeError;
    }),
  };

  return {
    browser,
    page,
    reqRecord,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("fetchWithBrowser advanced paths", () => {
  it("renders Feishu extracted content when evaluate returns rich text", async () => {
    vi.useFakeTimers();
    const feishuText = [
      "## Section Heading",
      "{{IMG:https://docs.feishu.cn/space/api/box/stream/download/abc}}",
      "This is a long paragraph used to trigger Feishu extracted HTML mode with enough text length.",
      "Another paragraph keeps content above threshold for HTML rendering branch.",
    ].join("\n\n");

    const fixture = createBrowserFixture({
      evaluateResult: {
        text: feishuText,
        images: ["https://docs.feishu.cn/space/api/box/stream/download/abc"],
      },
      title: "Feishu <Doc>",
      html: "<html><body>raw-feishu</body></html>",
    });
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    const promise = fetchWithBrowser(
      "https://team.feishu.cn/wiki/abc",
      createMockEnv().env,
      "md.example.com",
    );
    await vi.advanceTimersByTimeAsync(20_500);
    const result = await promise;

    expect(result).toContain("<h2>Section Heading</h2>");
    expect(result).toContain("<figure><img src=\"https://docs.feishu.cn/space/api/box/stream/download/abc\" /></figure>");
    expect(result).toContain("Feishu &lt;Doc&gt;");
    expect(fixture.page.keyboard.press).toHaveBeenCalled();
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
  });

  it("falls back to raw page content when Feishu extracted text is too short", async () => {
    vi.useFakeTimers();
    const fixture = createBrowserFixture({
      evaluateResult: { text: "short", images: [] },
      html: "<html><body>raw-feishu-fallback</body></html>",
    });
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    const promise = fetchWithBrowser(
      "https://team.feishu.cn/wiki/short",
      createMockEnv().env,
      "md.example.com",
    );
    await vi.advanceTimersByTimeAsync(20_500);
    const result = await promise;

    expect(result).toContain("raw-feishu-fallback");
    expect(fixture.page.content).toHaveBeenCalled();
  });

  it("continues after navigation context destroyed errors and returns extracted content", async () => {
    vi.useFakeTimers();
    const fixture = createBrowserFixture({
      gotoError: new Error("Execution context was destroyed, most likely because of a navigation."),
      html: "<html><body>netease-after-redirect</body></html>",
    });
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    const promise = fetchWithBrowser(
      "https://www.163.com/dy/article/redirect.html",
      createMockEnv().env,
      "md.example.com",
    );
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;

    expect(result).toContain("netease-after-redirect");
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
  });

  it("uses raw page content fallback when adapter extract returns null", async () => {
    const fixture = createBrowserFixture({
      html: "<html><body>twitter-fallback-content</body></html>",
    });
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    const result = await fetchWithBrowser(
      "https://x.com/alice/status/123",
      createMockEnv().env,
      "md.example.com",
    );

    expect(result).toContain("twitter-fallback-content");
    expect(fixture.page.setViewport).toHaveBeenCalled();
    expect(fixture.page.content).toHaveBeenCalled();
  });

  it("wraps non-navigation goto failures as browser rendering errors", async () => {
    const fixture = createBrowserFixture({
      gotoError: new Error("dns failure"),
    });
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    await expect(fetchWithBrowser(
      "https://www.163.com/dy/article/fail.html",
      createMockEnv().env,
      "md.example.com",
    )).rejects.toThrow("Browser rendering failed: dns failure");
  });

  it("wraps launch failures with explicit browser launch context", async () => {
    vi.mocked(puppeteer.launch).mockRejectedValueOnce(new Error("launch unavailable"));

    await expect(fetchWithBrowser(
      "https://www.163.com/dy/article/launch.html",
      createMockEnv().env,
      "md.example.com",
    )).rejects.toThrow("Browser rendering failed: Browser launch failed: launch unavailable");
  });

  it("swallows browser close errors and still returns content", async () => {
    const fixture = createBrowserFixture({
      html: "<html><body>close-error-safe</body></html>",
      closeError: new Error("close failed"),
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    const result = await fetchWithBrowser(
      "https://www.163.com/dy/article/close-error.html",
      createMockEnv().env,
      "md.example.com",
    );

    expect(result).toContain("close-error-safe");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("injects missing Feishu captured images and resolves marker by pathname", async () => {
    vi.useFakeTimers();
    const imageUrl = "https://docs.feishu.cn/space/api/box/stream/download/abc?from=cdn";
    const fixture = createBrowserFixture({
      evaluateResult: {
        text: [
          "{{IMG:https://another.example.com/space/api/box/stream/download/abc}}",
          "This paragraph keeps Feishu extraction in rich mode with enough content for HTML assembly.",
          "Second paragraph ensures output remains above threshold after processing.",
        ].join("\n\n"),
        images: [],
      },
      responseEvents: [
        {
          status: 200,
          url: imageUrl,
          contentType: "image/png",
          buffer: new Uint8Array(6001),
        },
      ],
    });
    const { env, mocks } = createMockEnv();
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    const promise = fetchWithBrowser(
      "https://team.feishu.cn/wiki/with-image",
      env,
      "md.example.com",
    );
    await vi.advanceTimersByTimeAsync(20_500);
    const result = await promise;

    expect(mocks.r2Put).toHaveBeenCalled();
    expect(result).toContain("https://md.example.com/r2img/images/");
    expect(result).toContain("<figure><img src=\"https://md.example.com/r2img/images/");
  });

  it("falls back to data URI when Feishu image storage fails", async () => {
    vi.useFakeTimers();
    const imageUrl = "https://docs.feishu.cn/space/api/box/stream/download/datauri";
    const fixture = createBrowserFixture({
      evaluateResult: {
        text: [
          "{{IMG:https://cdn.example.com/space/api/box/stream/download/datauri}}",
          "Fallback branch should still render image content with large enough text body.",
          "Additional paragraph to keep content over extraction threshold for Feishu mode.",
        ].join("\n\n"),
        images: [],
      },
      responseEvents: [
        {
          status: 200,
          url: imageUrl,
          contentType: "image/png",
          buffer: new Uint8Array(6001),
        },
      ],
    });
    const { env, mocks } = createMockEnv();
    mocks.r2Put.mockRejectedValue(new Error("r2 down"));
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    const promise = fetchWithBrowser(
      "https://team.feishu.cn/wiki/fallback-image",
      env,
      "md.example.com",
    );
    await vi.advanceTimersByTimeAsync(20_500);
    const result = await promise;

    expect(mocks.r2Put).toHaveBeenCalled();
    expect(result).toContain("data:image/png;base64,");
  });

  it("aborts in-flight adapter navigation when request signal aborts", async () => {
    const controller = new AbortController();
    const fixture = createBrowserFixture({
      gotoImpl: async () => await new Promise<void>(() => {}),
    });
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    const promise = fetchWithBrowser(
      "https://www.163.com/dy/article/abort-mid-flight.html",
      createMockEnv().env,
      "md.example.com",
      controller.signal,
    );
    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toThrow("aborted");
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
  });

  it("handles already-aborted signal at timeout setup stage", async () => {
    const controller = new AbortController();
    const fixture = createBrowserFixture({
      onSetRequestInterception: () => controller.abort(),
      gotoImpl: async () => await new Promise<void>(() => {}),
    });
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    await expect(fetchWithBrowser(
      "https://www.163.com/dy/article/abort-before-goto.html",
      createMockEnv().env,
      "md.example.com",
      controller.signal,
    )).rejects.toThrow("aborted");
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
  });

  it("wraps non-Error failures from browser stack", async () => {
    const fixture = createBrowserFixture({
      gotoError: "string-failure",
    });
    vi.mocked(puppeteer.launch).mockResolvedValue(fixture.browser as any);

    await expect(fetchWithBrowser(
      "https://www.163.com/dy/article/string-error.html",
      createMockEnv().env,
      "md.example.com",
    )).rejects.toThrow("Browser rendering failed: string-failure");
  });
});
