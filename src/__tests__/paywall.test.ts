import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getPaywallRule,
  applyPaywallHeaders,
  extractJsonLdArticle,
  removePaywallElements,
  looksPaywalled,
  isPaywallScript,
  extractAmpLink,
  stripAmpAccessControls,
  fetchWaybackSnapshot,
  fetchArchiveToday,
  setPaywallRulesFromJson,
  getPaywallRuleStats,
} from "../paywall";

afterEach(() => {
  setPaywallRulesFromJson(null);
});

describe("getPaywallRule", () => {
  it("matches known US news domains", () => {
    expect(getPaywallRule("https://www.nytimes.com/2024/01/01/article.html")).not.toBeNull();
    expect(getPaywallRule("https://www.washingtonpost.com/politics/article")).not.toBeNull();
    expect(getPaywallRule("https://www.latimes.com/story")).not.toBeNull();
  });

  it("matches known business domains", () => {
    expect(getPaywallRule("https://www.wsj.com/articles/test")).not.toBeNull();
    expect(getPaywallRule("https://www.bloomberg.com/news/article")).not.toBeNull();
    expect(getPaywallRule("https://www.ft.com/content/abc")).not.toBeNull();
    expect(getPaywallRule("https://www.economist.com/leaders/article")).not.toBeNull();
  });

  it("matches Medium ecosystem", () => {
    expect(getPaywallRule("https://medium.com/@user/article-abc123")).not.toBeNull();
    expect(getPaywallRule("https://towardsdatascience.com/some-article")).not.toBeNull();
  });

  it("matches international domains", () => {
    expect(getPaywallRule("https://www.telegraph.co.uk/news/article")).not.toBeNull();
    expect(getPaywallRule("https://www.thetimes.co.uk/article/abc")).not.toBeNull();
    expect(getPaywallRule("https://www.spiegel.de/article")).not.toBeNull();
  });

  it("returns null for non-paywalled sites", () => {
    expect(getPaywallRule("https://example.com/page")).toBeNull();
    expect(getPaywallRule("https://github.com/repo")).toBeNull();
    expect(getPaywallRule("https://en.wikipedia.org/wiki/Test")).toBeNull();
  });

  it("handles subdomains correctly", () => {
    expect(getPaywallRule("https://cooking.nytimes.com/recipes/123")).not.toBeNull();
    expect(getPaywallRule("https://blogs.wsj.com/article")).not.toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(getPaywallRule("not-a-url")).toBeNull();
    expect(getPaywallRule("")).toBeNull();
  });

  it("supports runtime paywall rules from JSON", () => {
    const stats = setPaywallRulesFromJson(JSON.stringify([
      {
        domains: ["custompaywall.example"],
        referer: "https://example.com/",
      },
    ]), "test");
    const matched = getPaywallRule("https://www.custompaywall.example/article");

    expect(stats.source).toBe("test");
    expect(stats.ruleCount).toBe(1);
    expect(matched).not.toBeNull();
    expect(matched?.referer).toBe("https://example.com/");
  });

  it("exposes runtime paywall rule stats", () => {
    setPaywallRulesFromJson(JSON.stringify([{ domains: ["stats.example"] }]), "stats-test");
    const stats = getPaywallRuleStats();

    expect(stats.source).toBe("stats-test");
    expect(stats.ruleCount).toBe(1);
    expect(stats.domainCount).toBe(1);
    expect(typeof stats.updatedAt).toBe("string");
  });
});

