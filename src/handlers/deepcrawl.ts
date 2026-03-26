// 深度爬取处理

import type { Env } from "../types";
import {
  CORS_HEADERS,
  MAX_RESPONSE_BYTES,
  MAX_SELECTOR_LENGTH,
} from "../config";
import { isSafeUrl, isValidUrl } from "../security";
import { htmlToMarkdown } from "../converter";
import {
  runBfsDeepCrawl,
  runBestFirstDeepCrawl,
  type DeepCrawlNode,
  type DeepCrawlOptions,
  type DeepCrawlStateSnapshot,
} from "../deepcrawl/bfs";
import {
  FilterChain,
  createContentTypeFilter,
  createDomainFilter,
  createUrlPatternFilter,
} from "../deepcrawl/filters";
import {
  CompositeUrlScorer,
  KeywordUrlScorer,
} from "../deepcrawl/scorers";
import { alwaysNeedsBrowser } from "../browser";
import { incrementCounter, logMetric } from "../runtime-state";
import { recordDeepCrawlRun } from "../observability/metrics";
import { errorMessage } from "../utils";
import { stableStringify } from "../helpers/crypto";
import { fetchViaCfContent } from "../cf-rest";
import {
  convertUrlWithMetrics,
  RequestAbortedError,
  readBodyWithLimit,
  BodyTooLargeError,
  getCfRestConfig,
  isCfEligible,
} from "./convert";
import { sseResponse } from "./stream";
import { authorizeApiTokenRequest } from "./jobs";

// ─── 常量 ────────────────────────────────────────────────────

const DEEPCRAWL_BODY_MAX_BYTES = 200_000;
const MAX_DEEPCRAWL_DEPTH = 6;
const MAX_DEEPCRAWL_PAGES = 200;
const MAX_DEEPCRAWL_LIST_ITEMS = 100;
const MAX_DEEPCRAWL_LIST_ITEM_LENGTH = 512;
const MAX_DEEPCRAWL_KEYWORDS = 32;
const CRAWL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DEEPCRAWL_DEFAULT_CHECKPOINT_EVERY = 5;
const DEEPCRAWL_DEFAULT_CHECKPOINT_TTL_SECONDS = 86_400 * 7;
const DEEPCRAWL_CHECKPOINT_KEY_PREFIX = "deepcrawl:v1:";

// ─── 类型定义 ────────────────────────────────────────────────

type DeepCrawlStrategy = "bfs" | "best_first";

interface DeepCrawlCheckpointInput {
  crawl_id?: string;
  resume?: boolean;
  snapshot_interval?: number;
  ttl_seconds?: number;
}

interface DeepCrawlFiltersInput {
  url_patterns?: string[];
  allow_domains?: string[];
  block_domains?: string[];
  content_types?: string[];
}

interface DeepCrawlScorerInput {
  keywords?: string[];
  weight?: number;
  score_threshold?: number;
}

interface DeepCrawlOutputInput {
  include_markdown?: boolean;
}

interface DeepCrawlFetchInput {
  selector?: string;
  force_browser?: boolean;
  no_cache?: boolean;
}

interface DeepCrawlRequestInput {
  seed?: string;
  max_depth?: number;
  max_pages?: number;
  strategy?: DeepCrawlStrategy;
  include_external?: boolean;
  stream?: boolean;
  filters?: DeepCrawlFiltersInput;
  scorer?: DeepCrawlScorerInput;
  output?: DeepCrawlOutputInput;
  fetch?: DeepCrawlFetchInput;
  checkpoint?: DeepCrawlCheckpointInput;
}

interface DeepCrawlNormalizedPayload {
  seed: string;
  maxDepth: number;
  maxPages: number;
  strategy: DeepCrawlStrategy;
  includeExternal: boolean;
  stream: boolean;
  urlPatterns: string[];
  allowDomains: string[];
  blockDomains: string[];
  contentTypes: string[];
  keywords: string[];
  keywordWeight: number;
  scoreThreshold: number;
  includeMarkdown: boolean;
  selector?: string;
  forceBrowser: boolean;
  noCache: boolean;
  crawlId: string;
  checkpointEnabled: boolean;
  resume: boolean;
  snapshotInterval: number;
  checkpointTtlSeconds: number;
}

