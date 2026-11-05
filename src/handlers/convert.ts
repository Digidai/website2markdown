// 核心转换逻辑

import type { ConvertMethod, Env, OutputFormat } from "../types";
import {
  MAX_RESPONSE_BYTES,
  WECHAT_UA,
  MOBILE_UA,
  DESKTOP_UA,
  BROWSER_TIMEOUT,
} from "../config";
import {
  needsBrowserRendering,
  fetchWithSafeRedirects,
} from "../security";
import { htmlToMarkdown, proxyImageUrls } from "../converter";
import {
  fetchWithBrowser,
  alwaysNeedsBrowser,
  getAdapter,
  genericAdapter,
} from "../browser";
import { fetchViaCfMarkdown, type CfRestConfig } from "../cf-rest";
import {
  consumeProxyRetryCookies,
  extractLegacyProxyRetryCookies,
  extractProxyRetryToken,
} from "../browser/proxy-retry";
import { getCached, getNegativeCache, setCache, setNegativeCache } from "../cache";
import { fetchViaJina } from "../jina";
import { fetchViaFirecrawl, type FirecrawlConfig } from "../firecrawl";
import {
  parseProxyUrl,
  parseProxyPool,
  fetchViaProxy,
  fetchViaProxyPool,
} from "../proxy";
import { fetchViaBrowserUse } from "../browser-use";
import { fetchViaContextDev } from "../context-dev";
import { bumpLimit } from "../middleware/rate-limit-d1";
import { hasWechatArticleBody, isWechatPageChrome } from "../browser/adapters/wechat";
import { isFeishuDocumentUrl } from "../browser/adapters/feishu";
import { fetchFeishuSsr } from "../browser/adapters/feishu-ssr";
import { substackAdapter } from "../browser/adapters/substack";
import { mediumArticleFromFeed, mediumFeedFor } from "../medium-feed";
import {
  extractEmbeddedArticles,
  findWpJsonUrl,
  wpJsonArticle,
  type EmbeddedArticle,
} from "../embedded-article";
import {
  applyPaywallHeaders,
  removePaywallElements,
  looksPaywalled,
  getPaywallRule,
  fetchWaybackSnapshot,
  fetchArchiveToday,
  extractAmpLink,
  stripAmpAccessControls,
} from "../paywall";
import { recordConversionLatency } from "../observability/metrics";
import { errorMessage } from "../utils";
import { ConvertError, type ConvertDiagnostics } from "../helpers/response";
import {
  GOV_EMPTY_SHELL_MESSAGE,
  isGovEmptyShell,
  isNegativeOriginStatus,
  anonymousBlockMessage,
} from "../policy/anonymous-guards";
import { formatOutput, markdownBodyChars } from "../helpers/format";
import { trackProvider } from "../observability/provider-attempts";

// ─── 错误类 ──────────────────────────────────────────────────

export class RequestAbortedError extends Error {
  constructor() {
    super("Request was aborted.");
  }
}

export class SseStreamClosedError extends Error {
  constructor(message: string = "SSE stream is closed.") {
    super(message);
  }
}

export class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// ─── 工具函数 ────────────────────────────────────────────────

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RequestAbortedError();
  }
}

export function isTimeoutLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  const lower = errorMessage(error).toLowerCase();
  return lower.includes("timeout") || lower.includes("timed out");
}

export function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    },
  };
}

export async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLargeMessage: string,
  abortSignal?: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      throwIfAborted(abortSignal);
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new BodyTooLargeError(tooLargeMessage);
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0];

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function readTextWithLimit(
  response: Response,
  maxBytes: number,
  tooLargeMessage: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const bytes = await readBodyWithLimit(
    response.body,
    maxBytes,
    tooLargeMessage,
    abortSignal,
  );
  return new TextDecoder().decode(bytes);
}

export function asFetchConvertError(error: unknown): ConvertError {
  const message = errorMessage(error);
  if (message.includes("SSRF")) {
    return new ConvertError(
      "Blocked",
      "Redirect target points to an internal or private address.",
      403,
    );
  }
  if (isTimeoutLikeError(error)) {
    return new ConvertError(
      "Fetch Timeout",
      `Fetching the target URL timed out after ${Math.round(BROWSER_TIMEOUT / 1000)} seconds.`,
      504,
    );
  }
  return new ConvertError(
    "Fetch Failed",
    message || "Failed to fetch the target URL.",
    502,
  );
}

/**
 * Sites hosted in mainland China, government and university sites above all,
 * often drop connections from outside China. Cloudflare has no mainland egress,
 * so waiting the full 30 seconds only delays the same timeout. Those hosts get
 * a shorter wait and an error that says why.
 */
const MAINLAND_FETCH_TIMEOUT = 10_000;
/** Hosts outside .cn that timed out from every overseas location we tested. */
const MAINLAND_ONLY_HOSTS = new Set(["www.tsrcw.com", "tsrcw.com"]);
export const MAINLAND_TIMEOUT_MESSAGE =
  "The site did not answer within 10 seconds. Many sites hosted in mainland China, especially government and university sites, refuse connections from outside China, and this service fetches from outside China.";

export function isLikelyMainlandOnlyHost(raw: string): boolean {
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.endsWith(".cn") || MAINLAND_ONLY_HOSTS.has(host);
}

/** Bot walls answer these; other statuses are the page's real answer. */
const BLOCKED_STATUSES = [401, 403, 429, 503];

/** Attach targetStatus only for origin statuses that anonymous callers may remember. */
function originStatusError(response: Response): ConvertError {
  const targetStatus = isNegativeOriginStatus(response.status) ? response.status : undefined;
  return new ConvertError(
    "Fetch Failed",
    `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`,
    502,
    targetStatus,
  );
}

export function isLikelyChallengeHtml(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    isWechatVerificationHtml(body) ||
    (lower.includes("passport.weibo") ||
      lower.includes("qrcode_login") ||
      lower.includes("login_type")) ||
    (lower.includes("verify") &&
      lower.includes("captcha") &&
      body.length < 5000) ||
    lower.includes("cf-browser-verification") ||
    lower.includes("cf-challenge") ||
    (lower.includes("just a moment") &&
      lower.includes("cloudflare") &&
      body.length < 10000)
  );
}

