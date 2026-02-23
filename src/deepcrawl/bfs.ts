import { parseHTML } from "linkedom";
import { FilterChain } from "./filters";
import type { UrlFilterContext } from "./filters";
import type { UrlScorer } from "./scorers";

export interface DeepCrawlPage {
  url: string;
  html: string;
  markdown?: string;
  title?: string;
  method?: string;
  contentType?: string;
}

export interface DeepCrawlNode {
  url: string;
  parentUrl?: string;
  depth: number;
  score: number;
  success: boolean;
  title?: string;
  markdown?: string;
  method?: string;
  linksDiscovered: number;
  error?: string;
}

export interface DeepCrawlStats {
  crawledPages: number;
  succeededPages: number;
  failedPages: number;
  enqueuedPages: number;
  visitedPages: number;
}

export interface DeepCrawlResult {
  results: DeepCrawlNode[];
  stats: DeepCrawlStats;
}

export interface DeepCrawlQueueItem {
  url: string;
  parentUrl?: string;
  depth: number;
  score: number;
  anchorText?: string;
}

export interface DeepCrawlStateSnapshot {
  frontier: DeepCrawlQueueItem[];
  visited: string[];
  results: DeepCrawlNode[];
  enqueuedPages: number;
  completed: boolean;
}

export interface DeepCrawlContext {
  depth: number;
  parentUrl?: string;
  signal?: AbortSignal;
}

export interface DeepCrawlOptions {
  maxDepth: number;
  maxPages: number;
  includeExternal?: boolean;
  filterChain?: FilterChain;
  urlScorer?: UrlScorer;
  scoreThreshold?: number;
  initialState?: DeepCrawlStateSnapshot;
  checkpointEvery?: number;
  onCheckpoint?: (state: DeepCrawlStateSnapshot) => void | Promise<void>;
  signal?: AbortSignal;
  onResult?: (node: DeepCrawlNode) => void | Promise<void>;
}

export type DeepCrawlPageFetcher = (
  url: string,
  context: DeepCrawlContext,
) => Promise<DeepCrawlPage>;

interface ExtractedLink {
  url: string;
  anchorText?: string;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("aborted");
  }
}

function normalizeUrl(value: string, base?: string): string | null {
  try {
    const normalized = base ? new URL(value, base) : new URL(value);
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return null;
    }
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return null;
  }
}

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function isSameHost(seedUrl: string, candidateUrl: string): boolean {
  return getHost(seedUrl) === getHost(candidateUrl);
}

function extractLinksFromHtml(html: string, baseUrl: string): ExtractedLink[] {
  if (!html.trim()) return [];
  let document: any;
  try {
    ({ document } = parseHTML(
      html.includes("<html") ? html : `<html><body>${html}</body></html>`,
    ));
  } catch {
    return [];
  }
  const anchors: any[] = Array.from(document.querySelectorAll?.("a[href]") || []);
  const links: ExtractedLink[] = [];
  for (const anchor of anchors) {
    const href = anchor?.getAttribute?.("href");
    if (!href) continue;
    const normalized = normalizeUrl(href, baseUrl);
    if (!normalized) continue;
    const anchorText = String(anchor?.textContent || "").trim() || undefined;
    links.push({ url: normalized, anchorText });
  }
  return links;
}

async function shouldKeepCandidate(
  candidateUrl: string,
  seedUrl: string,
  filterChain: FilterChain,
  includeExternal: boolean,
  context: UrlFilterContext,
): Promise<boolean> {
  if (!includeExternal && !isSameHost(seedUrl, candidateUrl)) {
    return false;
  }
  return filterChain.test(candidateUrl, context);
}

function scoreCandidate(
  candidateUrl: string,
  depth: number,
  parentUrl: string | undefined,
  anchorText: string | undefined,
  scorer?: UrlScorer,
): number {
  if (!scorer) return 0;
  return scorer.score(candidateUrl, {
    depth,
    parentUrl,
    anchorText,
  });
}