interface DeepCrawlCheckpointConfig {
  includeExternal: boolean;
  urlPatterns: string[];
  allowDomains: string[];
  blockDomains: string[];
  contentTypes: string[];
  keywords: string[];
  keywordWeight: number;
  scoreThreshold: number;
  includeMarkdown: boolean;
  selector?: string;
  forceBrowser: boolean;
  noCache: boolean;
}

interface DeepCrawlCheckpointRecord {
  version: number;
  crawlId: string;
  seed: string;
  strategy: DeepCrawlStrategy;
  config?: DeepCrawlCheckpointConfig;
  maxDepth: number;
  maxPages: number;
  includeExternal: boolean;
  state: DeepCrawlStateSnapshot;
  updatedAt: string;
}

class DeepCrawlRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface DeepCrawlExecutionResult {
  crawlId: string;
  resumed: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: DeepCrawlNode[];
  stats: {
    crawledPages: number;
    succeededPages: number;
    failedPages: number;
    enqueuedPages: number;
    visitedPages: number;
  };
}

// ─── 辅助函数 ────────────────────────────────────────────────

function deepCrawlCheckpointKey(crawlId: string): string {
  return `${DEEPCRAWL_CHECKPOINT_KEY_PREFIX}${crawlId}`;
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DeepCrawlRequestError(`${field} must be an integer.`);
  }
  if (value < min || value > max) {
    throw new DeepCrawlRequestError(`${field} must be between ${min} and ${max}.`);
  }
  return value;
}

function parseOptionalBoolean(value: unknown, field: string, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw new DeepCrawlRequestError(`${field} must be a boolean.`);
  }
  return value;
}

export function parseStringList(value: unknown, field: string, maxItems: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new DeepCrawlRequestError(`${field} must be an array of strings.`);
  }
  if (value.length > maxItems) {
    throw new DeepCrawlRequestError(`${field} supports at most ${maxItems} items.`);
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "string") {
      throw new DeepCrawlRequestError(`${field} must only contain strings.`);
    }
    const normalized = item.trim();
    if (!normalized) {
      throw new DeepCrawlRequestError(`${field} must only contain non-empty strings.`);
    }
    if (normalized.length > MAX_DEEPCRAWL_LIST_ITEM_LENGTH) {
      throw new DeepCrawlRequestError(
        `${field} items must be at most ${MAX_DEEPCRAWL_LIST_ITEM_LENGTH} characters.`,
      );
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

export function normalizeDomainList(values: string[], field: string): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    let hostname = "";
    try {
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(item)
        ? item
        : `https://${item}`;
      hostname = new URL(withScheme).hostname.trim().toLowerCase().replace(/\.+$/, "");
    } catch {
      throw new DeepCrawlRequestError(`${field} contains invalid domain: ${item}`);
    }
    if (!hostname || hostname.includes(" ")) {
      throw new DeepCrawlRequestError(`${field} contains invalid domain: ${item}`);
    }
    if (!seen.has(hostname)) {
      seen.add(hostname);
      normalized.push(hostname);
    }
  }
  return normalized;
}

export function buildDeepCrawlCheckpointConfig(
  payload: Pick<
    DeepCrawlNormalizedPayload,
    | "includeExternal"
    | "urlPatterns"
    | "allowDomains"
    | "blockDomains"
    | "contentTypes"
    | "keywords"
    | "keywordWeight"
    | "scoreThreshold"
    | "includeMarkdown"
    | "selector"
    | "forceBrowser"
    | "noCache"
  >,
): DeepCrawlCheckpointConfig {
  return {
    includeExternal: payload.includeExternal,
    urlPatterns: [...payload.urlPatterns],
    allowDomains: [...payload.allowDomains],
    blockDomains: [...payload.blockDomains],
    contentTypes: [...payload.contentTypes],
    keywords: [...payload.keywords],
    keywordWeight: payload.keywordWeight,
    scoreThreshold: payload.scoreThreshold,
    includeMarkdown: payload.includeMarkdown,
    ...(payload.selector ? { selector: payload.selector } : {}),
    forceBrowser: payload.forceBrowser,
    noCache: payload.noCache,
  };
}

