import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));
vi.mock("../proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../proxy")>()),
  fetchViaProxyPool: vi.fn(),
}));
import { fetchViaProxyPool } from "../proxy";
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
import { substackAdapter } from "../browser/adapters/substack";
import { getAdapter } from "../browser";
import { fetchFeishuSsr } from "../browser/adapters/feishu-ssr";

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

  it("returns null when fxtwitter, syndication, and oEmbed all fail", async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const reqUrl = typeof input === "string" ? input : input.url;
      if (reqUrl.includes("api.fxtwitter.com")) {
        return new Response("{}", { status: 500 });
      }
      if (reqUrl.includes("cdn.syndication.twimg.com")) {
        // not-found returns an empty object — no id_str
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (reqUrl.includes("publish.twitter.com/oembed")) {
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!("https://twitter.com/alice/status/999");

    expect(html).toBeNull();
  });
});

describe("API-first fetchDirect paths", () => {
  it("routes Weibo long articles to the article endpoint, not the status API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqUrl = String(input);
      if (reqUrl === "https://card.weibo.com/article/m/aj/detail?id=2309405346438485245962") {
        return Response.json({
          code: "100000",
          data: { title: "长文标题", userinfo: { screen_name: "作者" }, content: "<p>第一段</p><p>第二段</p>" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${reqUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await weiboAdapter.fetchDirect!("https://weibo.com/ttarticle/p/show?id=2309405346438485245962");

    expect(html).toContain("<h1>长文标题</h1>");
    expect(html).toContain("<p>第一段</p><p>第二段</p>");
    expect(html).toContain("作者");
  });

  it("reads Substack posts from the post API by slug", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqUrl = String(input);
      if (reqUrl === "https://example.substack.com/api/v1/posts/my-post") {
        return Response.json({
          title: "My Post",
          subtitle: "A subtitle",
          post_date: "2026-10-28T05:00:00.000Z",
          publishedBylines: [{ name: "Ada" }],
          body_html: "<p>Body paragraph.</p>",
        });
      }
      throw new Error(`Unexpected fetch URL: ${reqUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = getAdapter("https://example.substack.com/p/my-post?utm_source=x");
    const html = await adapter.fetchDirect!("https://example.substack.com/p/my-post?utm_source=x");

    expect(adapter).toBe(substackAdapter);
    expect(html).toContain("<h1>My Post</h1>");
    expect(html).toContain("Ada · 2026-10-28");
    expect(html).toContain("<p>Body paragraph.</p>");
    expect(getAdapter("https://example.substack.com/")).not.toBe(substackAdapter);
  });

  it("retries a Substack 429 through the configured proxy, and only then", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    vi.mocked(fetchViaProxyPool).mockResolvedValue({
      status: 200, headers: {}, body: JSON.stringify({ title: "Proxied", body_html: "<p>Via proxy.</p>" }),
    } as never);
    const url = "https://example.substack.com/p/my-post";

    expect(await substackAdapter.fetchDirect!(url, {} as never)).toBeNull();
    expect(fetchViaProxyPool).not.toHaveBeenCalled();

    const html = await substackAdapter.fetchDirect!(url, { PROXY_URL: "u:p@proxy.test:3000" } as never);
    expect(html).toContain("<p>Via proxy.</p>");
    const [apiUrl, proxies] = vi.mocked(fetchViaProxyPool).mock.calls[0];
    expect(apiUrl).toBe("https://example.substack.com/api/v1/posts/my-post");
    expect(proxies).toEqual([{ host: "proxy.test", port: 3000, username: "u", password: "p" }]);
  });

  it("retries the redirected custom-domain API URL when that answers 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const resp = new Response("slow down", { status: 429 });
      Object.defineProperty(resp, "url", { value: "https://www.example.com/api/v1/posts/my-post" });
      return resp;
    }));
    vi.mocked(fetchViaProxyPool).mockClear().mockResolvedValue({
      status: 200, headers: {}, body: JSON.stringify({ title: "Proxied", body_html: "<p>Via proxy.</p>" }),
    } as never);

    await substackAdapter.fetchDirect!("https://example.substack.com/p/my-post", { PROXY_URL: "u:p@proxy.test:3000" } as never);
    expect(vi.mocked(fetchViaProxyPool).mock.calls[0][0]).toBe("https://www.example.com/api/v1/posts/my-post");
  });

});

describe("Notion public page API", () => {
  const PAGE = "82734307-494a-429c-9ccf-0b98e1d8a80c";
  const block = (id: string, value: Record<string, unknown>) => ({ [id]: { value: { value: { id, ...value } } } });

  it("pages through chunks, fills in missing column blocks, and renders the tree", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const reqUrl = String(input);
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (reqUrl.endsWith("/api/v3/loadCachedPageChunkV2") && body.chunkNumber === 0) {
        return Response.json({
          spaceId: "space-1",
          cursors: [{ stack: [[{ table: "block", id: PAGE, index: 3 }]] }],
          recordMap: { block: {
            ...block(PAGE, { type: "page", properties: { title: [["Mandarin Guide"]] }, content: ["b1", "b2", "cols", "b3"] }),
            ...block("b1", { type: "bulleted_list", properties: { title: [["first ", [["b"]]], ["link", [["a", "https://x.test/"]]]] } }),
            ...block("b2", { type: "bulleted_list", properties: { title: [["second"]] } }),
            ...block("cols", { type: "column_list", content: ["col"] }),
            ...block("col", { type: "column", content: ["inside"] }),
          } },
        });
      }
      if (reqUrl.endsWith("/api/v3/loadCachedPageChunkV2") && body.chunkNumber === 1) {
        return Response.json({ cursors: [], recordMap: { block: {
          ...block("b3", { type: "code", properties: { title: [["let a = 1 < 2;"]], language: [["JavaScript"]] } }),
        } } });
      }
      if (reqUrl.endsWith("/api/v3/syncRecordValuesMain")) {
        return Response.json({ recordMap: { block: block("inside", { type: "text", properties: { title: [["column text"]] } }) } });
      }
      throw new Error(`Unexpected fetch URL: ${reqUrl}`);
    }));

    // The slug ends in hex letters ("Gui-de"); the id is only the last 32 hex chars.
    const html = await notionAdapter.fetchDirect!(`https://site.notion.site/Mandarin-Guide-${PAGE.replace(/-/g, "")}`);

    expect(bodies[0].page.id).toBe(PAGE);
    expect(bodies[1].cursor.stack[0][0].index).toBe(3);
    expect(bodies[2].requests).toEqual([{ pointer: { table: "block", id: "inside", spaceId: "space-1" }, version: -1 }]);
    expect(html).toContain("<h1>Mandarin Guide</h1>");
    expect(html).toContain('<ul><li><strong>first </strong><a href="https://x.test/">link</a></li><li>second</li></ul>');
    expect(html).toContain("<p>column text</p>");
    expect(html).toContain('<pre><code class="language-javascript">let a = 1 &lt; 2;</code></pre>');
  });

  it("returns null for private pages the API does not expose", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cursors: [], recordMap: { block: {} } })));
    expect(await notionAdapter.fetchDirect!(`https://site.notion.site/${PAGE.replace(/-/g, "")}`)).toBeNull();
  });
});

