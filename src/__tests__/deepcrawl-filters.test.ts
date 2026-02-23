import { describe, expect, it } from "vitest";

import {
  FilterChain,
  createContentTypeFilter,
  createDomainFilter,
  createUrlPatternFilter,
  type UrlFilterContext,
} from "../deepcrawl/filters";

function createContext(url: string, contentType?: string): UrlFilterContext {
  return {
    url,
    depth: 0,
    seedHost: "seed.example.com",
    contentType,
  };
}

describe("deepcrawl filters", () => {
  it("preserves chain immutability and short-circuits denied filters", async () => {
    const allowChain = new FilterChain([async () => true]);
    const denyChain = allowChain.add(async () => false);

    expect(await allowChain.test("https://docs.example.com/a", createContext("https://docs.example.com/a"))).toBe(true);
    expect(await denyChain.test("https://docs.example.com/a", createContext("https://docs.example.com/a"))).toBe(false);

    let called = false;
    const shortCircuit = new FilterChain([
      async () => false,
      async () => {
        called = true;
        return true;
      },
    ]);
    expect(await shortCircuit.test("https://docs.example.com/a", createContext("https://docs.example.com/a"))).toBe(false);
    expect(called).toBe(false);
  });

  it("matches wildcard url patterns and defaults to allow when empty", async () => {
    const empty = createUrlPatternFilter(["", "   "]);
    expect(await empty("https://anything.example.com/path", createContext("https://anything.example.com/path"))).toBe(true);

    const filter = createUrlPatternFilter([
      " https://example.com/docs/* ",
      "https://example.com/p?th",
    ]);
    expect(await filter("https://example.com/docs/getting-started", createContext("https://example.com/docs/getting-started"))).toBe(true);
    expect(await filter("https://example.com/path", createContext("https://example.com/path"))).toBe(true);
    expect(await filter("https://example.com/other", createContext("https://example.com/other"))).toBe(false);
  });

  it("applies allow/block domain rules with block precedence", async () => {
    const filter = createDomainFilter(
      ["allowed.example.com", "blocked.example.com"],
      ["blocked.example.com"],
    );

    expect(await filter("https://allowed.example.com/a", createContext("https://allowed.example.com/a"))).toBe(true);
    expect(await filter("https://blocked.example.com/a", createContext("https://blocked.example.com/a"))).toBe(false);
    expect(await filter("https://other.example.com/a", createContext("https://other.example.com/a"))).toBe(false);
    expect(await filter("not-a-url", createContext("not-a-url"))).toBe(false);
  });

  it("filters by content-type with case-insensitive matching", async () => {
    const passthrough = createContentTypeFilter([]);
    expect(await passthrough("https://example.com/a", createContext("https://example.com/a", "application/pdf"))).toBe(true);

    const htmlOnly = createContentTypeFilter(["text/html", "application/xhtml+xml"]);
    expect(await htmlOnly("https://example.com/a", createContext("https://example.com/a"))).toBe(true);
    expect(await htmlOnly("https://example.com/a", createContext("https://example.com/a", "Text/HTML; charset=utf-8"))).toBe(true);
    expect(await htmlOnly("https://example.com/a", createContext("https://example.com/a", "application/json"))).toBe(false);
  });
});