describe("applyPaywallHeaders", () => {
  it("sets Googlebot UA for sites with googlebot flag", () => {
    const headers: Record<string, string> = { "User-Agent": "original/1.0" };
    applyPaywallHeaders("https://www.nytimes.com/article", headers);
    expect(headers["User-Agent"]).toContain("Googlebot");
  });

  it("sets Facebook Referer for WSJ", () => {
    const headers: Record<string, string> = {};
    applyPaywallHeaders("https://www.wsj.com/articles/test", headers);
    expect(headers["Referer"]).toBe("https://www.facebook.com/");
  });

  it("sets Facebook Referer for Barrons", () => {
    const headers: Record<string, string> = {};
    applyPaywallHeaders("https://www.barrons.com/articles/test", headers);
    expect(headers["Referer"]).toBe("https://www.facebook.com/");
  });

  it("sets Google Referer for Bloomberg", () => {
    const headers: Record<string, string> = {};
    applyPaywallHeaders("https://www.bloomberg.com/news/article", headers);
    expect(headers["Referer"]).toBe("https://www.google.com/");
  });

  it("sets Referer but not Googlebot UA for Medium", () => {
    const headers: Record<string, string> = { "User-Agent": "original/1.0" };
    applyPaywallHeaders("https://medium.com/@user/article", headers);
    expect(headers["User-Agent"]).toBe("original/1.0"); // unchanged
    expect(headers["Referer"]).toBe("https://www.google.com/");
  });

  it("sets X-Forwarded-For for sites with xForwardedFor flag", () => {
    const headers: Record<string, string> = {};
    applyPaywallHeaders("https://www.nytimes.com/article", headers);
    expect(headers["X-Forwarded-For"]).toBe("66.249.66.1");
  });

  it("sets X-Forwarded-For for WSJ", () => {
    const headers: Record<string, string> = {};
    applyPaywallHeaders("https://www.wsj.com/articles/test", headers);
    expect(headers["X-Forwarded-For"]).toBe("66.249.66.1");
  });

  it("does not set X-Forwarded-For for Medium", () => {
    const headers: Record<string, string> = {};
    applyPaywallHeaders("https://medium.com/@user/article", headers);
    expect(headers["X-Forwarded-For"]).toBeUndefined();
  });

  it("does nothing for non-paywalled sites", () => {
    const headers: Record<string, string> = { "User-Agent": "original/1.0" };
    applyPaywallHeaders("https://example.com/page", headers);
    expect(headers["User-Agent"]).toBe("original/1.0");
    expect(headers["Referer"]).toBeUndefined();
    expect(headers["X-Forwarded-For"]).toBeUndefined();
  });
});

describe("isPaywallScript", () => {
  it("matches known paywall provider scripts", () => {
    expect(isPaywallScript("https://cdn.tinypass.com/api/tinypass.min.js")).toBe(true);
    expect(isPaywallScript("https://experience.tinypass.com/xbuilder/experience/load")).toBe(true);
    expect(isPaywallScript("https://cdn.piano.io/sdk/v2/piano.js")).toBe(true);
  });

  it("matches metering/analytics scripts", () => {
    expect(isPaywallScript("https://cdn.cxense.com/cx.js")).toBe(true);
    expect(isPaywallScript("https://cdn.blueconic.net/bbc.js")).toBe(true);
  });

  it("matches NYT-specific meter scripts", () => {
    expect(isPaywallScript("https://meter-svc.nytimes.com/meter.js")).toBe(true);
    expect(isPaywallScript("https://mwcm.nyt.com/mwcm.js")).toBe(true);
  });

  it("matches Bloomberg fence script", () => {
    expect(isPaywallScript("https://assets.bwbx.io/s3/fence/v1/fence.js")).toBe(true);
  });

  it("rejects normal scripts", () => {
    expect(isPaywallScript("https://cdn.example.com/app.js")).toBe(false);
    expect(isPaywallScript("https://cdnjs.cloudflare.com/ajax/libs/jquery.min.js")).toBe(false);
    expect(isPaywallScript("https://www.google-analytics.com/analytics.js")).toBe(false);
  });
});

describe("extractAmpLink", () => {
  it("finds AMP link in HTML", () => {
    const html = `<html><head>
      <link rel="amphtml" href="https://www.example.com/amp/article">
    </head><body></body></html>`;
    expect(extractAmpLink(html)).toBe("https://www.example.com/amp/article");
  });

  it("handles single quotes", () => {
    const html = `<html><head>
      <link rel='amphtml' href='https://example.com/amp/page'>
    </head><body></body></html>`;
    expect(extractAmpLink(html)).toBe("https://example.com/amp/page");
  });

  it("returns null when no AMP link exists", () => {
    const html = `<html><head>
      <link rel="canonical" href="https://example.com/article">
    </head><body></body></html>`;
    expect(extractAmpLink(html)).toBeNull();
  });

  it("returns null for empty HTML", () => {
    expect(extractAmpLink("")).toBeNull();
  });
});