describe("Feishu crawler-rendered document data", () => {
  const page = (data: unknown) =>
    `<html><script>window.DATA = Object.assign({}, window.DATA, { clientVars: Object(${JSON.stringify({ data })}) });</script></html>`;
  const text = (s: string, attribs = `+${s.length.toString(36)}`, pool: Record<string, [string, string]> = {}) =>
    ({ apool: { numToAttrib: pool }, initialAttributedTexts: { attribs: { 0: attribs }, text: { 0: s } } });

  it("decodes attribute runs into bold text and links, and flags truncated docs", async () => {
    const blockMap = {
      root: { id: "root", data: { type: "page", text: text("Doc title"), children: ["h", "p", "img", "later"] } },
      h: { id: "h", data: { type: "heading1", text: text("Setup") } },
      // "Go to " plain (6), "console" bold+link (7), "." plain (1)
      p: { id: "p", data: { type: "text", text: text("Go to console.", "*0+6*1*2+7*0+1", {
        0: ["author", "1"], 1: ["bold", "true"], 2: ["link", "https%3A%2F%2Fconsole.test%2Fkey"],
      }) } },
      img: { id: "img", data: { type: "image", image: { token: "t" } } },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page({ block_map: blockMap, has_more: true }))));

    const result = await fetchFeishuSsr("https://x.feishu.cn/wiki/abc");

    expect(result?.complete).toBe(false);
    expect(result?.html).toContain("<h1>Doc title</h1><h2>Setup</h2>");
    expect(result?.html).toContain('<p>Go to <a href="https://console.test/key"><strong>console</strong></a>.</p>');
    expect(result?.html).toContain("【图片】");
    expect(result?.html).toContain("只包含公开页面预载的前半部分");
  });

  it("returns null when the page carries no document data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><body>login</body></html>")));
    expect(await fetchFeishuSsr("https://x.feishu.cn/wiki/abc")).toBeNull();
  });
});