export function normalizeDeepCrawlPayload(input: unknown): DeepCrawlNormalizedPayload {
  if (!input || typeof input !== "object") {
    throw new DeepCrawlRequestError("Request body must be a JSON object.");
  }

  const body = input as DeepCrawlRequestInput;
  const seed = typeof body.seed === "string" ? body.seed.trim() : "";
  if (!seed) {
    throw new DeepCrawlRequestError("seed is required.");
  }
  if (!isValidUrl(seed) || !isSafeUrl(seed)) {
    throw new DeepCrawlRequestError(
      "seed must be a valid and safe HTTP(S) URL.",
      400,
      { seed },
    );
  }

  const maxDepth = parseBoundedInteger(body.max_depth, "max_depth", 2, 0, MAX_DEEPCRAWL_DEPTH);
  const maxPages = parseBoundedInteger(body.max_pages, "max_pages", 20, 1, MAX_DEEPCRAWL_PAGES);

  const strategy = body.strategy || "bfs";
  if (strategy !== "bfs" && strategy !== "best_first") {
    throw new DeepCrawlRequestError("strategy must be one of: bfs, best_first.");
  }

  const includeExternal = parseOptionalBoolean(body.include_external, "include_external", false);
  const stream = parseOptionalBoolean(body.stream, "stream", false);

  const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
  const urlPatterns = parseStringList(filters.url_patterns, "filters.url_patterns", MAX_DEEPCRAWL_LIST_ITEMS);
  const allowDomains = normalizeDomainList(parseStringList(
    filters.allow_domains, "filters.allow_domains", MAX_DEEPCRAWL_LIST_ITEMS,
  ), "filters.allow_domains");
  const blockDomains = normalizeDomainList(parseStringList(
    filters.block_domains, "filters.block_domains", MAX_DEEPCRAWL_LIST_ITEMS,
  ), "filters.block_domains");
  const contentTypes = parseStringList(filters.content_types, "filters.content_types", MAX_DEEPCRAWL_LIST_ITEMS);

  const scorer = body.scorer && typeof body.scorer === "object" ? body.scorer : {};
  const keywords = parseStringList(scorer.keywords, "scorer.keywords", MAX_DEEPCRAWL_KEYWORDS);
  const keywordWeight = scorer.weight === undefined
    ? 1
    : (() => {
      if (typeof scorer.weight !== "number" || !Number.isFinite(scorer.weight)) {
        throw new DeepCrawlRequestError("scorer.weight must be a finite number.");
      }
      return scorer.weight;
    })();
  const scoreThreshold = scorer.score_threshold === undefined
    ? Number.NEGATIVE_INFINITY
    : (() => {
      if (typeof scorer.score_threshold !== "number" || !Number.isFinite(scorer.score_threshold)) {
        throw new DeepCrawlRequestError("scorer.score_threshold must be a finite number.");
      }
      return scorer.score_threshold;
    })();

  const output = body.output && typeof body.output === "object" ? body.output : {};
  const includeMarkdown = parseOptionalBoolean(output.include_markdown, "output.include_markdown", false);

  const fetchOptions = body.fetch && typeof body.fetch === "object" ? body.fetch : {};
  const selector = typeof fetchOptions.selector === "string" ? fetchOptions.selector : undefined;
  if (selector && selector.length > MAX_SELECTOR_LENGTH) {
    throw new DeepCrawlRequestError(`fetch.selector is too long (max ${MAX_SELECTOR_LENGTH} characters).`);
  }
  const forceBrowser = parseOptionalBoolean(fetchOptions.force_browser, "fetch.force_browser", false);
  const noCache = parseOptionalBoolean(fetchOptions.no_cache, "fetch.no_cache", false);

  const checkpoint = body.checkpoint && typeof body.checkpoint === "object" ? body.checkpoint : {};
  const resume = parseOptionalBoolean(checkpoint.resume, "checkpoint.resume", false);
  const providedCrawlId = typeof checkpoint.crawl_id === "string" ? checkpoint.crawl_id.trim() : "";
  if (providedCrawlId && providedCrawlId.length > 128) {
    throw new DeepCrawlRequestError("checkpoint.crawl_id is too long (max 128 characters).");
  }
  if (providedCrawlId && !CRAWL_ID_PATTERN.test(providedCrawlId)) {
    throw new DeepCrawlRequestError("checkpoint.crawl_id contains unsupported characters.");
  }
  if (resume && !providedCrawlId) {
    throw new DeepCrawlRequestError("checkpoint.crawl_id is required when checkpoint.resume is true.");
  }
  const checkpointEnabled = resume ||
    !!providedCrawlId ||
    checkpoint.snapshot_interval !== undefined ||
    checkpoint.ttl_seconds !== undefined;
  const snapshotInterval = checkpointEnabled
    ? parseBoundedInteger(checkpoint.snapshot_interval, "checkpoint.snapshot_interval", DEEPCRAWL_DEFAULT_CHECKPOINT_EVERY, 1, 100)
    : DEEPCRAWL_DEFAULT_CHECKPOINT_EVERY;
  const checkpointTtlSeconds = checkpointEnabled
    ? parseBoundedInteger(checkpoint.ttl_seconds, "checkpoint.ttl_seconds", DEEPCRAWL_DEFAULT_CHECKPOINT_TTL_SECONDS, 60, 86_400 * 30)
    : DEEPCRAWL_DEFAULT_CHECKPOINT_TTL_SECONDS;
  const crawlId = providedCrawlId || crypto.randomUUID();

  return {
    seed, maxDepth, maxPages, strategy, includeExternal, stream,
    urlPatterns, allowDomains, blockDomains, contentTypes,
    keywords, keywordWeight, scoreThreshold, includeMarkdown,
    selector, forceBrowser, noCache,
    crawlId, checkpointEnabled, resume, snapshotInterval, checkpointTtlSeconds,
  };
}