function buildStats(results: DeepCrawlNode[], visited: Set<string>, enqueued: number): DeepCrawlStats {
  const succeeded = results.filter((node) => node.success).length;
  const failed = results.length - succeeded;
  return {
    crawledPages: results.length,
    succeededPages: succeeded,
    failedPages: failed,
    enqueuedPages: enqueued,
    visitedPages: visited.size,
  };
}

function cloneQueue(frontier: DeepCrawlQueueItem[]): DeepCrawlQueueItem[] {
  return frontier.map((item) => ({
    url: item.url,
    parentUrl: item.parentUrl,
    depth: item.depth,
    score: item.score,
    ...(item.anchorText ? { anchorText: item.anchorText } : {}),
  }));
}

function cloneResults(results: DeepCrawlNode[]): DeepCrawlNode[] {
  return results.map((item) => ({ ...item }));
}

function buildSnapshot(
  frontier: DeepCrawlQueueItem[],
  visited: Set<string>,
  results: DeepCrawlNode[],
  enqueuedPages: number,
  completed: boolean,
): DeepCrawlStateSnapshot {
  return {
    frontier: cloneQueue(frontier),
    visited: [...visited],
    results: cloneResults(results),
    enqueuedPages,
    completed,
  };
}

const BFS_QUEUE_COMPACT_MIN_HEAD = 1024;

function maybeCompactBfsQueue(
  queue: DeepCrawlQueueItem[],
  head: number,
): { queue: DeepCrawlQueueItem[]; head: number } {
  if (head < BFS_QUEUE_COMPACT_MIN_HEAD || head * 2 <= queue.length) {
    return { queue, head };
  }
  return {
    queue: queue.slice(head),
    head: 0,
  };
}

function compareBestFirstPriorityLowToHigh(
  a: DeepCrawlQueueItem,
  b: DeepCrawlQueueItem,
): number {
  return a.score - b.score ||
    b.depth - a.depth ||
    b.url.localeCompare(a.url);
}

