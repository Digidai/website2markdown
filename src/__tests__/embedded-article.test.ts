import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { extractEmbeddedArticles, findWpJsonUrl, wpJsonArticle } from "../embedded-article";
import { createMockEnv, mockCtx } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PARAGRAPHS = Array.from({ length: 12 }, (_, i) =>
  `Paragraph ${i + 1} reports what the council decided about the harbour and why residents objected.`);
const LAST = "The final paragraph only exists in the embedded data.";

function htmlPage(head: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>Harbour vote</title>${head}</head><body>${body}</body></html>`;
}

function stubPages(pages: Record<string, { body: string; type?: string }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const page = pages[url];
    if (!page) return new Response("not found", { status: 404 });
    return new Response(page.body, { status: 200, headers: { "Content-Type": page.type ?? "text/html; charset=utf-8" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function convert(url: string) {
  const res = await worker.fetch(new Request(`https://md.example.com/${url}?raw=true`), createMockEnv().env, mockCtx());
  return { status: res.status, body: await res.text(), fallbacks: res.headers.get("X-Markdown-Fallbacks") ?? "" };
}

describe("extractEmbeddedArticles", () => {
  it("renders Arc XP Fusion content elements in order", () => {
    const fusion = {
      headlines: { basic: "Harbour vote" },
      content_elements: [
        ...PARAGRAPHS.slice(0, 6).map((p) => ({ type: "text", content: p })),
        { type: "header", level: 3, content: "What comes next" },
        { type: "list", list_type: "ordered", items: [{ content: "Appeal" }, { content: "Review" }] },
        { type: "image", url: "https://cdn.example.com/a.jpg", caption: "The harbour" },
        { type: "raw_html", content: "<div>advert</div>" },
        { type: "text", content: "A closing line with a } brace and \"quotes\"." },
      ],
    };
    const html = `<script>Fusion.globalContent=${JSON.stringify(fusion)};Fusion.spa=true;</script>`;
    const [article] = extractEmbeddedArticles(html, "", "https://news.example.com/harbour");
    expect(article.source).toBe("fusion");
    expect(article.html).toContain("<title>Harbour vote</title>");
    expect(article.html).toContain("<h3>What comes next</h3>");
    expect(article.html).toContain("<ol><li>Appeal</li><li>Review</li></ol>");
    expect(article.html).toContain('<img src="https://cdn.example.com/a.jpg" alt="The harbour">');
    expect(article.html).toContain("a } brace");
    expect(article.html).not.toContain("advert");
  });

  const nextData = (data: unknown) =>
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  const paragraphs = (list: string[]) => list.map((p) => `<p>${p}</p>`).join("");

  it("takes the requested article's HTML from __NEXT_DATA__, not longer non-article strings", () => {
    const html = nextData({
      props: {
        pageProps: {
          data: {
            path: "/business/harbour-vote-delayed",
            body: `<html><body><div>${paragraphs(PARAGRAPHS)}</div></body></html>`,
          },
          stylesheet: "x".repeat(5000),
          svg: `<svg>${"<path d='M0'/>".repeat(400)}</svg>`,
        },
      },
    });
    const [article] = extractEmbeddedArticles(html, "Harbour vote", "https://news.example.com/business/harbour-vote-delayed");
    expect(article.source).toBe("next_data");
    expect(article.html).toContain("<p>Paragraph 12 reports");
    const inner = article.html.slice(article.html.indexOf("<article>"), article.html.indexOf("</article>"));
    expect(inner).not.toMatch(/<\/?(?:html|body)\b/);
  });

  it("skips a longer related article, even when an outer record names the page", () => {
    const related = Array.from({ length: 40 }, (_, i) => `Related story paragraph ${i + 1} about a different town entirely.`);
    const html = nextData({
      props: {
        pageProps: {
          slug: "harbour-vote-delayed",
          article: { headline: "Council delays the harbour vote", body: paragraphs(PARAGRAPHS) },
          relatedArticles: [{ headline: "A different town votes", body: paragraphs(related) }],
        },
      },
    });
    const [article] = extractEmbeddedArticles(
      html, "Council delays the harbour vote | Example News", "https://news.example.com/2026/11/harbour-vote-delayed",
    );
    expect(article.html).toContain("Paragraph 12 reports");
    expect(article.html).not.toContain("different town");
  });

  it("ignores page state that does not name the requested article", () => {
    const html = nextData({ props: { pageProps: { story: { url: "https://news.example.com/other-story", body: paragraphs(PARAGRAPHS) } } } });
    expect(extractEmbeddedArticles(html, "Harbour vote", "https://news.example.com/harbour-vote-delayed")).toEqual([]);
  });

  it("stays linear on HTML with many unclosed angle brackets", () => {
    const html = nextData({ props: { article: { slug: "harbour-vote-delayed", body: `<p>${PARAGRAPHS.join(" ")}</p>${"<".repeat(200_000)}` } } });
    const started = performance.now();
    extractEmbeddedArticles(html, "Harbour vote", "https://news.example.com/harbour-vote-delayed");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("ignores short teasers and unparsable state", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"teaser":"<p>Short.</p>"}}</script>
      <script>window.__INITIAL_STATE__ = {"a": undefined};</script>`;
    expect(extractEmbeddedArticles(html, "Harbour vote", "https://news.example.com/harbour-vote-delayed")).toEqual([]);
  });
});

describe("WordPress REST", () => {
  const link = (href: string) => `<link rel="alternate" type="application/json" href="${href}">`;

  it("finds the page's own post endpoint only", () => {
    const page = "https://www.example.org/2026/11/harbour-vote/";
    expect(findWpJsonUrl(link("https://example.org/wp-json/wp/v2/posts/123"), page))
      .toBe("https://example.org/wp-json/wp/v2/posts/123");
    expect(findWpJsonUrl(link("/?rest_route=/wp/v2/posts/9&amp;x=1"), page))
      .toBe("https://www.example.org/?rest_route=/wp/v2/posts/9&x=1");
    expect(findWpJsonUrl(link("https://evil.example.net/wp-json/wp/v2/posts/123"), page)).toBeNull();
    expect(findWpJsonUrl(link("https://example.org/wp-json/wp/v2/categories"), page)).toBeNull();
  });

  it("returns the rendered content, or null for a teaser", () => {
    const content = PARAGRAPHS.map((p) => `<p>${p}</p>`).join("");
    expect(wpJsonArticle({ title: { rendered: "Harbour &#8217;vote" }, content: { rendered: content } }, "")?.html)
      .toContain("<title>Harbour &#8217;vote</title>");
    expect(wpJsonArticle({ content: { rendered: "<p>Subscribe to read.</p>" } }, "T")).toBeNull();
  });
});

describe("embedded article fallback in conversion", () => {
  it("replaces a truncated page with the full body from __NEXT_DATA__", async () => {
    const body = [...PARAGRAPHS, LAST].map((p) => `<p>${p}</p>`).join("");
    const data = { props: { pageProps: { data: { url: "https://news.example.com/2026/11/harbour-vote", body } } } };
    const url = "https://news.example.com/2026/11/harbour-vote";
    stubPages({
      [url]: {
        body: htmlPage(
          `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`,
          `<article><h1>Harbour vote</h1><p>${PARAGRAPHS[0]}</p></article>`,
        ),
      },
    });

    const result = await convert(url);
    expect(result.status).toBe(200);
    expect(result.body).toContain(LAST);
    expect(result.fallbacks).toContain("next_data");
  });

  it("keeps the page markup when the embedded copy is not clearly longer", async () => {
    const url = "https://news.example.com/2026/11/full-page";
    const jsonLd = { "@type": "NewsArticle", headline: "Harbour vote", articleBody: PARAGRAPHS.join("\n") };
    stubPages({
      [url]: {
        body: htmlPage(
          `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
          `<article><h1>Harbour vote</h1>${PARAGRAPHS.map((p) => `<p>${p}</p>`).join("")}
            <img src="https://cdn.example.com/harbour.jpg" alt="Harbour at dusk"></article>`,
        ),
      },
    });

    const result = await convert(url);
    expect(result.status).toBe(200);
    expect(result.body).toContain("https://cdn.example.com/harbour.jpg");
    expect(result.fallbacks).not.toContain("jsonld");
  });

  it("reads a paywalled WordPress post from its REST endpoint", async () => {
    const url = "https://blog.example.org/2026/11/harbour-vote/";
    const api = "https://blog.example.org/wp-json/wp/v2/posts/42";
    const fetchMock = stubPages({
      [url]: {
        body: htmlPage(
          `<link rel="alternate" type="application/json" href="${api}">`,
          `<article><h1>Harbour vote</h1><p>${PARAGRAPHS[0]}</p><div class="paywall">Subscribe to continue reading.</div></article>`,
        ),
      },
      [api]: {
        body: JSON.stringify({ content: { rendered: [...PARAGRAPHS, LAST].map((p) => `<p>${p}</p>`).join("") } }),
        type: "application/json",
      },
    });

    const result = await convert(url);
    expect(result.status).toBe(200);
    expect(result.body).toContain(LAST);
    expect(result.fallbacks).toContain("wp_json");
    expect(fetchMock.mock.calls.some(([input]) => String(input instanceof Request ? input.url : input) === api)).toBe(true);
  });
});
