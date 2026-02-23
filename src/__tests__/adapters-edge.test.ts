import { afterEach, describe, expect, it, vi } from "vitest";
import { kr36Adapter } from "../browser/adapters/36kr";
import { csdnAdapter } from "../browser/adapters/csdn";
import { juejinAdapter } from "../browser/adapters/juejin";
import { notionAdapter } from "../browser/adapters/notion";
import { toutiaoAdapter } from "../browser/adapters/toutiao";
import { weiboAdapter } from "../browser/adapters/weibo";
import { redditAdapter } from "../browser/adapters/reddit";
import { yuqueAdapter } from "../browser/adapters/yuque";
import { zhihuAdapter } from "../browser/adapters/zhihu";
import { twitterAdapter } from "../browser/adapters/twitter";

type AdapterMockPage = {
  setUserAgent: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
  evaluateOnNewDocument: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  cookies: ReturnType<typeof vi.fn>;
};

function createAdapterPage(html = "<html><body>ok</body></html>"): AdapterMockPage {
  return {
    setUserAgent: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    setExtraHTTPHeaders: vi.fn(async () => {}),
    evaluateOnNewDocument: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    evaluate: vi.fn(async () => 0),
    content: vi.fn(async () => html),
    cookies: vi.fn(async () => []),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("adapter edge behavior", () => {
  it("extracts 36kr content on selector success", async () => {
    const page = createAdapterPage("<html><body>36kr content</body></html>");
    await kr36Adapter.configurePage!(page as any);

    vi.useFakeTimers();
    const promise = kr36Adapter.extract!(page as any, new Map());
    await vi.advanceTimersByTimeAsync(1600);
    const result = await promise;

    expect(page.setUserAgent).toHaveBeenCalled();
    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    expect(page.waitForSelector).toHaveBeenCalled();
    expect(result?.html).toContain("36kr content");
  });

  it("throws 36kr PROXY_RETRY when selector missing and cookies exist", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.evaluate.mockResolvedValueOnce(30);
    page.cookies.mockResolvedValueOnce([{ name: "sid", value: "abc" }]);

    await expect(kr36Adapter.extract!(page as any, new Map())).rejects.toThrow(/PROXY_RETRY_TOKEN:/);
  });

  it("throws 36kr timeout when selector missing and cookies are unavailable", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.evaluate.mockResolvedValueOnce(10);
    page.cookies.mockResolvedValueOnce([]);

    await expect(kr36Adapter.extract!(page as any, new Map())).rejects.toThrow(
      "36kr page did not load article content within timeout.",
    );
  });

  it("returns CSDN page content when selector is missing but body is substantial", async () => {
    const page = createAdapterPage("<html><body>csdn full content</body></html>");
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.evaluate.mockResolvedValueOnce(2500);

    const result = await csdnAdapter.extract!(page as any, new Map());
    expect(result?.html).toContain("csdn full content");
  });

  it("extracts CSDN content on selector success", async () => {
    const page = createAdapterPage("<html><body>csdn main flow</body></html>");
    await csdnAdapter.configurePage!(page as any);

    vi.useFakeTimers();
    const promise = csdnAdapter.extract!(page as any, new Map());
    await vi.advanceTimersByTimeAsync(1600);
    const result = await promise;

    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    expect(page.waitForSelector).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalled();
    expect(result?.html).toContain("csdn main flow");
  });

  it("throws CSDN PROXY_RETRY when selector missing and cookies exist", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.evaluate.mockResolvedValueOnce(100);
    page.cookies.mockResolvedValueOnce([{ name: "c_user", value: "v" }]);

    await expect(csdnAdapter.extract!(page as any, new Map())).rejects.toThrow(/PROXY_RETRY_TOKEN:/);
  });

  it("throws Juejin timeout when selector missing and no cookies are available", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.cookies.mockResolvedValueOnce([]);

    await expect(juejinAdapter.extract!(page as any, new Map())).rejects.toThrow(
      "Juejin page did not load article content within timeout.",
    );
  });

  it("throws Juejin PROXY_RETRY when selector missing and cookies exist", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.cookies.mockResolvedValueOnce([{ name: "sessionid", value: "j1" }]);

    await expect(juejinAdapter.extract!(page as any, new Map())).rejects.toThrow(/PROXY_RETRY_TOKEN:/);
  });

  it("extracts Juejin content on selector success", async () => {
    const page = createAdapterPage("<html><body>juejin main flow</body></html>");
    await juejinAdapter.configurePage!(page as any);

    vi.useFakeTimers();
    const promise = juejinAdapter.extract!(page as any, new Map());
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;

    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    expect(page.waitForSelector).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalled();
    expect(result?.html).toContain("juejin main flow");
  });

  it("throws Toutiao PROXY_RETRY when selector missing and cookies exist", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.cookies.mockResolvedValueOnce([
      { name: "ttwid", value: "v1" },
      { name: "sessionid", value: "v2" },
    ]);

    await expect(toutiaoAdapter.extract!(page as any, new Map())).rejects.toThrow(/PROXY_RETRY_TOKEN:/);
  });

  it("throws Toutiao timeout when selector missing and no cookies are available", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.cookies.mockResolvedValueOnce([]);

    await expect(toutiaoAdapter.extract!(page as any, new Map())).rejects.toThrow(
      "Toutiao page did not load article content within timeout.",
    );
  });

  it("extracts Toutiao content on selector success", async () => {
    const page = createAdapterPage("<html><body>toutiao main flow</body></html>");
    await toutiaoAdapter.configurePage!(page as any);

    vi.useFakeTimers();
    const promise = toutiaoAdapter.extract!(page as any, new Map());
    await vi.advanceTimersByTimeAsync(1600);
    const result = await promise;

    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    expect(page.waitForSelector).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalled();
    expect(result?.html).toContain("toutiao main flow");
  });

  it("configures and extracts Reddit content", async () => {
    const page = createAdapterPage("<html><body>reddit body</body></html>");
    await redditAdapter.configurePage!(page as any);
    const result = await redditAdapter.extract!(page as any, new Map());

    expect(page.setUserAgent).toHaveBeenCalled();
    expect(page.setViewport).toHaveBeenCalled();
    expect(result?.html).toContain("reddit body");
  });

  it("configures and extracts Notion content", async () => {
    const page = createAdapterPage("<html><body>notion body</body></html>");
    await notionAdapter.configurePage!(page as any);

    vi.useFakeTimers();
    const promise = notionAdapter.extract!(page as any, new Map());
    await vi.advanceTimersByTimeAsync(4100);
    const result = await promise;

    expect(page.setUserAgent).toHaveBeenCalled();
    expect(page.setViewport).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalled();
    expect(result?.html).toContain("notion body");
  });

  it("configures and extracts Yuque content", async () => {
    const page = createAdapterPage("<html><body>yuque body</body></html>");
    await yuqueAdapter.configurePage!(page as any);

    vi.useFakeTimers();
    const promise = yuqueAdapter.extract!(page as any, new Map());
    await vi.advanceTimersByTimeAsync(3100);
    const result = await promise;

    expect(page.setUserAgent).toHaveBeenCalled();
    expect(page.setExtraHTTPHeaders).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalled();
    expect(result?.html).toContain("yuque body");
  });

  it("throws Zhihu PROXY_RETRY when redirected to signin and cookies exist", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.evaluate.mockResolvedValueOnce("https://www.zhihu.com/signin");
    page.cookies.mockResolvedValueOnce([{ name: "z_c0", value: "cookie" }]);

    await expect(zhihuAdapter.extract!(page as any, new Map())).rejects.toThrow(/PROXY_RETRY_TOKEN:/);
  });

  it("throws Zhihu anti-bot error when blocked marker is detected", async () => {
    const page = createAdapterPage();
    page.waitForSelector.mockResolvedValueOnce(undefined);
    page.evaluate.mockResolvedValueOnce(true);

    vi.useFakeTimers();
    const promise = zhihuAdapter.extract!(page as any, new Map());
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1600);
    await assertion;
  });

  it("extracts Zhihu content when page is available and not blocked", async () => {
    const page = createAdapterPage("<html><body>zhihu content</body></html>");
    page.waitForSelector.mockResolvedValueOnce(undefined);
    page.evaluate.mockResolvedValueOnce(false);

    vi.useFakeTimers();
    const promise = zhihuAdapter.extract!(page as any, new Map());
    await vi.advanceTimersByTimeAsync(1600);
    const result = await promise;

    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(result?.html).toContain("zhihu content");
  });

  it("throws Weibo PROXY_RETRY when redirected to login page", async () => {
    const page = createAdapterPage();
    page.evaluate.mockResolvedValueOnce("https://passport.weibo.com/signin");
    page.cookies.mockResolvedValueOnce([{ name: "SUB", value: "token" }]);

    vi.useFakeTimers();
    const promise = weiboAdapter.extract!(page as any, new Map());
    const assertion = expect(promise).rejects.toThrow(/PROXY_RETRY_TOKEN:/);
    await vi.advanceTimersByTimeAsync(3100);
    await assertion;
  });

  it("throws Weibo login redirect error when no cookies are available", async () => {
    const page = createAdapterPage();
    await weiboAdapter.configurePage!(page as any);
    page.evaluate.mockResolvedValueOnce("https://passport.weibo.com/signin");
    page.cookies.mockResolvedValueOnce([]);

    vi.useFakeTimers();
    const promise = weiboAdapter.extract!(page as any, new Map());
    const assertion = expect(promise).rejects.toThrow("Weibo redirected to login page.");
    await vi.advanceTimersByTimeAsync(3100);
    await assertion;
    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
  });

  it("throws Weibo PROXY_RETRY when inline login wall is detected", async () => {
    const page = createAdapterPage();
    page.evaluate
      .mockResolvedValueOnce("https://weibo.com/u/1")
      .mockResolvedValueOnce(true);
    page.cookies.mockResolvedValueOnce([{ name: "SUBP", value: "token2" }]);

    vi.useFakeTimers();
    const promise = weiboAdapter.extract!(page as any, new Map());
    const assertion = expect(promise).rejects.toThrow(/PROXY_RETRY_TOKEN:/);
    await vi.advanceTimersByTimeAsync(3100);
    await assertion;
  });

  it("throws Weibo inline login verification error without cookies", async () => {
    const page = createAdapterPage();
    page.evaluate
      .mockResolvedValueOnce("https://weibo.com/u/1")
      .mockResolvedValueOnce(true);
    page.cookies.mockResolvedValueOnce([]);

    vi.useFakeTimers();
    const promise = weiboAdapter.extract!(page as any, new Map());
    const assertion = expect(promise).rejects.toThrow("Weibo requires login verification.");
    await vi.advanceTimersByTimeAsync(3100);
    await assertion;
  });

  it("throws Weibo content-timeout error without cookies", async () => {
    const page = createAdapterPage();
    page.evaluate
      .mockResolvedValueOnce("https://weibo.com/u/1")
      .mockResolvedValueOnce(false);
    page.waitForSelector.mockRejectedValueOnce(new Error("timeout"));
    page.cookies.mockResolvedValueOnce([]);

    vi.useFakeTimers();
    const promise = weiboAdapter.extract!(page as any, new Map());
    const assertion = expect(promise).rejects.toThrow("Weibo page did not load content within timeout.");
    await vi.advanceTimersByTimeAsync(3100);
    await assertion;
  });

  it("extracts Weibo content when page and selector are available", async () => {
    const page = createAdapterPage("<html><body>weibo body</body></html>");
    page.evaluate
      .mockResolvedValueOnce("https://weibo.com/u/1")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(undefined);
    page.waitForSelector.mockResolvedValueOnce(undefined);

    vi.useFakeTimers();
    const promise = weiboAdapter.extract!(page as any, new Map());
    await vi.advanceTimersByTimeAsync(4700);
    const result = await promise;

    expect(page.waitForSelector).toHaveBeenCalled();
    expect(result?.html).toContain("weibo body");
  });
});