export function buildDeepCrawlFilterChain(payload: DeepCrawlNormalizedPayload): FilterChain {
  let chain = new FilterChain();
  chain = chain.add(async (url) => isValidUrl(url) && isSafeUrl(url));
  if (payload.urlPatterns.length > 0) {
    chain = chain.add(createUrlPatternFilter(payload.urlPatterns));
  }
  if (payload.allowDomains.length > 0 || payload.blockDomains.length > 0) {
    chain = chain.add(createDomainFilter(payload.allowDomains, payload.blockDomains));
  }
  if (payload.contentTypes.length > 0) {
    chain = chain.add(createContentTypeFilter(payload.contentTypes));
  }
  return chain;
}

export function buildDeepCrawlScorer(payload: DeepCrawlNormalizedPayload): CompositeUrlScorer | undefined {
  if (payload.keywords.length === 0) return undefined;
  return new CompositeUrlScorer([
    new KeywordUrlScorer(payload.keywords, payload.keywordWeight),
  ]);
}

export async function loadDeepCrawlCheckpoint(
  env: Env,
  crawlId: string,
): Promise<DeepCrawlCheckpointRecord | null> {
  const raw = await env.CACHE_KV.get(deepCrawlCheckpointKey(crawlId), "text");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeepCrawlCheckpointRecord>;
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    const state = parsed.state as DeepCrawlStateSnapshot;
    if (!Array.isArray(state.frontier) || !Array.isArray(state.visited) || !Array.isArray(state.results)) {
      return null;
    }
    return {
      version: Number(parsed.version) || 1,
      crawlId: typeof parsed.crawlId === "string" ? parsed.crawlId : crawlId,
      seed: typeof parsed.seed === "string" ? parsed.seed : "",
      strategy: parsed.strategy === "best_first" ? "best_first" : "bfs",
      config: parsed.config && typeof parsed.config === "object"
        ? parsed.config as DeepCrawlCheckpointConfig
        : undefined,
      maxDepth: Number(parsed.maxDepth) || 0,
      maxPages: Number(parsed.maxPages) || 0,
      includeExternal: !!parsed.includeExternal,
      state,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function persistDeepCrawlCheckpoint(
  env: Env,
  payload: DeepCrawlNormalizedPayload,
  state: DeepCrawlStateSnapshot,
): Promise<void> {
  const record: DeepCrawlCheckpointRecord = {
    version: 1,
    crawlId: payload.crawlId,
    seed: payload.seed,
    strategy: payload.strategy,
    config: buildDeepCrawlCheckpointConfig(payload),
    maxDepth: payload.maxDepth,
    maxPages: payload.maxPages,
    includeExternal: payload.includeExternal,
    state,
    updatedAt: new Date().toISOString(),
  };
  await env.CACHE_KV.put(
    deepCrawlCheckpointKey(payload.crawlId),
    JSON.stringify(record),
    { expirationTtl: payload.checkpointTtlSeconds },
  );
}

export async function executeDeepCrawl(
  env: Env,
  host: string,
  payload: DeepCrawlNormalizedPayload,
  signal: AbortSignal | undefined,
  onNode?: (node: DeepCrawlNode) => Promise<void>,
): Promise<DeepCrawlExecutionResult> {
  let initialState: DeepCrawlStateSnapshot | undefined;
  let resumed = false;

  if (payload.resume) {
    const checkpoint = await loadDeepCrawlCheckpoint(env, payload.crawlId);
    if (!checkpoint) {
      throw new DeepCrawlRequestError("checkpoint.crawl_id not found.", 404);
    }
    if (checkpoint.seed && checkpoint.seed !== payload.seed) {
      throw new DeepCrawlRequestError("checkpoint seed does not match current request seed.", 409);
    }
    if (checkpoint.strategy !== payload.strategy) {
      throw new DeepCrawlRequestError("checkpoint strategy does not match current request strategy.", 409);
    }
    if (checkpoint.config) {
      const expected = stableStringify(checkpoint.config);
      const received = stableStringify(buildDeepCrawlCheckpointConfig(payload));
      if (expected !== received) {
        throw new DeepCrawlRequestError("checkpoint configuration does not match current request.", 409);
      }
    } else if (
      checkpoint.includeExternal !== payload.includeExternal
    ) {
      throw new DeepCrawlRequestError("checkpoint configuration does not match current request.", 409);
    }
    initialState = checkpoint.state;
    resumed = true;
  }

  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  const options: DeepCrawlOptions = {
    maxDepth: payload.maxDepth,
    maxPages: payload.maxPages,
    includeExternal: payload.includeExternal,
    filterChain: buildDeepCrawlFilterChain(payload),
    urlScorer: buildDeepCrawlScorer(payload),
    scoreThreshold: payload.scoreThreshold,
    signal,
    ...(initialState ? { initialState } : {}),
    ...(payload.checkpointEnabled
      ? {
        checkpointEvery: payload.snapshotInterval,
        onCheckpoint: async (state: DeepCrawlStateSnapshot) => {
          try {
            await persistDeepCrawlCheckpoint(env, payload, state);
          } catch (error) {
            console.warn("deepcrawl.checkpoint_failed", {
              crawlId: payload.crawlId,
              error: errorMessage(error),
            });
          }
        },
      }
      : {}),
    onResult: async (node) => {
      if (onNode) await onNode(node);
    },
  };

  const fetchPage = async (
    url: string,
    context: { depth: number; parentUrl?: string; signal?: AbortSignal },
  ) => {
    if (!isValidUrl(url) || !isSafeUrl(url)) {
      throw new Error("Invalid or blocked URL.");
    }

    let cfAttempted = false;
    const needsRender = payload.forceBrowser || alwaysNeedsBrowser(url);
    const cfConfig = getCfRestConfig(env);
    if (!needsRender && cfConfig && await isCfEligible(url, env)) {
      cfAttempted = true;
      try {
        const cfHtml = await fetchViaCfContent(url, cfConfig, {
          render: false,
          signal: context.signal,
        });
        if (cfHtml && cfHtml.length > 200
            && new TextEncoder().encode(cfHtml).byteLength <= MAX_RESPONSE_BYTES) {
          const parsed = htmlToMarkdown(cfHtml, url, payload.selector);
          return {
            url,
            html: cfHtml,
            markdown: payload.includeMarkdown ? parsed.markdown : undefined,
            title: parsed.title,
            method: "cf" as string,
          };
        }
      } catch { /* fall through to convertUrl */ }
    }

    const converted = await convertUrlWithMetrics(
      url, env, host, "html", payload.selector, payload.forceBrowser, payload.noCache,
      undefined, context.signal, cfAttempted ? "local" : undefined,
    );

    let markdown: string | undefined;
    if (payload.includeMarkdown) {
      const md = htmlToMarkdown(converted.content, url, payload.selector);
      markdown = md.markdown;
    }

    return {
      url,
      html: converted.content,
      markdown,
      title: converted.title,
      method: converted.method,
      contentType: converted.sourceContentType || undefined,
    };
  };

  const crawlResult = payload.strategy === "best_first"
    ? await runBestFirstDeepCrawl(payload.seed, fetchPage, options)
    : await runBfsDeepCrawl(payload.seed, fetchPage, options);

  incrementCounter("conversionsTotal", crawlResult.stats.succeededPages);
  incrementCounter("conversionFailures", crawlResult.stats.failedPages);

  const finishedAtMs = Date.now();
  const finishedAtIso = new Date(finishedAtMs).toISOString();
  const durationMs = Math.max(0, finishedAtMs - startedAtMs);
  incrementCounter("deepCrawlRuns");
  recordDeepCrawlRun(durationMs);
  return {
    crawlId: payload.crawlId,
    resumed,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    durationMs,
    results: crawlResult.results,
    stats: crawlResult.stats,
  };
}

// ─── 主处理函数 ──────────────────────────────────────────────

export async function handleDeepCrawl(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  const authError = await authorizeApiTokenRequest(request, env);
  if (authError) return authError;

  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > DEEPCRAWL_BODY_MAX_BYTES) {
    return Response.json(
      { error: "Request too large", message: `Maximum body size is ${DEEPCRAWL_BODY_MAX_BYTES} bytes` },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    const bodyBytes = await readBodyWithLimit(
      request.body, DEEPCRAWL_BODY_MAX_BYTES,
      `Maximum body size is ${DEEPCRAWL_BODY_MAX_BYTES} bytes`, request.signal,
    );
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return Response.json(
        { error: "Request too large", message: `Maximum body size is ${DEEPCRAWL_BODY_MAX_BYTES} bytes` },
        { status: 413, headers: CORS_HEADERS },
      );
    }
    return Response.json(
      { error: "Invalid request body", message: "Body must be valid JSON." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  let payload: DeepCrawlNormalizedPayload;
  try {
    payload = normalizeDeepCrawlPayload(body);
  } catch (error) {
    if (error instanceof DeepCrawlRequestError) {
      return Response.json(
        {
          error: "Invalid request",
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.statusCode, headers: CORS_HEADERS },
      );
    }
    return Response.json(
      { error: "Invalid request", message: "Request payload validation failed." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (payload.stream) {
    return sseResponse(async (send, streamSignal) => {
      try {
        await send("start", {
          crawlId: payload.crawlId, seed: payload.seed, strategy: payload.strategy,
          maxDepth: payload.maxDepth, maxPages: payload.maxPages, resumed: payload.resume,
        });

        const result = await executeDeepCrawl(env, host, payload, streamSignal, async (node) => {
          await send("node", node);
        });

        await send("done", {
          crawlId: result.crawlId, resumed: result.resumed, startedAt: result.startedAt,
          finishedAt: result.finishedAt, durationMs: result.durationMs,
          stats: result.stats, resultCount: result.results.length,
        });
        logMetric("deepcrawl.completed", {
          crawlId: result.crawlId, strategy: payload.strategy, stream: true,
          resumed: result.resumed, crawled: result.stats.crawledPages,
          failed: result.stats.failedPages, durationMs: result.durationMs,
        });
      } catch (error) {
        if (streamSignal.aborted || error instanceof RequestAbortedError) return;
        if (error instanceof DeepCrawlRequestError) {
          await send("fail", { title: "Invalid request", message: error.message, status: error.statusCode });
          return;
        }
        console.error("deepcrawl.stream_failed", { crawlId: payload.crawlId, error: errorMessage(error) });
        await send("fail", { title: "Deep crawl failed", message: "Failed to execute deep crawl.", status: 500 });
      }
    }, request.signal);
  }

  try {
    const result = await executeDeepCrawl(env, host, payload, request.signal);
    logMetric("deepcrawl.completed", {
      crawlId: result.crawlId, strategy: payload.strategy, stream: false,
      resumed: result.resumed, crawled: result.stats.crawledPages,
      failed: result.stats.failedPages, durationMs: result.durationMs,
    });
    return Response.json(
      {
        crawlId: result.crawlId, seed: payload.seed, strategy: payload.strategy,
        resumed: result.resumed, startedAt: result.startedAt, finishedAt: result.finishedAt,
        durationMs: result.durationMs, stats: result.stats, results: result.results,
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    if (error instanceof DeepCrawlRequestError) {
      return Response.json(
        {
          error: "Invalid request",
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.statusCode, headers: CORS_HEADERS },
      );
    }
    console.error("deepcrawl.failed", { crawlId: payload.crawlId, error: errorMessage(error) });
    return Response.json(
      { error: "Deep crawl failed", message: "Failed to execute deep crawl." },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
