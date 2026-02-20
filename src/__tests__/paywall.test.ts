import { describe, it, expect } from "vitest";
import {
  getPaywallRule,
  applyPaywallHeaders,
  extractJsonLdArticle,
  removePaywallElements,
  looksPaywalled,
} from "../paywall";

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
});

describe("applyPaywallHeaders", () => {
  it("sets Googlebot UA for sites with googlebot flag", () => {
    const headers: Record<string, string> = { "User-Agent": "original/1.0" };
    applyPaywallHeaders("https://www.nytimes.com/article", headers);
    expect(headers["User-Agent"]).toContain("Googlebot");
  });

  it("sets Google Referer for known sites", () => {
    const headers: Record<string, string> = {};
    applyPaywallHeaders("https://www.wsj.com/articles/test", headers);
    expect(headers["Referer"]).toBe("https://www.google.com/");
  });

  it("sets Referer but not Googlebot UA for Medium", () => {
    const headers: Record<string, string> = { "User-Agent": "original/1.0" };
    applyPaywallHeaders("https://medium.com/@user/article", headers);
    expect(headers["User-Agent"]).toBe("original/1.0"); // unchanged
    expect(headers["Referer"]).toBe("https://www.google.com/");
  });

  it("does nothing for non-paywalled sites", () => {
    const headers: Record<string, string> = { "User-Agent": "original/1.0" };
    applyPaywallHeaders("https://example.com/page", headers);
    expect(headers["User-Agent"]).toBe("original/1.0");
    expect(headers["Referer"]).toBeUndefined();
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
