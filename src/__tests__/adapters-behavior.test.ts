import { afterEach, describe, expect, it, vi } from "vitest";
import { genericAdapter } from "../browser/adapters/generic";
import { wechatAdapter } from "../browser/adapters/wechat";
import { redditAdapter } from "../browser/adapters/reddit";
import { neteaseAdapter } from "../browser/adapters/netease";
import { feishuAdapter, isFeishuDocumentUrl } from "../browser/adapters/feishu";
import { twitterAdapter } from "../browser/adapters/twitter";
import { htmlToMarkdown } from "../converter";

type MockPage = {
  setUserAgent: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
  evaluateOnNewDocument: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
};

function createMockPage(html = "<html><body>ok</body></html>"): MockPage {
  return {
    setUserAgent: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    setExtraHTTPHeaders: vi.fn(async () => {}),
    evaluateOnNewDocument: vi.fn(async () => {}),
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

  it("wechat postProcess converts code-snippet blocks to clean pre/code", () => {
    const html = `<html><body>
      <section class="code-snippet__fix" style="display:block">
        <ul class="code-snippet__line-index"><li>1</li><li>2</li></ul>
        <pre data-lang="Python"><code>print("hello")</code><code>print("world")</code></pre>
      </section>
    </body></html>`;
    const processed = wechatAdapter.postProcess!(html);
    expect(processed).toContain('<pre data-lang="Python">');
    expect(processed).toContain("print");
    expect(processed).toContain("hello");
    expect(processed).not.toContain("code-snippet__line-index");
    expect(processed).not.toContain("code-snippet__fix");
  });

  it("wechat postProcess passes through plain content unchanged", () => {
    const html = `<html><body><div id="js_content">plain article</div></body></html>`;
    const processed = wechatAdapter.postProcess!(html);
    expect(processed).toContain("plain article");
  });

  it("wechat postProcess promotes js_content into a focused article document", () => {
    const html = `<html><head><title>Fallback</title></head><body>
      <h1 id="activity-name">Article Title</h1>
      <span id="js_name">Author Name</span>
      <div id="js_content">
        <p>real article body</p>
        <img data-src="https://mmbiz.qpic.cn/mmbiz_png/a/640" />
      </div>
      <div class="share-widget">outside noise</div>
    </body></html>`;

    const processed = wechatAdapter.postProcess!(html);

    expect(processed).toContain('data-adapter="wechat"');
    expect(processed).toContain("<h1>Article Title</h1>");
    expect(processed).toContain("作者: Author Name");
    expect(processed).toContain("real article body");
    expect(processed).toContain('src="https://mmbiz.qpic.cn/mmbiz_png/a/640"');
    expect(processed).not.toContain("outside noise");
  });

  it("wechat postProcess keeps article body readable when js_content root is hidden", () => {
    const html = `<html><head><title>Fallback</title></head><body>
      <h1 id="activity-name">Article Title</h1>
      <span id="js_name">Author Name</span>
      <div id="js_content" style="visibility:hidden">
        <p>real hidden-root article body</p>
      </div>
    </body></html>`;

    const processed = wechatAdapter.postProcess!(html);
    const result = htmlToMarkdown(processed, "https://mp.weixin.qq.com/s/abc");

    expect(result.markdown).toContain("Article Title");
    expect(result.markdown).toContain("real hidden-root article body");
  });

  it("keeps feishu adapter as no-op extraction", async () => {
    expect(feishuAdapter.alwaysBrowser).toBe(true);
    expect(await feishuAdapter.extract({} as any, new Map())).toBeNull();
  });

  it("only matches Feishu collaborative document surfaces", () => {
    expect(isFeishuDocumentUrl("https://team.feishu.cn/wiki/abc")).toBe(true);
    expect(isFeishuDocumentUrl("https://team.feishu.cn/docx/abc")).toBe(true);
    expect(isFeishuDocumentUrl("https://example.larksuite.com/docs/xyz")).toBe(true);

    expect(isFeishuDocumentUrl("https://www.feishu.cn/content/article/7598492868155608024")).toBe(false);
    expect(isFeishuDocumentUrl("https://open.feishu.cn/document/home/index")).toBe(false);
    expect(isFeishuDocumentUrl("https://accounts.feishu.cn/accounts/page/login")).toBe(false);
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
    // fxtwitter supplies a retweet count — it stays rendered
    expect(html).toContain("2 retweets");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("falls back to oEmbed when fxtwitter and syndication both fail", async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.fxtwitter.com")) {
        return new Response("{}", { status: 500 });
      }
      if (url.includes("cdn.syndication.twimg.com")) {
        // tweet-result not-found returns an empty object
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("publish.twitter.com/oembed")) {
        return new Response(JSON.stringify({
          author_name: "Bob",
          author_url: "https://x.com/bob",
          html: "<blockquote>tweet body</blockquote>",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!(
      "https://twitter.com/bob/status/200",
    );

    expect(html).toContain("Bob (@bob)");
    expect(html).toContain("tweet body");
  });

  it("falls back to the syndication CDN when fxtwitter is down", async () => {
    const id = "1585341984679469056";
    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.fxtwitter.com")) {
        return new Response("{}", { status: 503 });
      }
      if (url.includes("cdn.syndication.twimg.com")) {
        return new Response(JSON.stringify({
          id_str: id,
          text: "Entering Twitter HQ",
          user: { name: "Elon", screen_name: "elonmusk" },
          created_at: "2022-10-26T23:54:00.000Z",
          favorite_count: 42,
          conversation_count: 7,
          mediaDetails: [
            {
              type: "photo",
              media_url_https: "https://pbs.twimg.com/media/PHOTO.jpg",
            },
            {
              type: "video",
              media_url_https: "https://pbs.twimg.com/poster.jpg",
              video_info: {
                variants: [
                  { content_type: "application/x-mpegURL", url: "https://video/hls.m3u8" },
                  { bitrate: 256000, content_type: "video/mp4", url: "https://video/low.mp4" },
                  { bitrate: 2176000, content_type: "video/mp4", url: "https://video/high.mp4" },
                ],
              },
            },
          ],
          quoted_tweet: {
            user: { name: "Quoted", screen_name: "quoted" },
            text: "the quoted text",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // timeline walk-down unavailable
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!(
      `https://x.com/elonmusk/status/${id}`,
    );

    expect(html).toContain("Elon (@elonmusk)");
    expect(html).toContain("Entering Twitter HQ");
    expect(html).toContain("https://pbs.twimg.com/media/PHOTO.jpg");
    // highest-bitrate MP4 variant is selected; HLS and lower bitrates excluded
    expect(html).toContain("https://video/high.mp4");
    expect(html).not.toContain("https://video/low.mp4");
    expect(html).not.toContain("hls.m3u8");
    expect(html).toContain("Quoted (@quoted)");
    expect(html).toContain("the quoted text");
    expect(html).toContain("7 replies");
    expect(html).toContain("42 likes");
    // syndication has no retweet count — must not assert a false "0 retweets"
    expect(html).not.toContain("retweets");
  });

  it("computes the syndication token client-side for the requested id", async () => {
    const id = "20";
    const expectedToken = ((Number(id) / 1e15) * Math.PI)
      .toString(6 ** 2)
      .replace(/(0+|\.)/g, "");
    let syndicationUrl = "";
    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.fxtwitter.com")) {
        return new Response("{}", { status: 500 });
      }
      if (url.includes("cdn.syndication.twimg.com")) {
        syndicationUrl = url;
        return new Response(JSON.stringify({
          id_str: id,
          text: "just setting up my twttr",
          user: { name: "jack", screen_name: "jack" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await twitterAdapter.fetchDirect!(`https://x.com/jack/status/${id}`);

    expect(syndicationUrl).toContain(`id=${id}`);
    expect(syndicationUrl).toContain(`token=${expectedToken}`);
  });

  it("ignores a non-JSON syndication response (HTML error page)", async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.fxtwitter.com")) {
        return new Response("{}", { status: 500 });
      }
      if (url.includes("cdn.syndication.twimg.com")) {
        return new Response("<!DOCTYPE html><html class=\"dog\"></html>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.includes("publish.twitter.com/oembed")) {
        return new Response(JSON.stringify({
          author_name: "Charlie",
          author_url: "https://x.com/charlie",
          html: "<blockquote>oembed fallback body</blockquote>",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const html = await twitterAdapter.fetchDirect!(
      "https://x.com/charlie/status/300",
    );

    expect(html).toContain("(@charlie)");
    expect(html).toContain("oembed fallback body");
  });
});