describe("Juejin and Yuque public paths", () => {
  it("solves Juejin's WAF challenge and retries with the cookie", async () => {
    // Captured from a Workers egress; sha256(a + "9") === c.
    const cs = "eyJ2Ijp7ImEiOiJuWFQwTS9PZ2lZYnAvU1p1eDQ3U0VVajM2OC94MnNJWm9mL3hsS3Q4OWE0PSIsImIiOjE3OTM1MzIyMTAsImMiOiJ1RXlYSlFmMGlDWU9ic3o4RnRDRUtjUit2WGZnZGh6RzNxN0p1RVNwUUpjPSJ9LCJzIjoiQmNhMnBhR2Q4akNvWW9vTWR4Ri9Ub0NFeHZyc0svWlZPRW1uYy9Nay9FOD0ifQ";
    const challengePage = `<script>var wci="_wafchallengeid",cs="${cs}",c=JSON.parse(atob(cs));</script>`;
    const article = '<html><body><div class="article-viewer markdown-body"><p>正文</p></div></body></html>';
    const cookies: Array<string | undefined> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const cookie = (init?.headers as Record<string, string>).Cookie;
      cookies.push(cookie);
      if (!cookie) return new Response(challengePage);
      // The first retry left from another egress IP and was rejected.
      return cookies.length === 2 ? new Response("", { status: 403 }) : new Response(article);
    }));

    expect(await juejinAdapter.fetchDirect!("https://juejin.cn/post/7637856870833635343")).toContain("<p>正文</p>");
    expect(cookies).toHaveLength(4);
    const solved = JSON.parse(atob(cookies[3]!.replace("_wafchallengeid=", "")));
    expect(solved.d).toBe(btoa("9"));
    expect(solved.s).toBe("Bca2paGd8jCoYooMdxF/ToCExvrsK/ZVOEmnc/Mk/E8=");
  });

  it("gives up on Juejin when the retry is still not an article", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<script>var _wafchallengeid="x";</script>')));
    expect(await juejinAdapter.fetchDirect!("https://juejin.cn/post/1")).toBeNull();
  });

  it("reads a Yuque doc via appData's book id and turns lake cards into HTML", async () => {
    const appData = encodeURIComponent(JSON.stringify({ book: { id: 75338 }, doc: { slug: "doc-webhook", title: "Webhooks" } }));
    const card = (name: string, value: unknown) =>
      `<card type="inline" name="${name}" value="data:${encodeURIComponent(JSON.stringify(value))}"></card>`;
    const lake = `<p>Intro</p>${card("image", { src: "https://cdn.nlark.com/a.png", title: "shot" })}` +
      card("codeblock", { mode: "TypeScript", code: "const a = 1 < 2;" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqUrl = String(input);
      if (reqUrl === "https://www.yuque.com/yuque/developer/doc-webhook") {
        return new Response(`<script>window.appData = JSON.parse(decodeURIComponent("${appData}"));</script>`);
      }
      if (reqUrl === "https://www.yuque.com/api/docs/doc-webhook?book_id=75338&merge_dynamic_data=false") {
        return Response.json({ data: { title: "Webhooks 消息推送", format: "lake", content: lake } });
      }
      throw new Error(`Unexpected fetch URL: ${reqUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await yuqueAdapter.fetchDirect!("https://www.yuque.com/yuque/developer/doc-webhook");

    expect(html).toContain("<h1>Webhooks 消息推送</h1><p>Intro</p>");
    expect(html).toContain('<img src="https://cdn.nlark.com/a.png" alt="shot">');
    expect(html).toContain('<pre><code class="language-typescript">const a = 1 &lt; 2;</code></pre>');
    expect(html).not.toContain("<card");
  });

  it("returns null for Yuque pages without a doc (e.g. a knowledge-base index)", async () => {
    const appData = encodeURIComponent(JSON.stringify({ book: { id: 1 } }));
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(`<script>window.appData = JSON.parse(decodeURIComponent("${appData}"));</script>`)));
    expect(await yuqueAdapter.fetchDirect!("https://www.yuque.com/yuque/developer")).toBeNull();
  });
});

describe("Toutiao public path", () => {
  it("reads Toutiao articles from the mobile endpoint and skips topic pages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://m.toutiao.com/i7702980541839753728/info/");
      return Response.json({ data: { title: "标题", source: "人民日报", publish_time: "1793489929", content: "<p>正文</p>" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await toutiaoAdapter.fetchDirect!("https://www.toutiao.com/a7702980541839753728/");
    expect(html).toContain("<p>人民日报 · 2026-11-01</p><p>正文</p>");
    expect(await toutiaoAdapter.fetchDirect!("https://www.toutiao.com/trending/7702652501526318633/")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