function insertBestFirstFrontier(
  frontier: DeepCrawlQueueItem[],
  item: DeepCrawlQueueItem,
): void {
  let low = 0;
  let high = frontier.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const cmp = compareBestFirstPriorityLowToHigh(item, frontier[mid]);
    if (cmp > 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  frontier.splice(low, 0, item);
}

function normalizeInitialQueue(
  frontier: DeepCrawlQueueItem[] | undefined,
  maxDepth: number,
): DeepCrawlQueueItem[] {
  if (!frontier || frontier.length === 0) return [];

  const normalized: DeepCrawlQueueItem[] = [];
  for (const item of frontier) {
    const normalizedUrl = normalizeUrl(item.url);
    if (!normalizedUrl) continue;
    const parentUrl = typeof item.parentUrl === "string"
      ? normalizeUrl(item.parentUrl) || undefined
      : undefined;
    const anchorText = typeof item.anchorText === "string" && item.anchorText.trim()
      ? item.anchorText.trim()
      : undefined;
    const rawDepth = typeof item.depth === "number" && Number.isFinite(item.depth)
      ? item.depth
      : 0;
    const depth = Math.max(0, Math.min(maxDepth, Math.floor(rawDepth)));
    const score = Number.isFinite(item.score) ? item.score : 0;
    normalized.push({
      url: normalizedUrl,
      ...(parentUrl ? { parentUrl } : {}),
      depth,
      score,
      ...(anchorText ? { anchorText } : {}),
    });
  }
  return normalized;
}

function initializeState(
  normalizedSeed: string,
  maxDepth: number,
  maxPages: number,
  initialState?: DeepCrawlStateSnapshot,
): {
  frontier: DeepCrawlQueueItem[];
  visited: Set<string>;
  results: DeepCrawlNode[];
  enqueuedPages: number;
} {
  if (!initialState) {
    return {
      frontier: [
        {
          url: normalizedSeed,
          depth: 0,
          score: 0,
        },
      ],
      visited: new Set<string>([normalizedSeed]),
      results: [],
      enqueuedPages: 1,
    };
  }

  const frontier = normalizeInitialQueue(initialState.frontier, maxDepth);
  const restoredResults = cloneResults(initialState.results || []).slice(0, maxPages);
  const results: DeepCrawlNode[] = [];
  const visited = new Set<string>();

  for (const item of initialState.visited || []) {
    const normalized = normalizeUrl(item);
    if (normalized) visited.add(normalized);
  }
  for (const item of frontier) {
    visited.add(item.url);
  }
  for (const item of restoredResults) {
    const normalized = normalizeUrl(item.url);
    if (normalized) {
      results.push({
        ...item,
        url: normalized,
      });
      visited.add(normalized);
    }
  }

  if (!visited.has(normalizedSeed)) {
    visited.add(normalizedSeed);
  }

  if (frontier.length === 0 && results.length === 0) {
    frontier.push({
      url: normalizedSeed,
      depth: 0,
      score: 0,
    });
  }

  const enqueuedPages = Math.max(
    Number.isFinite(initialState.enqueuedPages)
      ? Math.floor(initialState.enqueuedPages)
      : 0,
    visited.size,
    frontier.length + results.length,
    1,
  );

  return {
    frontier,
    visited,
    results,
    enqueuedPages,
  };
}

async function maybeEmitCheckpoint(
  options: DeepCrawlOptions,
  frontier: DeepCrawlQueueItem[],
  visited: Set<string>,
  results: DeepCrawlNode[],
  enqueuedPages: number,
  completed: boolean,
  processedSinceStart: number,
): Promise<void> {
  if (!options.onCheckpoint) return;

  const interval = options.checkpointEvery && options.checkpointEvery > 0
    ? Math.floor(options.checkpointEvery)
    : 0;
  if (!completed && interval > 0 && processedSinceStart % interval !== 0) {
    return;
  }

  await options.onCheckpoint(
    buildSnapshot(frontier, visited, results, enqueuedPages, completed),
  );
}

function bfsFrontierForCheckpoint(
  options: DeepCrawlOptions,
  queue: DeepCrawlQueueItem[],
  queueHead: number,
): DeepCrawlQueueItem[] {
  if (!options.onCheckpoint || queueHead === 0) {
    return queue;
  }
  return queue.slice(queueHead);
}

export async function runBfsDeepCrawl(
  seedUrl: string,
  fetchPage: DeepCrawlPageFetcher,
  options: DeepCrawlOptions,
): Promise<DeepCrawlResult> {
  const normalizedSeed = normalizeUrl(seedUrl);
  if (!normalizedSeed) {
    throw new Error("Invalid seed URL");
  }

  const maxDepth = Math.max(0, options.maxDepth);
  const maxPages = Math.max(1, options.maxPages);
  const includeExternal = options.includeExternal === true;
  const filterChain = options.filterChain || new FilterChain();
  const scoreThreshold = options.scoreThreshold ?? Number.NEGATIVE_INFINITY;

  const initialized = initializeState(
    normalizedSeed,
    maxDepth,
    maxPages,
    options.initialState,
  );
  let queue: DeepCrawlQueueItem[] = initialized.frontier;
  let queueHead = 0;
  const visited = initialized.visited;
  const results: DeepCrawlNode[] = initialized.results;
  let enqueued = initialized.enqueuedPages;
  let processedSinceStart = 0;

  while (queueHead < queue.length && results.length < maxPages) {
    throwIfAborted(options.signal);
    const current = queue[queueHead]!;
    queueHead += 1;

    let node: DeepCrawlNode;
    try {
      const page = await fetchPage(current.url, {
        depth: current.depth,
        parentUrl: current.parentUrl,
        signal: options.signal,
      });

      const pageAllowed = await filterChain.test(current.url, {
        url: current.url,
        parentUrl: current.parentUrl,
        depth: current.depth,
        seedHost: getHost(normalizedSeed),
        contentType: page.contentType,
      });
      if (!pageAllowed) {
        node = {
          url: page.url || current.url,
          parentUrl: current.parentUrl,
          depth: current.depth,
          score: current.score,
          success: false,
          title: page.title,
          markdown: page.markdown,
          method: page.method,
          linksDiscovered: 0,
          error: "Filtered by active filter chain.",
        };
        results.push(node);
        processedSinceStart += 1;
        if (options.onResult) {
          await options.onResult(node);
        }
        await maybeEmitCheckpoint(
          options,
          bfsFrontierForCheckpoint(options, queue, queueHead),
          visited,
          results,
          enqueued,
          false,
          processedSinceStart,
        );
        continue;
      }

      const discoveredLinks: string[] = [];
      const discoveredInPage = new Set<string>();
      if (current.depth < maxDepth && results.length < maxPages) {
        const rawLinks = extractLinksFromHtml(page.html || "", current.url);
        for (const link of rawLinks) {
          if (visited.has(link.url) || discoveredInPage.has(link.url)) continue;
          const keep = await shouldKeepCandidate(
            link.url,
            normalizedSeed,
            filterChain,
            includeExternal,
            {
              url: link.url,
              parentUrl: current.url,
              depth: current.depth + 1,
              seedHost: getHost(normalizedSeed),
            },
          );
          if (!keep) continue;
          const score = scoreCandidate(
            link.url,
            current.depth + 1,
            current.url,
            link.anchorText,
            options.urlScorer,
          );
          if (score < scoreThreshold) continue;
          discoveredInPage.add(link.url);
          discoveredLinks.push(link.url);
          visited.add(link.url);
          queue.push({
            url: link.url,
            parentUrl: current.url,
            depth: current.depth + 1,
            score,
            anchorText: link.anchorText,
          });
        }
        enqueued += discoveredLinks.length;
      }

      node = {
        url: page.url || current.url,
        parentUrl: current.parentUrl,
        depth: current.depth,
        score: current.score,
        success: true,
        title: page.title,
        markdown: page.markdown,
        method: page.method,
        linksDiscovered: discoveredLinks.length,
      };
    } catch (error) {
      node = {
        url: current.url,
        parentUrl: current.parentUrl,
        depth: current.depth,
        score: current.score,
        success: false,
        linksDiscovered: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    results.push(node);
    processedSinceStart += 1;
    if (options.onResult) {
      await options.onResult(node);
    }
    await maybeEmitCheckpoint(
      options,
      bfsFrontierForCheckpoint(options, queue, queueHead),
      visited,
      results,
      enqueued,
      false,
      processedSinceStart,
    );

    const compacted = maybeCompactBfsQueue(queue, queueHead);
    queue = compacted.queue;
    queueHead = compacted.head;
  }

  await maybeEmitCheckpoint(
    options,
    bfsFrontierForCheckpoint(options, queue, queueHead),
    visited,
    results,
    enqueued,
    true,
    processedSinceStart,
  );

  return {
    results,
    stats: buildStats(results, visited, enqueued),
  };
}

export async function runBestFirstDeepCrawl(
  seedUrl: string,
  fetchPage: DeepCrawlPageFetcher,
  options: DeepCrawlOptions,
): Promise<DeepCrawlResult> {
  const normalizedSeed = normalizeUrl(seedUrl);
  if (!normalizedSeed) {
    throw new Error("Invalid seed URL");
  }

  const maxDepth = Math.max(0, options.maxDepth);
  const maxPages = Math.max(1, options.maxPages);
  const includeExternal = options.includeExternal === true;
  const filterChain = options.filterChain || new FilterChain();
  const scoreThreshold = options.scoreThreshold ?? Number.NEGATIVE_INFINITY;

  const initialized = initializeState(
    normalizedSeed,
    maxDepth,
    maxPages,
    options.initialState,
  );
  const frontier: DeepCrawlQueueItem[] = initialized.frontier;
  if (!options.initialState || options.initialState.results.length === 0) {
    frontier[0].score = Number.POSITIVE_INFINITY;
  }
  frontier.sort(compareBestFirstPriorityLowToHigh);
  const visited = initialized.visited;
  const results: DeepCrawlNode[] = initialized.results;
  let enqueued = initialized.enqueuedPages;
  let processedSinceStart = 0;

  while (frontier.length > 0 && results.length < maxPages) {
    throwIfAborted(options.signal);
    const current = frontier.pop()!;

    let node: DeepCrawlNode;
    try {
      const page = await fetchPage(current.url, {
        depth: current.depth,
        parentUrl: current.parentUrl,
        signal: options.signal,
      });

      const pageAllowed = await filterChain.test(current.url, {
        url: current.url,
        parentUrl: current.parentUrl,
        depth: current.depth,
        seedHost: getHost(normalizedSeed),
        contentType: page.contentType,
      });
      if (!pageAllowed) {
        node = {
          url: page.url || current.url,
          parentUrl: current.parentUrl,
          depth: current.depth,
          score: Number.isFinite(current.score) ? current.score : 0,
          success: false,
          title: page.title,
          markdown: page.markdown,
          method: page.method,
          linksDiscovered: 0,
          error: "Filtered by active filter chain.",
        };
        results.push(node);
        processedSinceStart += 1;
        if (options.onResult) {
          await options.onResult(node);
        }
        await maybeEmitCheckpoint(
          options,
          frontier,
          visited,
          results,
          enqueued,
          false,
          processedSinceStart,
        );
        continue;
      }

      let discoveredCount = 0;
      if (current.depth < maxDepth && results.length < maxPages) {
        const rawLinks = extractLinksFromHtml(page.html || "", current.url);
        const discoveredInPage = new Set<string>();
        for (const link of rawLinks) {
          if (visited.has(link.url) || discoveredInPage.has(link.url)) continue;
          const keep = await shouldKeepCandidate(
            link.url,
            normalizedSeed,
            filterChain,
            includeExternal,
            {
              url: link.url,
              parentUrl: current.url,
              depth: current.depth + 1,
              seedHost: getHost(normalizedSeed),
            },
          );
          if (!keep) continue;
          const score = scoreCandidate(
            link.url,
            current.depth + 1,
            current.url,
            link.anchorText,
            options.urlScorer,
          );
          if (score < scoreThreshold) continue;
          visited.add(link.url);
          discoveredInPage.add(link.url);
          insertBestFirstFrontier(frontier, {
            url: link.url,
            parentUrl: current.url,
            depth: current.depth + 1,
            score,
            anchorText: link.anchorText,
          });
          enqueued += 1;
          discoveredCount += 1;
        }
      }

      node = {
        url: page.url || current.url,
        parentUrl: current.parentUrl,
        depth: current.depth,
        score: Number.isFinite(current.score) ? current.score : 0,
        success: true,
        title: page.title,
        markdown: page.markdown,
        method: page.method,
        linksDiscovered: discoveredCount,
      };
    } catch (error) {
      node = {
        url: current.url,
        parentUrl: current.parentUrl,
        depth: current.depth,
        score: Number.isFinite(current.score) ? current.score : 0,
        success: false,
        linksDiscovered: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    results.push(node);
    processedSinceStart += 1;
    if (options.onResult) {
      await options.onResult(node);
    }
    await maybeEmitCheckpoint(
      options,
      frontier,
      visited,
      results,
      enqueued,
      false,
      processedSinceStart,
    );
  }

  await maybeEmitCheckpoint(
    options,
    frontier,
    visited,
    results,
    enqueued,
    true,
    processedSinceStart,
  );

  return {
    results,
    stats: buildStats(results, visited, enqueued),
  };
}
