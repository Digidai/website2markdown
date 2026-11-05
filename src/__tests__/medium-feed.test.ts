import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { freediumArticle, freediumUrlFor, mediumArticleFromFeed, mediumFeedFor } from "../medium-feed";
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

  const FREEDIUM_PAGE = `<html><head><title>Members Only - Freedium</title></head><body><nav>Freedium</nav>
    <main><article><h1>Members Only</h1><img src="/img/medium/700/1*abcDEF.png" alt="chart">
    <div class="dark:hidden"><pre class="shiki github-light"><code>light_copy = fit(X, y)</code></pre></div>
    <div class="hidden dark:block"><pre class="shiki github-dark"><code>dark_copy = fit(X, y)</code></pre></div><p>${"The member-only story continues here with every paragraph. ".repeat(30)}</p></article></main></body></html>`;

  it("maps Medium posts to Freedium and accepts only its article pages", () => {
    expect(freediumUrlFor("https://medium.com/data-science/deep-dive-7b4cc0efd235?source=rss"))
      .toBe("https://freedium-mirror.cfd/https://medium.com/data-science/deep-dive-7b4cc0efd235");
    expect(freediumUrlFor("https://onezero.medium.com/p/0123456789ab")).toBe(
      "https://freedium-mirror.cfd/https://onezero.medium.com/p/0123456789ab");
    expect(freediumUrlFor("https://medium.com/data-science")).toBeNull();
    expect(freediumUrlFor("https://example.com/post-7b4cc0efd235")).toBeNull();

    expect(freediumArticle(FREEDIUM_PAGE)).toContain("<title>Members Only</title>");
    // A title is inserted as text, not as a replacement pattern.
    expect(freediumArticle(FREEDIUM_PAGE.replace("Members Only -", () => "Pay $$ or $& -")))
      .toContain("<title>Pay $$ or $&</title>");
    // Freedium's error page, served with status 200.
    expect(freediumArticle(`<html><head><title>Freedium - Freedium</title></head><body><main>502 — UPSTREAM BLOCKED
      <h2>Access blocked by publisher.</h2></main></body></html>`)).toBeNull();
  });

  it("reads a challenged member-only post through Freedium and says so", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://medium.com/feed/data-science") {
        return new Response(FEED.replace("a64152b37c35", "ffffffffffff"), { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      if (url === "https://freedium-mirror.cfd/https://medium.com/data-science/members-only-7b4cc0efd235") {
        return new Response(FREEDIUM_PAGE, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response("<title>Just a moment...</title>", { status: 403, headers: { "Content-Type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createMockEnv();

    const res = await worker.fetch(new Request(
      "https://md.example.com/https://medium.com/data-science/members-only-7b4cc0efd235?raw=true",
    ), env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("The member-only story continues here");
    expect(body).toContain("Read through Freedium (freedium-mirror.cfd)");
    expect(body).toContain("![chart](https://miro.medium.com/v2/resize:fit:700/1*abcDEF.png)");
    expect(body).toContain("light_copy = fit(X, y)");
    expect(body).not.toContain("dark_copy");
    expect(res.headers.get("X-Markdown-Fallbacks")).toContain("freedium");

    const html = await (await worker.fetch(new Request(
      "https://md.example.com/https://medium.com/data-science/members-only-7b4cc0efd235?raw=true&format=html&nocache=true",
    ), env, mockCtx())).text();
    expect(html).toContain("The member-only story continues here");
    expect(html).toContain("Read through Freedium (freedium-mirror.cfd)");
    const fetched = fetchMock.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
    expect(fetched.some((url) => url.includes("archive.org") || url.includes("archive.ph"))).toBe(false);
  });
});
