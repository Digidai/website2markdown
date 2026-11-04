import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { mediumArticleFromFeed, mediumFeedFor } from "../medium-feed";
import { createMockEnv, mockCtx } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const FEED = `<?xml version="1.0"?><rss><channel>
  <item><title><![CDATA[Members Only]]></title><guid isPermaLink="false">https://medium.com/p/7b4cc0efd235</guid>
    <description><![CDATA[<p>snippet</p>]]></description></item>
  <item><title><![CDATA[Software 2.0 & more]]></title><guid isPermaLink="false">https://medium.com/p/a64152b37c35</guid>
    <dc:creator><![CDATA[Andrej Karpathy]]></dc:creator>
    <content:encoded><![CDATA[<p>Neural networks are not just another classifier. ${"They represent the beginning of a shift. ".repeat(20)}</p>]]></content:encoded></item>
</channel></rss>`;

describe("medium feed fallback", () => {
  it("finds the feed for author, publication, and subdomain posts", () => {
    expect(mediumFeedFor("https://medium.com/@karpathy/software-2-0-a64152b37c35?cb=p4b"))
      .toEqual({ feedUrl: "https://medium.com/feed/@karpathy", postId: "a64152b37c35" });
    expect(mediumFeedFor("https://medium.com/data-science/deep-dive-aac387e10cb6"))
      .toEqual({ feedUrl: "https://medium.com/feed/data-science", postId: "aac387e10cb6" });
    expect(mediumFeedFor("https://onezero.medium.com/some-story-0123456789ab"))
      .toEqual({ feedUrl: "https://onezero.medium.com/feed", postId: "0123456789ab" });
    expect(mediumFeedFor("https://medium.com/data-science")).toBeNull();
    expect(mediumFeedFor("https://medium.com/p/a64152b37c35")).toBeNull();
    expect(mediumFeedFor("https://example.com/post-a64152b37c35")).toBeNull();
  });

  it("returns the matching item's full text and skips snippet-only posts", () => {
    const html = mediumArticleFromFeed(FEED, "a64152b37c35");
    expect(html).toContain("<h1>Software 2.0 &amp; more</h1>");
    expect(html).toContain("Neural networks are not just another classifier.");
    expect(html).not.toContain("snippet");
    expect(mediumArticleFromFeed(FEED, "7b4cc0efd235")).toBeNull();
    expect(mediumArticleFromFeed(FEED, "000000000000")).toBeNull();
  });

  it("converts a challenged Medium post from the feed without trying the archives", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://medium.com/feed/@karpathy") {
        return new Response(FEED, { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      return new Response("<title>Just a moment...</title>", { status: 403, headers: { "Content-Type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createMockEnv();

    const res = await worker.fetch(new Request(
      "https://md.example.com/https://medium.com/@karpathy/software-2-0-a64152b37c35?raw=true",
    ), env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Neural networks are not just another classifier.");
    const fetched = fetchMock.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
    expect(fetched.some((url) => url.includes("archive.org") || url.includes("archive.ph"))).toBe(false);
  });
});
