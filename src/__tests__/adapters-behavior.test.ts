import { afterEach, describe, expect, it, vi } from "vitest";
import { genericAdapter } from "../browser/adapters/generic";
import { wechatAdapter } from "../browser/adapters/wechat";
import { redditAdapter } from "../browser/adapters/reddit";
import { neteaseAdapter } from "../browser/adapters/netease";
import { feishuAdapter } from "../browser/adapters/feishu";
import { twitterAdapter } from "../browser/adapters/twitter";

type MockPage = {
  setUserAgent: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
};

function createMockPage(html = "<html><body>ok</body></html>"): MockPage {
  return {
    setUserAgent: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    setExtraHTTPHeaders: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {}),
    content: vi.fn(async () => html),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("adapter behavior", () => {
  it("configures generic adapter and extracts page HTML", async () => {
    const page = createMockPage();
    await genericAdapter.configurePage(page as any);

    vi.useFakeTimers();
    const extractPromise = genericAdapter.extract(page as any, new Map());
    await vi.advanceTimersByTimeAsync(2100);
    const result = await extractPromise;

    expect(page.setUserAgent).toHaveBeenCalled();
    expect(page.setViewport).toHaveBeenCalled();
    expect(page.setExtraHTTPHeaders).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalled();
    expect(result?.html).toContain("<html>");
  });

  it("configures wechat adapter and extracts page HTML", async () => {
    const page = createMockPage("<html><body>wechat</body></html>");
    await wechatAdapter.configurePage(page as any);

    vi.useFakeTimers();
    const extractPromise = wechatAdapter.extract(page as any, new Map());
    await vi.advanceTimersByTimeAsync(2100);
    const result = await extractPromise;

    expect(page.setUserAgent).toHaveBeenCalled();
    expect(page.setViewport).toHaveBeenCalled();
    expect(page.setExtraHTTPHeaders).toHaveBeenCalled();
    expect(result?.html).toContain("wechat");
  });

  it("transforms reddit URL and strips noisy sections", () => {
    const transformed = redditAdapter.transformUrl!(
      "https://www.reddit.com/r/programming/comments/abc/title/",
    );
    expect(transformed).toContain("old.reddit.com");

    const source =
      "<html><body>" +
      "<div id=\"header\">header</div>" +
      "<div id=\"siteTable\"><div class=\"thing\">post</div></div>" +
      "<div class=\"commentarea\">comments</div>" +
      "</body></html>";
    const processed = redditAdapter.postProcess!(source);

    expect(processed).toContain("siteTable");
    expect(processed).not.toContain("commentarea");
  });

  it("removes netease navigation noise in postProcess", () => {
    const source =
      "<div class=\"ne_wrap_header\">header</div><!-- /header -->" +
      "<div class=\"N-nav\">nav</div>" +
      "<article>content</article>" +
      "<div id=\"footer\">footer</div>";
    const processed = neteaseAdapter.postProcess!(source);
    expect(processed).toContain("<article>content</article>");
    expect(processed).not.toContain("ne_wrap_header");
    expect(processed).not.toContain("N-nav");
    expect(processed).not.toContain("footer");
  });

  it("keeps feishu adapter as no-op extraction", async () => {
    expect(feishuAdapter.alwaysBrowser).toBe(true);
    expect(await feishuAdapter.extract({} as any, new Map())).toBeNull();
  });

  it("fetches twitter thread via fxtwitter direct API path", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tweet: {
          id: "100",
          text: "hello thread",
          author: { name: "Alice", screen_name: "alice" },
          likes: 1,
          retweets: 2,
          replies: 3,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockRejectedValueOnce(new Error("timeline unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!(
      "https://x.com/alice/status/100",
    );

    expect(html).toContain("Alice (@alice)");
    expect(html).toContain("hello thread");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("falls back to oEmbed when fxtwitter fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        author_name: "Bob",
        author_url: "https://x.com/bob",
        html: "<blockquote>tweet body</blockquote>",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!(
      "https://twitter.com/bob/status/200",
    );

    expect(html).toContain("Bob (@bob)");
    expect(html).toContain("tweet body");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