describe("stripAmpAccessControls", () => {
  it("removes subscriptions-section='content-not-granted'", () => {
    const html = `<div subscriptions-section="content-not-granted">Hidden</div>`;
    const result = stripAmpAccessControls(html);
    expect(result).not.toContain("subscriptions-section");
    expect(result).toContain("Hidden");
  });

  it("removes amp-access-hide", () => {
    const html = `<div amp-access-hide>Hidden content</div>`;
    const result = stripAmpAccessControls(html);
    expect(result).not.toContain("amp-access-hide");
    expect(result).toContain("Hidden content");
  });

  it("removes subscriptions-display attributes", () => {
    const html = `<div subscriptions-display="loggedIn">Member content</div>`;
    const result = stripAmpAccessControls(html);
    expect(result).not.toContain("subscriptions-display");
    expect(result).toContain("Member content");
  });

  it("preserves normal HTML attributes", () => {
    const html = `<div class="article" id="main"><p>Content</p></div>`;
    const result = stripAmpAccessControls(html);
    expect(result).toBe(html);
  });
});

describe("fetchWaybackSnapshot", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns HTML when snapshot is available", async () => {
    const fakeHtml = "<html><body>" + "Article content. ".repeat(200) + "</body></html>";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          archived_snapshots: {
            closest: {
              available: true,
              url: "https://web.archive.org/web/20240101120000/https://example.com/article",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => fakeHtml,
      });

    const result = await fetchWaybackSnapshot("https://example.com/article");
    expect(result).toBe(fakeHtml);
  });

  it("returns null when no snapshot available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        archived_snapshots: {},
      }),
    });

    const result = await fetchWaybackSnapshot("https://example.com/no-archive");
    expect(result).toBeNull();
  });

  it("returns null on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
    });

    const result = await fetchWaybackSnapshot("https://example.com/error");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchWaybackSnapshot("https://example.com/network-fail");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns null when body is too short", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          archived_snapshots: {
            closest: {
              available: true,
              url: "https://web.archive.org/web/20240101120000/https://example.com/short",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "<html><body>short</body></html>",
      });

    const result = await fetchWaybackSnapshot("https://example.com/short");
    expect(result).toBeNull();
  });
});

