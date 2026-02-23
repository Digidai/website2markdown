import { describe, expect, it } from "vitest";

import {
  runBfsDeepCrawl,
  runBestFirstDeepCrawl,
  type DeepCrawlStateSnapshot,
} from "../deepcrawl/bfs";
import { CompositeUrlScorer, KeywordUrlScorer } from "../deepcrawl/scorers";

function createGraphFetcher(graph: Record<string, string>) {
  return async (url: string) => {
    const html = graph[url];
    if (!html) {
      throw new Error(`404: ${url}`);
    }
    return {
      url,
      html,
      title: new URL(url).pathname,
      contentType: "text/html",
    };
  };
}

describe("deepcrawl core", () => {
  it("runs BFS with expected traversal order and metadata", async () => {
    const seed = "https://crawl.example.com/a";
    const fetcher = createGraphFetcher({
      "https://crawl.example.com/a": `
        <html><body>
          <a href="/b">B</a>
          <a href="/c">C</a>
        </body></html>
      `,
      "https://crawl.example.com/b": `
        <html><body><a href="/d">D</a></body></html>
      `,
      "https://crawl.example.com/c": `
        <html><body><a href="/d">D-again</a><a href="/e">E</a></body></html>
      `,
      "https://crawl.example.com/d": "<html><body>D</body></html>",
      "https://crawl.example.com/e": "<html><body>E</body></html>",
    });

    const result = await runBfsDeepCrawl(seed, fetcher, {
      maxDepth: 2,
      maxPages: 10,
    });

    expect(result.results.map((item) => item.url)).toEqual([
      "https://crawl.example.com/a",
      "https://crawl.example.com/b",
      "https://crawl.example.com/c",
      "https://crawl.example.com/d",
      "https://crawl.example.com/e",
    ]);

    const bNode = result.results.find((item) => item.url.endsWith("/b"));
    const dNode = result.results.find((item) => item.url.endsWith("/d"));

    expect(bNode?.depth).toBe(1);
    expect(bNode?.parentUrl).toBe("https://crawl.example.com/a");
    expect(dNode?.depth).toBe(2);
    expect(result.stats.succeededPages).toBe(5);
    expect(result.stats.failedPages).toBe(0);
  });

  it("runs BestFirst with stable ranking for ties", async () => {
    const seed = "https://crawl.example.com/root";
    const fetcher = createGraphFetcher({
      "https://crawl.example.com/root": `
        <html><body>
          <a href="/low">general</a>
          <a href="/tie2">keyword</a>
          <a href="/high">keyword</a>
          <a href="/tie1">keyword</a>
        </body></html>
      `,
      "https://crawl.example.com/low": "<html><body>low</body></html>",
      "https://crawl.example.com/tie1": "<html><body>tie1</body></html>",
      "https://crawl.example.com/tie2": "<html><body>tie2</body></html>",
      "https://crawl.example.com/high": "<html><body>high</body></html>",
    });

    const result = await runBestFirstDeepCrawl(seed, fetcher, {
      maxDepth: 1,
      maxPages: 4,
      scoreThreshold: 1,
      urlScorer: new CompositeUrlScorer([
        new KeywordUrlScorer(["keyword"]),
      ]),
    });

    // score ties are resolved by URL to keep deterministic ordering
    expect(result.results.map((item) => item.url)).toEqual([
      "https://crawl.example.com/root",
      "https://crawl.example.com/high",
      "https://crawl.example.com/tie1",
      "https://crawl.example.com/tie2",
    ]);
  });

  it("supports checkpoint/resume without duplicate URLs", async () => {
    const seed = "https://crawl.example.com/start";
    const fetcher = createGraphFetcher({
      "https://crawl.example.com/start": `
        <html><body>
          <a href="/a">A</a>
          <a href="/b">B</a>
        </body></html>
      `,
      "https://crawl.example.com/a": "<html><body><a href='/c'>C</a></body></html>",
      "https://crawl.example.com/b": "<html><body><a href='/d'>D</a></body></html>",
      "https://crawl.example.com/c": "<html><body>C</body></html>",
      "https://crawl.example.com/d": "<html><body>D</body></html>",
    });

    let snapshot: DeepCrawlStateSnapshot | undefined;

    const firstRun = await runBfsDeepCrawl(seed, fetcher, {
      maxDepth: 2,
      maxPages: 2,
      checkpointEvery: 1,
      onCheckpoint: async (state) => {
        snapshot = state;
      },
    });

    expect(firstRun.results).toHaveLength(2);
    expect(snapshot).toBeTruthy();
    expect(snapshot!.frontier.length).toBeGreaterThan(0);

    const resumedRun = await runBfsDeepCrawl(seed, fetcher, {
      maxDepth: 2,
      maxPages: 5,
      initialState: snapshot,
    });

    const urls = resumedRun.results.map((item) => item.url);
    expect(urls).toHaveLength(5);
    expect(new Set(urls).size).toBe(5);
  });

  it("filters non-http links, blocks external URLs, and deduplicates discovered links", async () => {
    const seed = "https://crawl.example.com/root";
    const fetcher = createGraphFetcher({
      "https://crawl.example.com/root": `
        <a href="/same">Same-1</a>
        <a href="/same#anchor">Same-2</a>
        <a href="https://external.example.com/out">External</a>
        <a href="mailto:test@example.com">Mail</a>
        <a href="javascript:void(0)">JS</a>
      `,
      "https://crawl.example.com/same": "<p>leaf</p>",
    });

    const result = await runBfsDeepCrawl(seed, fetcher, {
      maxDepth: 2,
      maxPages: 10,
      includeExternal: false,
    });

    expect(result.results.map((item) => item.url)).toEqual([
      "https://crawl.example.com/root",
      "https://crawl.example.com/same",
    ]);
    expect(result.results[0].linksDiscovered).toBe(1);
    expect(result.stats.enqueuedPages).toBe(2);
    expect(result.stats.failedPages).toBe(0);
  });

  it("normalizes invalid frontier depth values from checkpoint state", async () => {
    const seed = "https://crawl.example.com/start";
    const fetcher = createGraphFetcher({
      [seed]: "<html><body>ok</body></html>",
    });

    const result = await runBfsDeepCrawl(seed, fetcher, {
      maxDepth: 2,
      maxPages: 1,
      initialState: {
        frontier: [{ url: seed, depth: Number.NaN as unknown as number, score: 0 }],
        visited: [seed],
        results: [],
        enqueuedPages: 1,
        completed: false,
      },
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].depth).toBe(0);
  });

  it("drops invalid URLs from checkpoint result snapshots", async () => {
    const seed = "https://crawl.example.com/start";
    const result = await runBfsDeepCrawl(
      seed,
      createGraphFetcher({ [seed]: "<html><body>seed</body></html>" }),
      {
        maxDepth: 1,
        maxPages: 5,
        initialState: {
          frontier: [],
          visited: [],
          results: [
            {
              url: "not-a-url",
              depth: 0,
              score: 0,
              success: true,
              linksDiscovered: 0,
            },
            {
              url: seed,
              depth: 0,
              score: 0,
              success: true,
              linksDiscovered: 0,
            },
          ],
          enqueuedPages: 2,
          completed: false,
        },
      },
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].url).toBe(seed);
  });
});