export function isWechatVerificationHtml(body: string): boolean {
  return (
    body.includes("wappoc_appmsgcaptcha") ||
    body.includes("当前环境异常") ||
    body.includes("完成验证后即可继续访问") ||
    /(?:请(?:先)?完成(?:安全)?验证|请进行(?:安全)?验证|拖动滑块|滑动验证|拼图验证|验证后(?:即可)?继续访问)/.test(body) ||
    (/(?:安全验证|验证码|captcha|tcaptcha)/i.test(body) &&
      (/(?:<title[^>]*>\s*[^<]*(?:验证|captcha)|\b(?:id|class|src|action)\s*=\s*["'][^"']*(?:captcha|verify))/i.test(body) ||
        !hasWechatArticleBody(body)))
  );
}

/**
 * WeChat pages that no fallback can turn into an article: a deleted or blocked
 * post, or a video post. targetStatus 410 lets anonymous repeats hit the
 * negative cache for a day instead of rerunning the remote browser and proxy.
 */
export function wechatUnavailableError(html: string): ConvertError | null {
  if (/weui-msg__title[^>]*>[^<]*(?:无法查看|删除|违规|停止访问)/.test(html)) {
    return new ConvertError(
      "Content Unavailable",
      "This WeChat article was deleted or blocked by WeChat and cannot be viewed.",
      410,
      410,
    );
  }
  if (/\bitem_show_type\s*[:=]\s*['"]5['"]/.test(html)) {
    return new ConvertError(
      "Unsupported Content",
      "This WeChat post is a video and has no article text to convert.",
      422,
      410,
    );
  }
  return null;
}

function throwIfWechatUnavailable(targetUrl: string, html: string): void {
  if (!targetUrl.includes("mp.weixin.qq.com")) return;
  const error = wechatUnavailableError(html);
  if (error) throw error;
}

function isWechatVerificationUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().includes("wappoc_appmsgcaptcha");
  } catch {
    return false;
  }
}

function isWechatMarkdownShell(markdown: string, title: string): boolean {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  const lines = markdown.split(/\r?\n/).map((line) =>
    line.trim()
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\*\*(.*?)\*\*$/, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim(),
  ).filter(Boolean);
  return lines.every((line) =>
    line === normalizedTitle ||
    /^(?:作者|发布时间)\s*[:：]/.test(line) ||
    isWechatPageChrome(line),
  );
}

// ─── CF REST API helpers ─────────────────────────────────────

export function getCfRestConfig(env: Env): CfRestConfig | null {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;
  return { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN };
}

export function extractTitleFromCfMarkdown(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

// ─── 转换结果接口 ────────────────────────────────────────────

export interface ConvertResult {
  content: string;
  title: string;
  method: ConvertMethod;
  tokenCount: string;
  /** markdownBodyChars of the markdown before formatting; absent on cache entries written before it was stored. */
  bodyChars?: number;
  sourceContentType: string;
  cached: boolean;
  diagnostics: ConvertDiagnostics;
}

function resolveCachedSourceContentType(method: string, sourceContentType?: string): string {
  if (sourceContentType) return sourceContentType;
  if (method === "jina" || method === "firecrawl" || method === "native") return "text/markdown";
  return "text/html";
}

function getFirecrawlConfig(env: Env, allowApiKey: boolean = true): FirecrawlConfig {
  const parsedTimeout = Number(env.FIRECRAWL_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? Math.min(Math.max(parsedTimeout, 5_000), 60_000)
    : 20_000;
  return {
    apiKey: allowApiKey ? env.FIRECRAWL_API_KEY : undefined,
    apiUrl: env.FIRECRAWL_API_URL,
    timeoutMs,
  };
}

// ─── 核心转换函数 ────────────────────────────────────────────

export async function convertUrl(
  targetUrl: string,
  env: Env,
  host: string,
  format: OutputFormat,
  selector: string | undefined,
  forceBrowser: boolean,
  noCache: boolean,
  onProgress?: (step: string, label: string) => void | Promise<void>,
  abortSignal?: AbortSignal,
  engine?: string,
  browserAllowed: boolean = true,
  providerApiKeysAllowed: boolean = true,
  sessionProfileScope?: string,
  anonymousCaller: boolean = false,
): Promise<ConvertResult> {
  const progress = onProgress || (() => {});
  throwIfAborted(abortSignal);
  // Search pages and proxy services are rejected before either cache, and are not remembered as origin failures.
  const anonymousBlock = anonymousCaller ? anonymousBlockMessage(targetUrl) : null;
  if (anonymousBlock) {
    throw new ConvertError("Unauthorized", anonymousBlock, 401);
  }
  const fallbacks = new Set<string>();
  let browserRendered = false;
  let paywallDetected = false;
  let sourceContentType = "text/html";

  // Anonymous tier: forceBrowser is ineffective when browser is not allowed
  const effectiveForceBrowser = browserAllowed ? forceBrowser : false;
  const cacheAllowed = !noCache && !effectiveForceBrowser;

  // 1. Positive cache first. Anonymous origin failures use a separate keyspace.
  if (cacheAllowed) {
    const cached = await getCached(env, targetUrl, format, selector, engine);
    if (cached) {
      return {
        content: cached.content,
        title: cached.title || "",
        method: cached.method as ConvertMethod,
        tokenCount: "",
        bodyChars: cached.bodyChars,
        sourceContentType: resolveCachedSourceContentType(
          cached.method,
          cached.sourceContentType,
        ),
        cached: true,
        diagnostics: {
          cacheHit: true,
          browserRendered: false,
          paywallDetected: false,
          fallbacks: [],
        },
      };
    }
  }

  if (anonymousCaller && cacheAllowed) {
    const negative = await getNegativeCache(env, targetUrl);
    if (negative) {
      throw new ConvertError(
        negative.title,
        negative.message,
        negative.statusCode,
        negative.targetStatus,
        true,
      );
    }
  }

  try {
    // Anonymous requests must not call Firecrawl or Jina, including explicit
    // engine selection. Authenticated free and pro keys still can.
    if ((engine === "firecrawl" || engine === "jina") && !providerApiKeysAllowed) {
      throw new ConvertError(
        "Unauthorized",
        "engine selection requires an API key.",
        401,
      );
    }

    // 2a. Firecrawl 快速路径 — engine=firecrawl 时跳过所有其他转换
    if (engine === "firecrawl") {
      return tryFirecrawlFastPath(
        targetUrl,
        env,
        format,
        selector,
        !cacheAllowed,
        engine,
        progress,
        abortSignal,
        providerApiKeysAllowed,
      );
    }

    // 2b. Jina 快速路径 — engine=jina 时跳过所有其他转换
    if (engine === "jina") {
      return tryJinaFastPath(targetUrl, env, format, selector, !cacheAllowed, engine, progress, abortSignal);
    }

    // 2c. CF Markdown path, only when requested with engine=cf. Every /markdown
    // call launches a billed browser, so it shares the browser-rendering gate.
    if (engine === "cf" && browserAllowed) {
      const cfResult = await tryCfRestApi(
        targetUrl, env, format, selector, effectiveForceBrowser, !cacheAllowed, engine, fallbacks, progress, abortSignal,
      );
      if (cfResult) return cfResult;
    }

    // 3. Fetch & parse
    return await tryFetchAndParse(
      targetUrl, env, host, format, selector, effectiveForceBrowser, !cacheAllowed, engine,
      fallbacks, browserRendered, paywallDetected, sourceContentType,
      progress, abortSignal, browserAllowed, providerApiKeysAllowed, sessionProfileScope,
    );
  } catch (error) {
    if (
      anonymousCaller &&
      cacheAllowed &&
      error instanceof ConvertError &&
      error.targetStatus !== undefined &&
      isNegativeOriginStatus(error.targetStatus)
    ) {
      try {
        await setNegativeCache(env, targetUrl, {
          title: error.title,
          message: error.message,
          statusCode: error.statusCode,
          targetStatus: error.targetStatus,
        });
      } catch {
        // A cache write must not replace the origin error.
      }
    }
    throw error;
  }
}

// ─── 子函数：Firecrawl 快速路径 ───────────────────────────────

async function tryFirecrawlFastPath(
  targetUrl: string,
  env: Env,
  format: OutputFormat,
  selector: string | undefined,
  noCache: boolean,
  engine: string | undefined,
  progress: (step: string, label: string) => void | Promise<void>,
  abortSignal?: AbortSignal,
  providerApiKeysAllowed: boolean = true,
): Promise<ConvertResult> {
  await progress("fetch", "Fetching via Firecrawl");
  const firecrawlResult = await trackProvider(env, "firecrawl", abortSignal, () => fetchViaFirecrawl(
    targetUrl,
    getFirecrawlConfig(env, providerApiKeysAllowed),
    abortSignal,
  ));
  const sourceContentType = "text/markdown";
  const output = formatOutput(
    firecrawlResult.markdown,
    format,
    targetUrl,
    firecrawlResult.title,
    "firecrawl",
  );
  const outputBodyChars = markdownBodyChars(firecrawlResult.markdown);

  if (!noCache) {
    await setCache(
      env, targetUrl, format,
      {
        content: output,
        method: "firecrawl",
        title: firecrawlResult.title,
        sourceContentType,
        bodyChars: outputBodyChars,
      },
      selector, undefined, engine,
    );
  }

  return {
    content: output,
    title: firecrawlResult.title,
    method: "firecrawl",
    tokenCount: "",
    bodyChars: outputBodyChars,
    sourceContentType,
    cached: false,
    diagnostics: {
      cacheHit: false,
      browserRendered: false,
      paywallDetected: false,
      fallbacks: [],
    },
  };
}

async function buildExternalMarkdownResult(
  targetUrl: string,
  env: Env,
  format: OutputFormat,
  selector: string | undefined,
  noCache: boolean,
  engine: string | undefined,
  method: Extract<ConvertMethod, "firecrawl" | "jina">,
  markdown: string,
  title: string,
  fallbacks: Set<string>,
): Promise<ConvertResult> {
  const sourceContentType = "text/markdown";
  const output = formatOutput(markdown, format, targetUrl, title, method);
  const outputBodyChars = markdownBodyChars(markdown);

  if (!noCache) {
    await setCache(
      env, targetUrl, format,
      { content: output, method, title, sourceContentType, bodyChars: outputBodyChars },
      selector, undefined, engine,
    );
  }

  return {
    content: output,
    title,
    method,
    tokenCount: "",
    bodyChars: outputBodyChars,
    sourceContentType,
    cached: false,
    diagnostics: {
      cacheHit: false,
      browserRendered: false,
      paywallDetected: false,
      fallbacks: [...fallbacks],
    },
  };
}

async function tryExternalMarkdownEarlyReturn(
  targetUrl: string,
  env: Env,
  format: OutputFormat,
  selector: string | undefined,
  noCache: boolean,
  engine: string | undefined,
  fallbacks: Set<string>,
  abortSignal?: AbortSignal,
  providerApiKeysAllowed: boolean = true,
): Promise<ConvertResult | null> {
  if (!providerApiKeysAllowed) return null;
  let firecrawlFailed = false;

  try {
    const firecrawlResult = await trackProvider(env, "firecrawl", abortSignal, () => fetchViaFirecrawl(
      targetUrl,
      getFirecrawlConfig(env, providerApiKeysAllowed),
      abortSignal,
    ));
    fallbacks.add("firecrawl_fallback");
    return buildExternalMarkdownResult(
      targetUrl,
      env,
      format,
      selector,
      noCache,
      engine,
      "firecrawl",
      firecrawlResult.markdown,
      firecrawlResult.title,
      fallbacks,
    );
  } catch (error) {
    firecrawlFailed = true;
    console.debug("Firecrawl fallback unavailable:", errorMessage(error));
  }

  try {
    const jinaResult = await trackProvider(env, "jina", abortSignal, () => fetchViaJina(targetUrl, 15_000, abortSignal));
    if (firecrawlFailed) {
      fallbacks.add("firecrawl_error_fallthrough");
    }
    fallbacks.add("jina_fallback");
    return buildExternalMarkdownResult(
      targetUrl,
      env,
      format,
      selector,
      noCache,
      engine,
      "jina",
      jinaResult.markdown,
      jinaResult.title,
      fallbacks,
    );
  } catch (error) {
    console.debug("Jina fallback unavailable:", errorMessage(error));
  }

  return null;
}

// ─── 子函数：Jina 快速路径 ──────────────────────────────────

async function tryJinaFastPath(
  targetUrl: string,
  env: Env,
  format: OutputFormat,
  selector: string | undefined,
  noCache: boolean,
  engine: string | undefined,
  progress: (step: string, label: string) => void | Promise<void>,
  abortSignal?: AbortSignal,
): Promise<ConvertResult> {
  await progress("fetch", "Fetching via Jina Reader");
  const jinaResult = await trackProvider(env, "jina", abortSignal, () => fetchViaJina(targetUrl, 15_000, abortSignal));
  const jinaMarkdown = jinaResult.markdown;
  const jinaTitle = jinaResult.title;
  const sourceContentType = "text/markdown";

  const output = formatOutput(jinaMarkdown, format, targetUrl, jinaTitle, "jina");
  const outputBodyChars = markdownBodyChars(jinaMarkdown);

  if (!noCache) {
    await setCache(
      env, targetUrl, format,
      { content: output, method: "jina", title: jinaTitle, sourceContentType, bodyChars: outputBodyChars },
      selector, undefined, engine,
    );
  }

  return {
    content: output,
    title: jinaTitle,
    method: "jina",
    tokenCount: "",
    bodyChars: outputBodyChars,
    sourceContentType,
    cached: false,
    diagnostics: {
      cacheHit: false,
      browserRendered: false,
      paywallDetected: false,
      fallbacks: [],
    },
  };
}

// ─── 子函数：CF REST API 路径 ────────────────────────────────

async function tryCfRestApi(
  targetUrl: string,
  env: Env,
  format: OutputFormat,
  selector: string | undefined,
  forceBrowser: boolean,
  noCache: boolean,
  engine: string | undefined,
  fallbacks: Set<string>,
  progress: (step: string, label: string) => void | Promise<void>,
  abortSignal?: AbortSignal,
): Promise<ConvertResult | null> {
  const cfConfig = getCfRestConfig(env);
  if (!cfConfig) return null;

  await progress("fetch", "Converting via Cloudflare");
  try {
    const cfResult = await trackProvider(env, "cf_markdown", abortSignal, () => fetchViaCfMarkdown(targetUrl, cfConfig, {
      signal: abortSignal,
    }), (r) => (r.markdown?.length ?? 0) > 200);

    if (cfResult.markdown && cfResult.markdown.length > 200) {
      if (new TextEncoder().encode(cfResult.markdown).byteLength > MAX_RESPONSE_BYTES) {
        throw new ConvertError("Content Too Large", "The CF response exceeds the 5 MB size limit.", 413);
      }
      const cfTitle = extractTitleFromCfMarkdown(cfResult.markdown);
      const sourceContentType = "text/markdown";

      const output = formatOutput(cfResult.markdown, format, targetUrl, cfTitle, "cf");
      const outputBodyChars = markdownBodyChars(cfResult.markdown);

      if (!noCache) {
        await setCache(env, targetUrl, format, {
          content: output, method: "cf", title: cfTitle, sourceContentType, bodyChars: outputBodyChars,
        }, selector, undefined, engine);
      }

      return {
        content: output,
        title: cfTitle,
        method: "cf" as ConvertMethod,
        tokenCount: "",
        bodyChars: outputBodyChars,
        sourceContentType,
        cached: false,
        diagnostics: {
          cacheHit: false,
          browserRendered: true,
          paywallDetected: false,
          fallbacks: [],
        },
      };
    }
    // CF 返回空/短内容 — 降级到后续路径
    fallbacks.add("cf_empty_fallthrough");
  } catch (e) {
    const errMsg = errorMessage(e);
    console.warn("CF REST API failed, falling through:", errMsg);
    fallbacks.add("cf_error_fallthrough");
  }

  return null;
}

// ─── 子函数：Fetch & Parse 路径 ──────────────────────────────

async function tryFetchAndParse(
  targetUrl: string,
  env: Env,
  host: string,
  format: OutputFormat,
  selector: string | undefined,
  forceBrowser: boolean,
  noCache: boolean,
  engine: string | undefined,
  fallbacks: Set<string>,
  browserRendered: boolean,
  paywallDetected: boolean,
  sourceContentType: string,
  progress: (step: string, label: string) => void | Promise<void>,
  abortSignal?: AbortSignal,
  browserAllowed: boolean = true,
  providerApiKeysAllowed: boolean = true,
  sessionProfileScope?: string,
): Promise<ConvertResult> {
  let finalHtml = "";
  let method: ConvertMethod = "readability+turndown";
  let resolvedUrl = targetUrl;
  let wechatShellSeen = false;

  // 应用 adapter URL 变换（如 reddit.com → old.reddit.com）
  const fetchAdapter = getAdapter(targetUrl);
  if (fetchAdapter.transformUrl) {
    targetUrl = fetchAdapter.transformUrl(targetUrl);
    resolvedUrl = targetUrl;
  }

  // Direct fetch 路径 — adapter 完全处理获取逻辑（如基于 API 的站点）
  if (fetchAdapter.fetchDirect) {
    throwIfAborted(abortSignal);
    await progress("fetch", "Fetching via API");
    try {
      const directHtml = await fetchAdapter.fetchDirect(targetUrl, env);
      if (directHtml) {
        finalHtml = directHtml;
        method = "readability+turndown";
        fallbacks.add("direct_fetch");
      }
    } catch (e) {
      console.error("fetchDirect failed, falling through:", errorMessage(e));
    }
  }

  // 早期浏览器路径 — 对总是需要浏览器的站点跳过多余的静态获取
  const requiresBrowser = alwaysNeedsBrowser(targetUrl);

  if (!finalHtml && requiresBrowser && browserAllowed) {
    const result = await tryBrowserRendering(
      targetUrl,
      env,
      host,
      fallbacks,
      abortSignal,
      progress,
      sessionProfileScope,
      providerApiKeysAllowed,
    );
    finalHtml = result.html;
    if (result.rendered) {
      method = "browser+readability+turndown";
      browserRendered = true;
    }
  } else if (!finalHtml && requiresBrowser && !browserAllowed) {
    // WeChat often serves usable article HTML to a MicroMessenger UA. Try this
    // before the slower remote-browser/proxy paths so public page loads do not
    // wait on a long-running Browser Use session.
    if (targetUrl.includes("mp.weixin.qq.com")) {
      const staticResult = await tryStaticFetch(
        targetUrl, env, host, format, selector, forceBrowser, noCache, engine,
        fallbacks, browserRendered, paywallDetected, sourceContentType,
        resolvedUrl, method, progress, abortSignal, browserAllowed,
        providerApiKeysAllowed, sessionProfileScope,
      );
      if (staticResult.earlyReturn) {
        return staticResult.earlyReturn;
      }
      finalHtml = staticResult.finalHtml;
      method = staticResult.method;
      resolvedUrl = staticResult.resolvedUrl;
      browserRendered = staticResult.browserRendered;
      paywallDetected = staticResult.paywallDetected;
      sourceContentType = staticResult.sourceContentType;
      if (finalHtml && !hasWechatArticleBody(finalHtml)) {
        throwIfWechatUnavailable(targetUrl, finalHtml);
        finalHtml = "";
        wechatShellSeen = true;
      }
      if (finalHtml) {
        fallbacks.add("wechat_static_fallback");
      }
    }

    // Public Feishu docs embed their text for crawlers. One plain fetch beats
    // Browser Use, which for wiki pages often returned only the sidebar.
    if (!finalHtml && isFeishuDocumentUrl(targetUrl)) {
      throwIfAborted(abortSignal);
      await progress("fetch", "Fetching Feishu document data");
      try {
        const ssr = await fetchFeishuSsr(targetUrl);
        if (ssr) {
          finalHtml = ssr.html;
          fallbacks.add(ssr.complete ? "feishu_ssr" : "feishu_ssr_partial");
        }
      } catch (e) {
        console.error("Feishu SSR fetch failed, falling through:", errorMessage(e));
      }
    }

    // Anonymous 用户无 browser 权限 — 先走 Browser Use 远程浏览器，再降级住宅代理
    const browserUseKey = env.BROWSER_USE_API_KEY;
    if (!finalHtml && browserUseKey) {
      throwIfAborted(abortSignal);
      await progress("fetch", "Fetching via remote browser");
      const buHtml = await trackProvider(env, "browser_use", abortSignal, () => fetchViaBrowserUse(targetUrl, browserUseKey, abortSignal), (html) => Boolean(html));
      if (buHtml) {
        if (targetUrl.includes("mp.weixin.qq.com") && isWechatVerificationHtml(buHtml)) {
          throw new ConvertError(
            "Fetch Failed",
            "WeChat returned an environment verification page instead of the article content.",
            502,
          );
        }
        if (targetUrl.includes("mp.weixin.qq.com") && !hasWechatArticleBody(buHtml)) {
          throwIfWechatUnavailable(targetUrl, buHtml);
          wechatShellSeen = true;
        } else {
          finalHtml = buHtml;
          method = "proxy+readability+turndown";
          fallbacks.add("browser_use");
        }
      }
    }
    if (!finalHtml) {
      const proxyResult = await tryDirectProxyFetch(
        targetUrl, env, fallbacks, abortSignal, progress,
      );
      if (proxyResult) {
        if (targetUrl.includes("mp.weixin.qq.com") && isWechatVerificationHtml(proxyResult)) {
          throw new ConvertError(
            "Fetch Failed",
            "WeChat returned an environment verification page instead of the article content.",
            502,
          );
        }
        if (targetUrl.includes("mp.weixin.qq.com") && !hasWechatArticleBody(proxyResult)) {
          throwIfWechatUnavailable(targetUrl, proxyResult);
          wechatShellSeen = true;
        } else {
          finalHtml = proxyResult;
          method = "proxy+readability+turndown";
        }
      }
    }
    if (!finalHtml) {
      const rescued = await tryContextDev(
        targetUrl, env, fallbacks, abortSignal, progress, !providerApiKeysAllowed,
      );
      if (rescued) {
        if (targetUrl.includes("mp.weixin.qq.com") && !hasWechatArticleBody(rescued)) {
          throwIfWechatUnavailable(targetUrl, rescued);
          wechatShellSeen = true;
        } else {
          finalHtml = rescued;
          method = "proxy+readability+turndown";
        }
      }
    }

    if (!finalHtml) {
      throw new ConvertError(
        "Fetch Failed",
        wechatShellSeen
          ? "WeChat returned only page controls or a title, without article content."
          : "This URL requires browser or proxy access, but no content was returned by the available fallback methods.",
        502,
      );
    }
  } else if (!finalHtml) {
    // 3. 静态获取
    const staticResult = await tryStaticFetch(
      targetUrl, env, host, format, selector, forceBrowser, noCache, engine,
      fallbacks, browserRendered, paywallDetected, sourceContentType,
      resolvedUrl, method, progress, abortSignal, browserAllowed,
      providerApiKeysAllowed, sessionProfileScope,
    );
    if (staticResult.earlyReturn) {
      return staticResult.earlyReturn;
    }
    finalHtml = staticResult.finalHtml;
    method = staticResult.method;
    resolvedUrl = staticResult.resolvedUrl;
    browserRendered = staticResult.browserRendered;
    paywallDetected = staticResult.paywallDetected;
    sourceContentType = staticResult.sourceContentType;
  }

  // 7. 去除 <script> 和 <style> 标签
  throwIfAborted(abortSignal);
  if (!finalHtml.trim()) {
    throw new ConvertError(
      "Fetch Failed",
      "The target URL returned no HTML content.",
      502,
    );
  }
  if (targetUrl.includes("mp.weixin.qq.com") && isWechatVerificationHtml(finalHtml)) {
    throw new ConvertError(
      "Fetch Failed",
      "WeChat returned an environment verification page instead of the article content.",
      502,
    );
  }
  if (targetUrl.includes("mp.weixin.qq.com") && !hasWechatArticleBody(finalHtml)) {
    throwIfWechatUnavailable(targetUrl, finalHtml);
    throw new ConvertError(
      "Fetch Failed",
      "WeChat returned only page controls or a title, without article content.",
      502,
    );
  }

  // Embedded article data (JSON-LD, __NEXT_DATA__, ...) lives in scripts.
  const rawHtml = finalHtml;
  finalHtml = finalHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  if (new TextEncoder().encode(finalHtml).byteLength > MAX_RESPONSE_BYTES) {
    throw new ConvertError("Content Too Large", "The page content exceeds the 5 MB size limit.", 413);
  }

  // 8. 应用 adapter 后处理
  const siteAdapter = getAdapter(targetUrl);
  if (siteAdapter.postProcess) {
    finalHtml = siteAdapter.postProcess(finalHtml);
  }

  // 8.5. Paywall 绕过：移除 paywall 元素并提取 JSON-LD 回退
  // Cleanup also removes subscription prompts inside .paywall; the REST
  // fallback below judges the page as it was before.
  const htmlBeforeCleanup = finalHtml;
  finalHtml = removePaywallElements(finalHtml, getPaywallRule(resolvedUrl));

  // 8.6. 如果内容看起来被 paywall 挡住，尝试 AMP 版本
  const htmlLooksPaywalled = looksPaywalled(finalHtml);
  if (htmlLooksPaywalled && getPaywallRule(resolvedUrl)) {
    paywallDetected = true;
    const ampUrl = extractAmpLink(finalHtml);
    if (ampUrl) {
      try {
        const ampHeaders: Record<string, string> = { Accept: "text/html" };
        applyPaywallHeaders(resolvedUrl, ampHeaders);
        const { signal: ampSignal, cleanup: ampCleanup } = createTimeoutSignal(15_000, abortSignal);
        try {
          const { response: ampResp } = await fetchWithSafeRedirects(ampUrl, {
            headers: ampHeaders,
            signal: ampSignal,
          });
          if (ampResp.ok) {
            const ampHtml = stripAmpAccessControls(await ampResp.text());
            if (!looksPaywalled(ampHtml) && ampHtml.length > finalHtml.length / 2) {
              finalHtml = ampHtml;
              fallbacks.add("amp");
            }
          }
        } finally {
          ampCleanup();
        }
      } catch {
        /* AMP 获取失败，继续使用原始内容 */
      }
    }
  }

  // 9. 转换
  throwIfAborted(abortSignal);
  await progress("convert", "Converting to Markdown");
  const conversionUrl = resolvedUrl || targetUrl;
  let { markdown, title: extractedTitle, contentHtml } = htmlToMarkdown(
    finalHtml,
    conversionUrl,
    selector,
  );
  let output: string;

  // 如果 Readability 产出极少但 JSON-LD 有更多内容，使用 JSON-LD
  const stillLooksPaywalled = looksPaywalled(finalHtml);
  if (stillLooksPaywalled) {
    paywallDetected = true;
  }
  // Pages that hide or hydrate the body with JavaScript often embed all of it
  // as data. A caller's selector targets the page markup, so it skips this.
  if (!selector) {
    const candidates = extractEmbeddedArticles(rawHtml, extractedTitle, conversionUrl);
    // An embedded copy may be a preview too, so a paywalled post's REST copy always competes.
    if (stillLooksPaywalled || looksPaywalled(htmlBeforeCleanup)) {
      const wp = await fetchWpJsonArticle(rawHtml, conversionUrl, host, extractedTitle, abortSignal);
      if (wp) candidates.push(wp);
    }
    const embedded = longerEmbeddedArticle(markdown, candidates, conversionUrl);
    if (embedded) {
      markdown = embedded.markdown;
      extractedTitle = embedded.title || extractedTitle;
      contentHtml = embedded.contentHtml;
      fallbacks.add(embedded.source);
    }
  }

  // 如果 JSON-LD 后仍然被 paywall 挡住，尝试存档源
  if (markdown.length < 500 && stillLooksPaywalled && getPaywallRule(conversionUrl)) {
    const waybackHtml = await trackProvider(env, "wayback", abortSignal, () => fetchWaybackSnapshot(conversionUrl, abortSignal), (html) => Boolean(html));
    if (waybackHtml) {
      const wbResult = htmlToMarkdown(
        removePaywallElements(waybackHtml, getPaywallRule(conversionUrl)),
        conversionUrl,
        selector,
      );
      if (wbResult.markdown.length > markdown.length) {
        markdown = wbResult.markdown;
        extractedTitle = wbResult.title || extractedTitle;
        contentHtml = wbResult.contentHtml;
        fallbacks.add("wayback_post_convert");
      }
    } else {
      console.debug("Wayback fallback unavailable", { stage: "post_convert" });
    }

    if (markdown.length < 500) {
      const archiveHtml = await trackProvider(env, "archive_today", abortSignal, () => fetchArchiveToday(conversionUrl, abortSignal), (html) => Boolean(html));
      if (archiveHtml) {
        const arResult = htmlToMarkdown(
          removePaywallElements(archiveHtml, getPaywallRule(conversionUrl)),
          conversionUrl,
          selector,
        );
        if (arResult.markdown.length > markdown.length) {
          markdown = arResult.markdown;
          extractedTitle = arResult.title || extractedTitle;
          contentHtml = arResult.contentHtml;
          fallbacks.add("archive_post_convert");
        }
      } else {
        console.debug("Archive.today fallback unavailable", { stage: "post_convert" });
      }
    }
  }

  // External provider 回退 — 基本转换产出极少时的最后手段。匿名请求不走这里。
  if (
    providerApiKeysAllowed &&
    markdown.length < 500 &&
    !browserRendered &&
    fallbacks.size === 0 &&
    finalHtml.length > 2000
  ) {
    let firecrawlFailed = false;
    try {
      const firecrawlResult = await trackProvider(env, "firecrawl", abortSignal, () => fetchViaFirecrawl(
        conversionUrl,
        getFirecrawlConfig(env, providerApiKeysAllowed),
        abortSignal,
      ));
      if (firecrawlResult.markdown.length > markdown.length) {
        markdown = firecrawlResult.markdown;
        extractedTitle = firecrawlResult.title || extractedTitle;
        method = "firecrawl";
        sourceContentType = "text/markdown";
        fallbacks.add("firecrawl_fallback");
      }
    } catch (error) {
      firecrawlFailed = true;
      console.debug("Firecrawl fallback unavailable:", errorMessage(error));
    }

    if (method !== "firecrawl") {
      try {
        const jinaResult = await trackProvider(env, "jina", abortSignal, () => fetchViaJina(conversionUrl, 15_000, abortSignal));
        if (jinaResult.markdown.length > markdown.length) {
          markdown = jinaResult.markdown;
          extractedTitle = jinaResult.title || extractedTitle;
          method = "jina";
          sourceContentType = "text/markdown";
          if (firecrawlFailed) {
            fallbacks.add("firecrawl_error_fallthrough");
          }
          fallbacks.add("jina_fallback");
        }
      } catch (error) {
        console.debug("Jina fallback unavailable:", errorMessage(error));
      }
    }
  }

  if (targetUrl.includes("mp.weixin.qq.com") && isWechatMarkdownShell(markdown, extractedTitle)) {
    throw new ConvertError(
      "Fetch Failed",
      "WeChat returned only page controls or a title, without article content.",
      502,
    );
  }

  // Only after a browser render. Static text and short real notices stay successes.
  if (browserRendered && isGovEmptyShell(targetUrl, resolvedUrl, markdown, extractedTitle)) {
    throw new ConvertError("Fetch Failed", GOV_EMPTY_SHELL_MESSAGE, 502);
  }

  if (!markdown.trim()) {
    throw new ConvertError(
      "No Content",
      "The target page was fetched, but no readable content could be extracted.",
      422,
    );
  }

  switch (format) {
    case "html":
      output = method === "jina" || method === "firecrawl"
        ? formatOutput(markdown, "html", conversionUrl, extractedTitle, method)
        : contentHtml;
      break;
    case "text":
      output = formatOutput(markdown, "text", conversionUrl, extractedTitle, method);
      break;
    case "json":
      output = formatOutput(markdown, "json", conversionUrl, extractedTitle, method);
      break;
    default:
      output = markdown;
  }

  // 9. 微信图片代理
  if (
    conversionUrl.includes("mmbiz.qpic.cn") ||
    conversionUrl.includes("mp.weixin.qq.com")
  ) {
    output = proxyImageUrls(output, host);
  }

  // 10. 缓存 — the cache is shared across tiers, so the text-only (and possibly
  // truncated) anonymous Feishu result must not be served to callers whose
  // browser path returns the full doc with images.
  if (!noCache && !fallbacks.has("feishu_ssr") && !fallbacks.has("feishu_ssr_partial")) {
    throwIfAborted(abortSignal);
    await setCache(
      env, targetUrl, format,
      { content: output, method, title: extractedTitle, sourceContentType, bodyChars: markdownBodyChars(markdown) },
      selector, undefined, engine,
    );
  }

  return {
    content: output,
    title: extractedTitle,
    method,
    tokenCount: "",
    bodyChars: markdownBodyChars(markdown),
    sourceContentType,
    cached: false,
    diagnostics: {
      cacheHit: false,
      browserRendered,
      paywallDetected,
      fallbacks: [...fallbacks],
    },
  };
}

// ─── 子函数：嵌入正文 ────────────────────────────────────────

/**
 * The embedded article whose Markdown body is clearly longer than the normal
 * conversion's, or null. The margin keeps a full Readability result (with its
 * images and structure) over a plain-text copy of similar length.
 */
function longerEmbeddedArticle(
  markdown: string,
  candidates: EmbeddedArticle[],
  url: string,
): { source: string; markdown: string; title: string; contentHtml: string } | null {
  const current = markdownBodyChars(markdown, Infinity);
  let best: { source: string; markdown: string; title: string; contentHtml: string } | null = null;
  let bestChars = Math.max(current * 1.5, current + 300);
  for (const candidate of candidates) {
    const result = htmlToMarkdown(candidate.html, url);
    const chars = markdownBodyChars(result.markdown, Infinity);
    if (chars > bestChars) {
      best = { source: candidate.source, ...result };
      bestChars = chars;
    }
  }
  return best;
}

/** Reads a paywalled WordPress post from the REST API the page links to. */
async function fetchWpJsonArticle(
  rawHtml: string,
  pageUrl: string,
  host: string,
  title: string,
  abortSignal?: AbortSignal,
): Promise<EmbeddedArticle | null> {
  const apiUrl = findWpJsonUrl(rawHtml, pageUrl);
  if (!apiUrl) return null;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": `${host}/1.0 (Markdown Converter)`,
  };
  applyPaywallHeaders(pageUrl, headers);
  const { signal, cleanup } = createTimeoutSignal(8_000, abortSignal);
  try {
    const { response } = await fetchWithSafeRedirects(apiUrl, { headers, signal });
    if (!response.ok) return null;
    const body = await readTextWithLimit(response, MAX_RESPONSE_BYTES, "WordPress REST response too large", signal);
    return wpJsonArticle(JSON.parse(body), title);
  } catch (error) {
    console.debug("WordPress REST fallback unavailable:", errorMessage(error));
    return null;
  } finally {
    cleanup();
  }
}

// ─── 子函数：浏览器渲染 ──────────────────────────────────────

// ─── 子函数：Context.dev 兜底 ────────────────────────────────

/**
 * Anonymous Context.dev calls allowed per UTC day across the whole site.
 * 25/day keeps a full month (~750) under the free tier's 1,000 credits.
 */
const CONTEXT_DEV_ANON_DAILY_LIMIT = 25;

/** Origin statuses an anonymous request may retry once through the proxy. */
const ANON_PROXY_STATUSES = [403, 429];
/** Site-wide daily cap on those retries, to protect the proxy's monthly traffic. */
const ANON_PROXY_DAILY_LIMIT = 100;
export const ANON_SIGN_IN_HINT =
  ". This site blocks automated requests. Sign in for free at https://mdget.dev/portal/?ref=blocked to use browser rendering.";

/**
 * Retries a blocked anonymous request once through the residential proxy,
 * within a site-wide daily budget. Returns null when the budget is spent or
 * the proxy also fails.
 */
async function tryAnonymousProxy(
  targetUrl: string,
  env: Env,
  fallbacks: Set<string>,
  abortSignal?: AbortSignal,
  progress?: (step: string, label: string) => void | Promise<void>,
): Promise<string | null> {
  if (!env.PROXY_POOL && !env.PROXY_URL) return null;
  const day = new Date().toISOString().slice(0, 10);
  const budget = await bumpLimit(env, `proxy-anon:${day}`, ANON_PROXY_DAILY_LIMIT, 86_400);
  if (budget.blocked) {
    fallbacks.add("proxy_anon_budget_exhausted");
    return null;
  }
  return tryDirectProxyFetch(targetUrl, env, fallbacks, abortSignal, progress);
}

/**
 * Reads a blocked Medium post from its author's or publication's RSS feed.
 * Medium answers feed reads from Cloudflare egress with 429, so a failed
 * direct read retries through the proxy (the anonymous one within its budget).
 */
async function tryMediumFeed(
  url: string,
  env: Env,
  fallbacks: Set<string>,
  abortSignal: AbortSignal | undefined,
  progress: (step: string, label: string) => void | Promise<void>,
  providerApiKeysAllowed: boolean,
): Promise<string | null> {
  const target = mediumFeedFor(url);
  if (!target) return null;
  await progress("fetch", "Reading the Medium feed");
  let xml = "";
  const { signal, cleanup } = createTimeoutSignal(8_000, abortSignal);
  try {
    const resp = await fetch(target.feedUrl, {
      headers: { "User-Agent": DESKTOP_UA, Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8" },
      signal,
    });
    if (resp.ok) xml = await resp.text();
  } catch {
    if (abortSignal?.aborted) throw new RequestAbortedError();
  } finally {
    cleanup();
  }
  if (!xml.includes("<item>")) {
    xml = (providerApiKeysAllowed
      ? await tryDirectProxyFetch(target.feedUrl, env, fallbacks, abortSignal, progress)
      : await tryAnonymousProxy(target.feedUrl, env, fallbacks, abortSignal, progress)) ?? "";
  }
  const html = mediumArticleFromFeed(xml, target.postId);
  if (html) fallbacks.add("medium_feed");
  return html;
}

/**
 * Last resort for a page our own fetch and browser could not get. Context.dev
 * renders in a real browser behind escalating proxies. Its free quota is small,
 * so callers use it only for signed-in requests and only where the request
 * would otherwise fail.
 */
async function tryContextDev(
  targetUrl: string,
  env: Env,
  fallbacks: Set<string>,
  abortSignal?: AbortSignal,
  progress?: (step: string, label: string) => void | Promise<void>,
  anonymous: boolean = false,
): Promise<string | null> {
  const apiKey = env.CONTEXT_DEV_API_KEY;
  if (!apiKey) return null;
  // Context.dev has never returned a WeChat article body, only the
  // verification page or an empty shell, so a call there only spends credits.
  if (targetUrl.includes("mp.weixin.qq.com")) return null;
  if (anonymous) {
    // One site-wide daily budget for anonymous callers, so they cannot drain
    // the monthly quota that signed-in requests rely on.
    const day = new Date().toISOString().slice(0, 10);
    const budget = await bumpLimit(env, `context-dev-anon:${day}`, CONTEXT_DEV_ANON_DAILY_LIMIT, 86_400);
    if (budget.blocked) {
      fallbacks.add("context_dev_anon_budget_exhausted");
      return null;
    }
  }
  throwIfAborted(abortSignal);
  await progress?.("fetch", "Fetching via Context.dev");
  const usable = (html: string) => html.length > 1000 && !isLikelyChallengeHtml(html);
  try {
    const result = await trackProvider(
      env, "context_dev", abortSignal,
      () => fetchViaContextDev(targetUrl, apiKey, 30_000, abortSignal),
      (r) => usable(r.html),
    );
    if (!usable(result.html)) return null;
    fallbacks.add("context_dev");
    return result.html;
  } catch (error) {
    if (abortSignal?.aborted) throw new RequestAbortedError();
    console.error("Context.dev fallback failed:", errorMessage(error));
    return null;
  }
}

async function tryBrowserRendering(
  targetUrl: string,
  env: Env,
  host: string,
  fallbacks: Set<string>,
  abortSignal?: AbortSignal,
  progress?: (step: string, label: string) => void | Promise<void>,
  sessionProfileScope?: string,
  providerApiKeysAllowed: boolean = false,
): Promise<{ html: string; rendered: boolean }> {
  const _progress = progress || (() => {});
  throwIfAborted(abortSignal);
  await _progress("browser", "Rendering with browser");
  try {
    const html = await trackProvider(env, "browser", abortSignal, () => fetchWithBrowser(
      targetUrl,
      env,
      host,
      abortSignal,
      { sessionProfileScope },
    ));
    fallbacks.add("always_browser");
    return { html, rendered: true };
  } catch (error) {
    if (abortSignal?.aborted) throw new RequestAbortedError();
    const msg = error instanceof Error ? error.message : "";
    const retryToken = extractProxyRetryToken(msg);
    const legacyCookies = extractLegacyProxyRetryCookies(msg);

    // 混合代理路径：浏览器解决了 JS 挑战但数据中心 IP 被屏蔽
    let failure: ConvertError;
    if (retryToken || legacyCookies) {
      try {
        return await tryProxyRetry(
          targetUrl, env, fallbacks, retryToken, legacyCookies, abortSignal, _progress,
        );
      } catch (proxyError) {
        if (!(proxyError instanceof ConvertError)) throw proxyError;
        failure = proxyError;
      }
    } else {
      console.error("Browser rendering failed:", errorMessage(error));
      failure = new ConvertError("Fetch Failed", "Browser rendering failed for this URL.", 502);
    }
    const rescued = providerApiKeysAllowed
      ? await tryContextDev(targetUrl, env, fallbacks, abortSignal, _progress)
      : null;
    if (rescued) return { html: rescued, rendered: true };
    throw failure;
  }
}

// ─── 子函数：代理重试 ────────────────────────────────────────

async function tryProxyRetry(
  targetUrl: string,
  env: Env,
  fallbacks: Set<string>,
  retryToken: string | null,
  legacyCookies: string | null,
  abortSignal?: AbortSignal,
  progress?: (step: string, label: string) => void | Promise<void>,
): Promise<{ html: string; rendered: boolean }> {
  const _progress = progress || (() => {});
  const pooledConfigs = env.PROXY_POOL ? parseProxyPool(env.PROXY_POOL) : [];
  const fallbackProxy = env.PROXY_URL ? parseProxyUrl(env.PROXY_URL) : null;
  if (pooledConfigs.length === 0 && fallbackProxy) {
    pooledConfigs.push(fallbackProxy);
  }
  if (pooledConfigs.length === 0) {
    throw new ConvertError(
      "Fetch Failed",
      "Site requires proxy access. Please configure PROXY_URL or PROXY_POOL.",
      502,
    );
  }
  const cookies = retryToken
    ? consumeProxyRetryCookies(retryToken)
    : legacyCookies;
  if (!cookies) {
    throw new ConvertError(
      "Fetch Failed",
      "Proxy retry cookies are unavailable. Please retry the request.",
      502,
    );
  }


  throwIfAborted(abortSignal);
  await _progress("fetch", "Retrying via proxy");
  try {
    const headerVariants = [
      {
        name: "desktop",
        headers: {
          "User-Agent": DESKTOP_UA,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Accept-Encoding": "identity",
          "Cookie": cookies,
        },
      },
      {
        name: "mobile",
        headers: {
          "User-Agent": MOBILE_UA,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Accept-Encoding": "identity",
          "Cookie": cookies,
        },
      },
    ];

    const usePool = !!(env.PROXY_POOL && pooledConfigs.length > 0);
    if (usePool) {
      const proxyResult = await trackProvider(env, "proxy_pool", abortSignal, () => fetchViaProxyPool(
        targetUrl,
        pooledConfigs,
        headerVariants,
        {
          timeoutMs: 25_000,
          signal: abortSignal,
          acceptResult: (candidate) =>
            candidate.status >= 200 &&
            candidate.status < 400 &&
            candidate.body.length > 1000 &&
            !isLikelyChallengeHtml(candidate.body),
        },
      ));
      fallbacks.add(`proxy_pool_${proxyResult.proxyIndex + 1}_${proxyResult.variant}`);
      return { html: proxyResult.body, rendered: true };
    } else {
      const proxyResult = await trackProvider(env, "proxy", abortSignal, () => fetchViaProxy(
        targetUrl,
        pooledConfigs[0],
        headerVariants[0].headers,
        25_000,
        abortSignal,
      ), (r) => r.status >= 200 && r.status < 400 && r.body.length > 1000 && !isLikelyChallengeHtml(r.body));
      if (
        proxyResult.status >= 200 &&
        proxyResult.status < 400 &&
        proxyResult.body.length > 1000 &&
        !isLikelyChallengeHtml(proxyResult.body)
      ) {
        fallbacks.add("proxy_retry");
        return { html: proxyResult.body, rendered: true };
      } else {
        throw new Error(
          `Proxy fetch returned ${proxyResult.status}, body ${proxyResult.body.length} bytes`,
        );
      }
    }
  } catch (proxyError) {
    const proxyDetail = errorMessage(proxyError);
    console.error("Proxy fetch failed:", proxyDetail);
    throw new ConvertError(
      "Fetch Failed",
      `Proxy access failed: ${proxyDetail}`,
      502,
    );
  }
}

// ─── 子函数：直接代理获取（anonymous 用户） ──────────────────

async function tryDirectProxyFetch(
  targetUrl: string,
  env: Env,
  fallbacks: Set<string>,
  abortSignal?: AbortSignal,
  progress?: (step: string, label: string) => void | Promise<void>,
): Promise<string | null> {
  const _progress = progress || (() => {});
  const pooledConfigs = env.PROXY_POOL ? parseProxyPool(env.PROXY_POOL) : [];
  const fallbackProxy = env.PROXY_URL ? parseProxyUrl(env.PROXY_URL) : null;
  if (pooledConfigs.length === 0 && fallbackProxy) {
    pooledConfigs.push(fallbackProxy);
  }
  if (pooledConfigs.length === 0) {
    return null; // No proxy configured — can't help anonymous users
  }


  throwIfAborted(abortSignal);
  await _progress("fetch", "Fetching via residential proxy");

  // Build headers matching what the adapter expects
  const isWechat = targetUrl.includes("mp.weixin.qq.com");
  const headers: Record<string, string> = {
    "User-Agent": isWechat ? WECHAT_UA : MOBILE_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
  };
  if (isWechat) {
    headers["Referer"] = "https://mp.weixin.qq.com/";
  }

  try {
    const headerVariants = [
      { name: "mobile", headers },
      {
        name: "desktop",
        headers: { ...headers, "User-Agent": DESKTOP_UA },
      },
    ];

    const proxyResult = await trackProvider(env, "proxy_pool", abortSignal, () => fetchViaProxyPool(
      targetUrl,
      pooledConfigs,
      headerVariants,
      {
        timeoutMs: 25_000,
        signal: abortSignal,
        acceptResult: (candidate) =>
          candidate.status >= 200 &&
          candidate.status < 400 &&
          candidate.body.length > 1000 &&
          !isLikelyChallengeHtml(candidate.body),
      },
    ));
    fallbacks.add(`direct_proxy_${proxyResult.variant}`);
    return proxyResult.body;
  } catch (e) {
    console.error("Direct proxy fetch failed:", errorMessage(e));
    return null;
  }
}

// ─── 子函数：静态获取 ────────────────────────────────────────

interface StaticFetchResult {
  earlyReturn?: ConvertResult;
  finalHtml: string;
  method: ConvertMethod;
  resolvedUrl: string;
  browserRendered: boolean;
  paywallDetected: boolean;
  sourceContentType: string;
}

async function tryStaticFetch(
  targetUrl: string,
  env: Env,
  host: string,
  format: OutputFormat,
  selector: string | undefined,
  forceBrowser: boolean,
  noCache: boolean,
  engine: string | undefined,
  fallbacks: Set<string>,
  browserRendered: boolean,
  paywallDetected: boolean,
  sourceContentType: string,
  resolvedUrl: string,
  method: ConvertMethod,
  progress: (step: string, label: string) => void | Promise<void>,
  abortSignal?: AbortSignal,
  browserAllowed: boolean = true,
  providerApiKeysAllowed: boolean = true,
  sessionProfileScope?: string,
): Promise<StaticFetchResult> {
  let finalHtml = "";

  throwIfAborted(abortSignal);
  await progress("fetch", "Fetching page");
  const isWechat = targetUrl.includes("mp.weixin.qq.com");
  const fetchHeaders: Record<string, string> = {
    Accept: "text/markdown, text/html;q=0.9, */*;q=0.8",
    "User-Agent": isWechat
      ? WECHAT_UA
      : `${host}/1.0 (Markdown Converter)`,
  };
  if (isWechat) {
    fetchHeaders["Accept-Language"] = "zh-CN,zh;q=0.9,en;q=0.8";
    fetchHeaders["Referer"] = "https://mp.weixin.qq.com/";
  }

  applyPaywallHeaders(targetUrl, fetchHeaders);

  let response: Response;
  let cleanupFetchSignal = () => {};
  const mainlandOnly = isLikelyMainlandOnlyHost(targetUrl);
  try {
    const { signal, cleanup } = createTimeoutSignal(
      mainlandOnly ? MAINLAND_FETCH_TIMEOUT : BROWSER_TIMEOUT,
      abortSignal,
    );
    cleanupFetchSignal = cleanup;
    const result = await fetchWithSafeRedirects(targetUrl, {
      headers: fetchHeaders,
      signal,
    });
    response = result.response;
    resolvedUrl = result.finalUrl;
  } catch (e) {
    if (abortSignal?.aborted) throw new RequestAbortedError();
    if (mainlandOnly && isTimeoutLikeError(e)) {
      throw new ConvertError("Fetch Timeout", MAINLAND_TIMEOUT_MESSAGE, 504);
    }
    throw asFetchConvertError(e);
  } finally {
    cleanupFetchSignal();
  }

  if (isWechat && isWechatVerificationUrl(resolvedUrl)) {
    throw new ConvertError(
      "Fetch Failed",
      "WeChat returned an environment verification page instead of the article content.",
      502,
    );
  }

  const staticFailed = !response.ok;

  // A Substack publication on its own domain cannot be recognised from the
  // URL, but its blocked page still carries x-served-by: Substack. The post
  // API on that domain usually answers, and the adapter retries its 429s
  // through the proxy.
  if (staticFailed && !forceBrowser && BLOCKED_STATUSES.includes(response.status)
    && response.headers.get("x-served-by") === "Substack") {
    const substackHtml = await substackAdapter.fetchDirect!(resolvedUrl, env).catch(() => null);
    if (substackHtml) {
      finalHtml = substackHtml;
      fallbacks.add("substack_api");
    }
  }

  // Medium challenges every page; its RSS feed still has recent free posts.
  // Before the paywall archives, which cost ~10s and fail for Medium.
  if (staticFailed && !forceBrowser && !finalHtml && BLOCKED_STATUSES.includes(response.status)) {
    const mediumHtml = await tryMediumFeed(resolvedUrl, env, fallbacks, abortSignal, progress, providerApiKeysAllowed);
    if (mediumHtml) finalHtml = mediumHtml;
  }

  if (staticFailed && !forceBrowser && !finalHtml) {
    if (getPaywallRule(resolvedUrl)) {
      paywallDetected = true;
      const waybackHtml = await trackProvider(env, "wayback", abortSignal, () => fetchWaybackSnapshot(resolvedUrl, abortSignal), (html) => Boolean(html));
      if (waybackHtml && waybackHtml.length > 1000) {
        finalHtml = waybackHtml;
        fallbacks.add("wayback_pre_fetch");
      } else {
        const archiveHtml = await trackProvider(env, "archive_today", abortSignal, () => fetchArchiveToday(resolvedUrl, abortSignal), (html) => Boolean(html));
        if (archiveHtml && archiveHtml.length > 1000) {
          finalHtml = archiveHtml;
          fallbacks.add("archive_pre_fetch");
        } else {
          throw originStatusError(response);
        }
      }
    } else {
      const blocked = BLOCKED_STATUSES.includes(response.status);
      let rescued: string | null = null;
      if (blocked && providerApiKeysAllowed) {
        rescued = await tryContextDev(resolvedUrl, env, fallbacks, abortSignal, progress);
      } else if (!providerApiKeysAllowed && ANON_PROXY_STATUSES.includes(response.status)) {
        rescued = await tryAnonymousProxy(resolvedUrl, env, fallbacks, abortSignal, progress);
      }
      if (!rescued) {
        const error = originStatusError(response);
        // Anonymous callers cannot use the browser; a free account can.
        if (blocked && !providerApiKeysAllowed) error.message += ANON_SIGN_IN_HINT;
        throw error;
      }
      finalHtml = rescued;
      method = "proxy+readability+turndown";
      // Context.dev renders in a browser; the proxy fetch does not.
      browserRendered = providerApiKeysAllowed;
    }
  }

  if (staticFailed && !finalHtml) {
    if (!browserAllowed) {
      throw new ConvertError(
        "Fetch Failed",
        `Could not fetch this URL with basic methods. An API key is required for browser-rendered pages. Status: ${response.status}`,
        502,
      );
    }
    // forceBrowser 为 true — 直接进入浏览器渲染
    throwIfAborted(abortSignal);
    await progress("browser", "Rendering with browser");
    try {
      finalHtml = await trackProvider(env, "browser", abortSignal, () => fetchWithBrowser(
        targetUrl,
        env,
        host,
        abortSignal,
        { sessionProfileScope },
      ));
      method = "browser+readability+turndown";
      browserRendered = true;
      fallbacks.add("browser_after_static_failure");
    } catch (error) {
      if (abortSignal?.aborted) throw new RequestAbortedError();
      console.error("Browser fallback failed:", errorMessage(error));
      const rescued = providerApiKeysAllowed
        ? await tryContextDev(targetUrl, env, fallbacks, abortSignal, progress)
        : null;
      if (!rescued) {
        throw new ConvertError(
          "Fetch Failed",
          `Static fetch returned ${response.status} and browser rendering also failed.`,
          502,
        );
      }
      finalHtml = rescued;
      method = "proxy+readability+turndown";
      browserRendered = true;
    }
  } else if (!staticFailed) {
    // Only parse the response body when the fetch actually succeeded. If the
    // origin failed (e.g. 403) but an archive snapshot was recovered above,
    // finalHtml already holds that snapshot — parsing the failed response here
    // would overwrite it and return the block page as a 200 success.
    // 4. 验证内容类型
    throwIfAborted(abortSignal);
    await progress("analyze", "Analyzing content");
    const contentType = response.headers.get("Content-Type") || "";
    sourceContentType = contentType || "text/html";
    const isTextContent = contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      contentType.includes("text/markdown") ||
      contentType.includes("text/plain");
    if (!isTextContent && !contentType.includes("text/")) {
      const externalResult = await tryExternalMarkdownEarlyReturn(
        resolvedUrl,
        env,
        format,
        selector,
        noCache,
        engine,
        fallbacks,
        abortSignal,
        providerApiKeysAllowed,
      );
      if (externalResult) {
        return {
          earlyReturn: externalResult,
          finalHtml: "",
          method: externalResult.method,
          resolvedUrl,
          browserRendered,
          paywallDetected,
          sourceContentType: externalResult.sourceContentType,
        };
      }
      throw new ConvertError(
        "Unsupported Content",
        `This URL returned non-text content (${contentType}). Only HTML and text pages can be converted to Markdown.`,
        415,
      );
    }
    if (
      contentType.includes("text/css") ||
      contentType.includes("text/javascript") ||
      contentType.includes("text/csv")
    ) {
      throw new ConvertError(
        "Unsupported Content",
        `This URL returned ${contentType} which cannot be converted to Markdown.`,
        415,
      );
    }

    // 5. 大小检查
    const contentLength = parseInt(response.headers.get("Content-Length") || "0", 10);
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new ConvertError("Content Too Large", "The target page exceeds the 5 MB size limit.", 413);
    }

    let body = "";
    try {
      body = await readTextWithLimit(
        response,
        MAX_RESPONSE_BYTES,
        "The target page exceeds the 5 MB size limit.",
        abortSignal,
      );
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        throw new ConvertError("Content Too Large", e.message, 413);
      }
      throw e;
    }

    const tokenCount = response.headers.get("x-markdown-tokens") || "";
    const isMarkdown = contentType.includes("text/markdown");
    const isWechatVerification = isWechat && isWechatVerificationHtml(body);
    if (isWechatVerification && !browserAllowed) {
      throw new ConvertError(
        "Fetch Failed",
        "WeChat returned an environment verification page instead of the article content.",
        502,
      );
    }

    // 6. 原生 markdown
    if (isMarkdown) {
      const nativeOutput = formatOutput(body, format, resolvedUrl, "", "native");

      if (!noCache) {
        throwIfAborted(abortSignal);
        await setCache(
          env, targetUrl, format,
          { content: nativeOutput, method: "native", title: "", sourceContentType, bodyChars: markdownBodyChars(body) },
          selector, undefined, engine,
        );
      }

      return {
        earlyReturn: {
          content: nativeOutput,
          title: "",
          method: "native",
          tokenCount,
          bodyChars: markdownBodyChars(body),
          sourceContentType,
          cached: false,
          diagnostics: {
            cacheHit: false,
            browserRendered,
            paywallDetected,
            fallbacks: [...fallbacks],
          },
        },
        finalHtml: "",
        method,
        resolvedUrl,
        browserRendered,
        paywallDetected,
        sourceContentType,
      };
    }

    // 7. 检查是否需要浏览器渲染
    finalHtml = body;
    if (browserAllowed && (forceBrowser || isWechatVerification || needsBrowserRendering(body, resolvedUrl))) {
      throwIfAborted(abortSignal);
      await progress("browser", "Rendering with browser");
      try {
        finalHtml = await trackProvider(env, "browser", abortSignal, () => fetchWithBrowser(
          targetUrl,
          env,
          host,
          abortSignal,
          { sessionProfileScope },
        ));
        method = "browser+readability+turndown";
        browserRendered = true;
        fallbacks.add(forceBrowser ? "browser_forced" : "browser_auto");
      } catch (e) {
        if (isWechatVerification) {
          throw new ConvertError(
            "Fetch Failed",
            "WeChat returned an environment verification page and browser rendering failed.",
            502,
          );
        }
        console.error("Browser rendering failed, using static HTML:", e instanceof Error ? e.message : e);
      }
    }
  }

  return { finalHtml, method, resolvedUrl, browserRendered, paywallDetected, sourceContentType };
}

// ─── 带指标的转换包装函数 ────────────────────────────────────

export async function convertUrlWithMetrics(
  ...args: Parameters<typeof convertUrl>
): Promise<ConvertResult> {
  const startedAt = Date.now();
  try {
    return await convertUrl(...args);
  } finally {
    recordConversionLatency(Math.max(0, Date.now() - startedAt));
  }
}