describe("fetchArchiveToday", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns HTML when archive exists", async () => {
    const fakeHtml = "<html><body>" + "Archived content. ".repeat(200) + "</body></html>";
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => fakeHtml,
    });

    const result = await fetchArchiveToday("https://example.com/article");
    expect(result).toBe(fakeHtml);
  });

  it("returns null on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await fetchArchiveToday("https://example.com/no-archive");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchArchiveToday("https://example.com/error");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("extractJsonLdArticle", () => {
  it("extracts articleBody from NewsArticle JSON-LD", () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "NewsArticle",
        "headline": "Test Article Title",
        "articleBody": "${"Lorem ipsum dolor sit amet. ".repeat(20)}"
      }
      </script>
    </head><body><p>Truncated...</p></body></html>`;

    const result = extractJsonLdArticle(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Test Article Title");
    expect(result).toContain("Lorem ipsum");
  });

  it("extracts from BlogPosting type", () => {
    const body = "A ".repeat(200);
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": "BlogPosting", "headline": "Blog Post", "articleBody": "${body}"}
      </script>
    </head><body></body></html>`;

    const result = extractJsonLdArticle(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Blog Post");
  });

  it("handles @graph arrays (Yoast SEO format)", () => {
    const body = "Full article content here. ".repeat(20);
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@graph": [
          {"@type": "WebPage", "name": "Page"},
          {"@type": "Article", "headline": "Graph Article", "articleBody": "${body}"}
        ]
      }
      </script>
    </head><body></body></html>`;

    const result = extractJsonLdArticle(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Graph Article");
  });

  it("returns null for non-article JSON-LD", () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": "Organization", "name": "Example Corp"}
      </script>
    </head><body></body></html>`;

    expect(extractJsonLdArticle(html)).toBeNull();
  });

  it("returns null when articleBody is too short", () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": "Article", "headline": "Short", "articleBody": "Too short."}
      </script>
    </head><body></body></html>`;

    expect(extractJsonLdArticle(html)).toBeNull();
  });

  it("returns null when no JSON-LD scripts exist", () => {
    const html = `<html><head></head><body><p>Hello</p></body></html>`;
    expect(extractJsonLdArticle(html)).toBeNull();
  });

  it("handles invalid JSON gracefully", () => {
    const html = `<html><head>
      <script type="application/ld+json">{invalid json here}</script>
    </head><body></body></html>`;

    expect(extractJsonLdArticle(html)).toBeNull();
  });

  it("picks the longest articleBody when multiple exist", () => {
    const short = "Short article. ".repeat(20);
    const long = "Much longer article content. ".repeat(40);
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": "Article", "headline": "Short One", "articleBody": "${short}"}
      </script>
      <script type="application/ld+json">
      {"@type": "Article", "headline": "Long One", "articleBody": "${long}"}
      </script>
    </head><body></body></html>`;

    const result = extractJsonLdArticle(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Long One");
  });

  it("handles array @type", () => {
    const body = "Content here. ".repeat(30);
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type": ["Article", "CreativeWork"], "headline": "Multi Type", "articleBody": "${body}"}
      </script>
    </head><body></body></html>`;

    const result = extractJsonLdArticle(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Multi Type");
  });
});

describe("removePaywallElements", () => {
  it("strips elements with paywall class", () => {
    const html = `<div class="content"><p>Article text</p></div>
      <div class="paywall"><p>Subscribe now!</p></div>`;
    const result = removePaywallElements(html);
    expect(result).toContain("Article text");
    expect(result).not.toContain("Subscribe now");
  });

  it("strips elements with data-paywall attribute", () => {
    const html = `<p>Content</p><div data-paywall="true"><p>Blocked</p></div>`;
    const result = removePaywallElements(html);
    expect(result).toContain("Content");
    expect(result).not.toContain("Blocked");
  });

  it("strips Piano modal elements", () => {
    const html = `<article><p>Article</p></article>
      <div class="tp-modal"><div>Subscribe</div></div>
      <div class="tp-backdrop"></div>`;
    const result = removePaywallElements(html);
    expect(result).toContain("Article");
    expect(result).not.toContain("tp-modal");
    expect(result).not.toContain("tp-backdrop");
  });

  it("strips elements with paywall test ID", () => {
    const html = `<p>Real content</p><div data-testid="paywall"><p>Wall</p></div>`;
    const result = removePaywallElements(html);
    expect(result).toContain("Real content");
    expect(result).not.toContain("Wall");
  });

  it("strips #piano-offer element", () => {
    const html = `<p>Article</p><div id="piano-offer"><p>Offer</p></div>`;
    const result = removePaywallElements(html);
    expect(result).toContain("Article");
    expect(result).not.toContain("Offer");
  });

  it("preserves HTML without paywall elements", () => {
    const html = `<div class="content"><p>Normal page</p></div>`;
    const result = removePaywallElements(html);
    expect(result).toContain("Normal page");
    expect(result).toBe(html);
  });

  it("removes overflow:hidden style on article-body containers", () => {
    const html = `<div class="article-body" style="overflow: hidden; max-height: 300px"><p>Truncated</p></div>`;
    const result = removePaywallElements(html);
    expect(result).toContain("Truncated");
    expect(result).not.toContain("overflow");
  });
});

describe("looksPaywalled", () => {
  it("detects truncated content (small text, large HTML)", () => {
    const largePadding = "<div>" + " ".repeat(15_000) + "</div>";
    const html = `<html><body><p>Short text</p>${largePadding}</body></html>`;
    expect(looksPaywalled(html)).toBe(true);
  });

  it("detects paywall phrases", () => {
    const html = `<html><body>
      <p>First paragraph of article...</p>
      <div class="paywall">Subscribe to continue reading</div>
    </body></html>`;
    expect(looksPaywalled(html)).toBe(true);
  });

  it("detects 'Members only' phrase", () => {
    const html = `<html><body><p>Preview</p><p>Members only content</p></body></html>`;
    expect(looksPaywalled(html)).toBe(true);
  });

  it("returns false for normal full-length content", () => {
    const content = "<p>Paragraph of content. </p>".repeat(50);
    const html = `<html><body>${content}</body></html>`;
    expect(looksPaywalled(html)).toBe(false);
  });
});