describe("twitter adapter thread behavior", () => {
  it("returns null for non-status twitter URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await twitterAdapter.fetchDirect!("https://x.com/alice");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders multi-tweet thread from fxtwitter + timeline payload", async () => {
    const timelinePayload = {
      props: {
        pageProps: {
          timeline: {
            entries: [
              {
                content: {
                  tweet: {
                    id_str: "300",
                    conversation_id_str: "100",
                    full_text: "continuation tweet",
                    created_at: "Mon Apr 01 10:00:00 +0000 2024",
                    favorite_count: 7,
                    retweet_count: 3,
                    reply_count: 2,
                    in_reply_to_status_id_str: "200",
                    user: { name: "Alice", screen_name: "alice" },
                    entities: {
                      media: [{ type: "photo", media_url_https: "https://img.example/photo.jpg" }],
                    },
                    mediaDetails: [
                      {
                        type: "video",
                        media_url_https: "https://img.example/thumb.jpg",
                        video_info: { variants: [{ url: "https://video.example/v.m3u8" }] },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqUrl = String(input);
      if (reqUrl.includes("api.fxtwitter.com/alice/status/200")) {
        return new Response(JSON.stringify({
          tweet: {
            id: "200",
            text: "reply line 1\nline 2",
            author: { name: "Alice", screen_name: "alice" },
            created_at: "Mon Apr 01 09:00:00 +0000 2024",
            likes: 5,
            retweets: 2,
            replies: 1,
            replying_to: "alice",
            replying_to_status: "100",
            quote: { author: { name: "Bob", screen_name: "bob" }, text: "quoted text" },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (reqUrl.includes("api.fxtwitter.com/alice/status/100")) {
        return new Response(JSON.stringify({
          tweet: {
            id: "100",
            text: "root tweet",
            author: { name: "Alice", screen_name: "alice" },
            created_at: "Mon Apr 01 08:00:00 +0000 2024",
            likes: 10,
            retweets: 4,
            replies: 3,
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (reqUrl.includes("syndication.twitter.com/srv/timeline-profile")) {
        return new Response(
          `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(timelinePayload)}</script></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      throw new Error(`Unexpected fetch URL: ${reqUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!("https://x.com/alice/status/200");

    expect(html).toContain("Alice (@alice) — Thread");
    expect(html).toContain("root tweet");
    expect(html).toContain("reply line 1<br>line 2");
    expect(html).toContain("continuation tweet");
    expect(html).toContain("quoted text");
    expect(html).toContain("3 tweets");
    expect(html).toContain("Video: https://video.example/v.m3u8");
  });

  it("renders X article blocks when fxtwitter tweet text is empty", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqUrl = String(input);
      if (reqUrl.includes("api.fxtwitter.com/gosailglobal/status/2025402533972480275")) {
        return new Response(JSON.stringify({
          tweet: {
            id: "2025402533972480275",
            text: "",
            raw_text: { text: "https://t.co/OXfzzWVB9C" },
            author: { name: "Jason Zhu", screen_name: "GoSailGlobal" },
            created_at: "Sun Feb 22 02:49:28 +0000 2026",
            likes: 163,
            retweets: 31,
            replies: 11,
            article: {
              id: "2025399436021825537",
              title: "OpenClaw Skills Deep Dive",
              preview_text: "Preview text fallback.",
              cover_media: {
                media_info: {
                  original_img_url: "https://pbs.twimg.com/media/HBus9uqbgAAlboc.jpg",
                },
              },
              content: {
                blocks: [
                  { type: "unstyled", text: "This is paragraph one." },
                  { type: "header-two", text: "Section title" },
                  { type: "unordered-list-item", text: "List item" },
                ],
              },
            },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (reqUrl.includes("syndication.twitter.com/srv/timeline-profile")) {
        return new Response("rate limited", { status: 429 });
      }
      throw new Error(`Unexpected fetch URL: ${reqUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!(
      "https://x.com/gosailglobal/status/2025402533972480275?s=46&t=abc",
    );

    expect(html).toContain("OpenClaw Skills Deep Dive");
    expect(html).toContain("This is paragraph one.");
    expect(html).toContain("Section title");
    expect(html).toContain("- List item");
    expect(html).toContain("https://pbs.twimg.com/media/HBus9uqbgAAlboc.jpg");
    expect(html).not.toContain("https://t.co/OXfzzWVB9C");
  });

  it("falls back to raw_text when tweet.text is empty", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqUrl = String(input);
      if (reqUrl.includes("api.fxtwitter.com/alice/status/555")) {
        return new Response(JSON.stringify({
          tweet: {
            id: "555",
            text: "",
            raw_text: { text: "hello from raw_text" },
            author: { name: "Alice", screen_name: "alice" },
            created_at: "Mon Apr 01 09:00:00 +0000 2024",
            likes: 1,
            retweets: 0,
            replies: 0,
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (reqUrl.includes("syndication.twitter.com/srv/timeline-profile")) {
        return new Response("{}", { status: 429 });
      }
      throw new Error(`Unexpected fetch URL: ${reqUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!("https://x.com/alice/status/555");

    expect(html).toContain("hello from raw_text");
  });

  it("returns null when both fxtwitter and oEmbed fail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!("https://twitter.com/alice/status/999");

    expect(html).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
