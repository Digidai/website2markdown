// 核心转换逻辑

import type { ConvertMethod, Env, OutputFormat } from "../types";
import {
  MAX_RESPONSE_BYTES,
  WECHAT_UA,
  MOBILE_UA,
  DESKTOP_UA,
  BROWSER_TIMEOUT,
  CF_BLOCKED_DOMAINS_TTL,
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
import { getCached, setCache } from "../cache";
import { fetchViaJina } from "../jina";
import {
  parseProxyUrl,
  parseProxyPool,
  fetchViaProxy,
  fetchViaProxyPool,
} from "../proxy";
import {
  applyPaywallHeaders,
  extractJsonLdArticle,
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
import { formatOutput } from "../helpers/format";

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

export function isLikelyChallengeHtml(body: string): boolean {
  const lower = body.toLowerCase();
  return (
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

// ─── CF REST API helpers ─────────────────────────────────────

export function getCfRestConfig(env: Env): CfRestConfig | null {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;
  return { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN };
}

export function extractTitleFromCfMarkdown(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

export async function isCfEligible(url: string, env: Env): Promise<boolean> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return false;

  const adapter = getAdapter(url);
  if (adapter !== genericAdapter) return false;

  if (getPaywallRule(url)) return false;

  // 检查负缓存：该域名是否之前被 CF 屏蔽
  try {
    const domain = new URL(url).hostname;
    const blocked = await env.CACHE_KV.get(`cf_blocked:${domain}`);
    if (blocked) return false;
  } catch {
    // KV 失败 — 当作缓存未命中，允许 CF 尝试
  }

  return true;
}

// ─── 转换结果接口 ────────────────────────────────────────────

export interface ConvertResult {
  content: string;
  title: string;
  method: ConvertMethod;
  tokenCount: string;
  sourceContentType: string;
  cached: boolean;
  diagnostics: ConvertDiagnostics;
}

function resolveCachedSourceContentType(method: string, sourceContentType?: string): string {
  if (sourceContentType) return sourceContentType;
  if (method === "jina" || method === "native") return "text/markdown";
  return "text/html";
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
): Promise<ConvertResult> {
  const progress = onProgress || (() => {});
  throwIfAborted(abortSignal);
  const fallbacks = new Set<string>();
  let browserRendered = false;
  let paywallDetected = false;
  let sourceContentType = "text/html";

  // 1. 缓存
  if (!noCache) {
    const cached = await getCached(env, targetUrl, format, selector, engine);
    if (cached) {
      return {
        content: cached.content,
        title: cached.title || "",
        method: cached.method as ConvertMethod,
        tokenCount: "",
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

  // 2a. Jina 快速路径 — engine=jina 时跳过所有其他转换
  if (engine === "jina") {
    return tryJinaFastPath(targetUrl, env, format, selector, noCache, engine, progress, abortSignal);
  }

  // 2b. CF Markdown 快速路径
  if (engine === "cf" || ((!engine || engine === "auto") && await isCfEligible(targetUrl, env))) {
    const cfResult = await tryCfRestApi(
      targetUrl, env, format, selector, forceBrowser, noCache, engine, fallbacks, progress, abortSignal,
    );
    if (cfResult) return cfResult;
  }

  // 3. Fetch & parse
  return tryFetchAndParse(
    targetUrl, env, host, format, selector, forceBrowser, noCache, engine,
    fallbacks, browserRendered, paywallDetected, sourceContentType,
    progress, abortSignal,
  );
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
  const jinaResult = await fetchViaJina(targetUrl, 15_000, abortSignal);
  const jinaMarkdown = jinaResult.markdown;
  const jinaTitle = jinaResult.title;
  const sourceContentType = "text/markdown";

  const output = formatOutput(jinaMarkdown, format, targetUrl, jinaTitle, "jina");

  if (!noCache) {
    await setCache(
      env, targetUrl, format,
      { content: output, method: "jina", title: jinaTitle, sourceContentType },
      selector, undefined, engine,
    );
  }

  return {
    content: output,
    title: jinaTitle,
    method: "jina",
    tokenCount: "",
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
    const needsRender = forceBrowser || alwaysNeedsBrowser(targetUrl);
    const cfResult = await fetchViaCfMarkdown(targetUrl, cfConfig, {
      render: needsRender,
      signal: abortSignal,
    });

    if (cfResult.markdown && cfResult.markdown.length > 200) {
      if (new TextEncoder().encode(cfResult.markdown).byteLength > MAX_RESPONSE_BYTES) {
        throw new ConvertError("Content Too Large", "The CF response exceeds the 5 MB size limit.", 413);
      }
      const cfTitle = extractTitleFromCfMarkdown(cfResult.markdown);
      const sourceContentType = "text/markdown";

      const output = formatOutput(cfResult.markdown, format, targetUrl, cfTitle, "cf");

      if (!noCache) {
        await setCache(env, targetUrl, format, {
          content: output, method: "cf", title: cfTitle, sourceContentType,
        }, selector, undefined, engine);
      }

      return {
        content: output,
        title: cfTitle,
        method: "cf" as ConvertMethod,
        tokenCount: "",
        sourceContentType,
        cached: false,
        diagnostics: {
          cacheHit: false,
          browserRendered: needsRender,
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
    // 仅对域名级屏蔽（403）写入负缓存，不对临时错误写入
    const isDomainBlock = /returned HTTP 403/.test(errMsg);
    if (isDomainBlock) {
      const domain = new URL(targetUrl).hostname;
      await env.CACHE_KV.put(
        `cf_blocked:${domain}`, "1",
        { expirationTtl: CF_BLOCKED_DOMAINS_TTL }
      ).catch(() => {});
    }
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
): Promise<ConvertResult> {
  let finalHtml = "";
  let method: ConvertMethod = "readability+turndown";
  let resolvedUrl = targetUrl;

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
      const directHtml = await fetchAdapter.fetchDirect(targetUrl);
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
  if (!finalHtml && alwaysNeedsBrowser(targetUrl)) {
    const result = await tryBrowserRendering(
      targetUrl, env, host, fallbacks, abortSignal, progress,
    );
    finalHtml = result.html;
    if (result.rendered) {
      method = "browser+readability+turndown";
      browserRendered = true;
    }
  } else if (!finalHtml) {
    // 3. 静态获取
    const staticResult = await tryStaticFetch(
      targetUrl, env, host, format, selector, forceBrowser, noCache, engine,
      fallbacks, browserRendered, paywallDetected, sourceContentType,
      resolvedUrl, method, progress, abortSignal,
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
  finalHtml = removePaywallElements(finalHtml);

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

  const jsonLdHtml = extractJsonLdArticle(finalHtml);

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
  if (jsonLdHtml && markdown.length < 500 && stillLooksPaywalled) {
    const jsonLdResult = htmlToMarkdown(jsonLdHtml, conversionUrl, selector);
    if (jsonLdResult.markdown.length > markdown.length) {
      markdown = jsonLdResult.markdown;
      extractedTitle = jsonLdResult.title || extractedTitle;
      contentHtml = jsonLdResult.contentHtml;
      fallbacks.add("jsonld");
    }
  }

  // 如果 JSON-LD 后仍然被 paywall 挡住，尝试存档源
  if (markdown.length < 500 && stillLooksPaywalled && getPaywallRule(conversionUrl)) {
    const waybackHtml = await fetchWaybackSnapshot(conversionUrl, abortSignal);
    if (waybackHtml) {
      const wbResult = htmlToMarkdown(
        removePaywallElements(waybackHtml),
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
      console.debug("Wayback fallback unavailable", { url: targetUrl });
    }

    if (markdown.length < 500) {
      const archiveHtml = await fetchArchiveToday(conversionUrl, abortSignal);
      if (archiveHtml) {
        const arResult = htmlToMarkdown(
          removePaywallElements(archiveHtml),
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
        console.debug("Archive.today fallback unavailable", { url: targetUrl });
      }
    }
  }

  // Jina 回退 — 基本转换产出极少时的最后手段
  if (markdown.length < 500 && !browserRendered && fallbacks.size === 0 && finalHtml.length > 2000) {
    try {
      const jinaResult = await fetchViaJina(conversionUrl, 15_000, abortSignal);
      if (jinaResult.markdown.length > markdown.length) {
        markdown = jinaResult.markdown;
        extractedTitle = jinaResult.title || extractedTitle;
        method = "jina";
        sourceContentType = "text/markdown";
        fallbacks.add("jina_fallback");
      }
    } catch {
      // Jina 失败，使用现有内容继续
    }
  }

  switch (format) {
    case "html":
      output = method === "jina" ? formatOutput(markdown, "html", conversionUrl, extractedTitle, method) : contentHtml;
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
    format === "markdown" &&
    (conversionUrl.includes("mmbiz.qpic.cn") || conversionUrl.includes("mp.weixin.qq.com"))
  ) {
    output = proxyImageUrls(output, host);
  }

  // 10. 缓存
  if (!noCache) {
    throwIfAborted(abortSignal);
    await setCache(
      env, targetUrl, format,
      { content: output, method, title: extractedTitle, sourceContentType },
      selector, undefined, engine,
    );
  }

  return {
    content: output,
    title: extractedTitle,
    method,
    tokenCount: "",
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

// ─── 子函数：浏览器渲染 ──────────────────────────────────────

async function tryBrowserRendering(
  targetUrl: string,
  env: Env,
  host: string,
  fallbacks: Set<string>,
  abortSignal?: AbortSignal,
  progress?: (step: string, label: string) => void | Promise<void>,
): Promise<{ html: string; rendered: boolean }> {
  const _progress = progress || (() => {});
  throwIfAborted(abortSignal);
  await _progress("browser", "Rendering with browser");
  try {
    const html = await fetchWithBrowser(targetUrl, env, host, abortSignal);
    fallbacks.add("always_browser");
    return { html, rendered: true };
  } catch (error) {
    if (abortSignal?.aborted) throw new RequestAbortedError();
    const msg = error instanceof Error ? error.message : "";
    const retryToken = extractProxyRetryToken(msg);
    const legacyCookies = extractLegacyProxyRetryCookies(msg);

    // 混合代理路径：浏览器解决了 JS 挑战但数据中心 IP 被屏蔽
    if (retryToken || legacyCookies) {
      return tryProxyRetry(
        targetUrl, env, fallbacks, retryToken, legacyCookies, abortSignal, _progress,
      );
    } else {
      console.error("Browser rendering failed:", errorMessage(error));
      throw new ConvertError("Fetch Failed", "Browser rendering failed for this URL.", 502);
    }
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
      const proxyResult = await fetchViaProxyPool(
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
      );
      fallbacks.add(`proxy_pool_${proxyResult.proxyIndex + 1}_${proxyResult.variant}`);
      return { html: proxyResult.body, rendered: true };
    } else {
      const proxyResult = await fetchViaProxy(
        targetUrl,
        pooledConfigs[0],
        headerVariants[0].headers,
        25_000,
        abortSignal,
      );
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
  try {
    const { signal, cleanup } = createTimeoutSignal(BROWSER_TIMEOUT, abortSignal);
    cleanupFetchSignal = cleanup;
    const result = await fetchWithSafeRedirects(targetUrl, {
      headers: fetchHeaders,
      signal,
    });
    response = result.response;
    resolvedUrl = result.finalUrl;
  } catch (e) {
    if (abortSignal?.aborted) throw new RequestAbortedError();
    throw asFetchConvertError(e);
  } finally {
    cleanupFetchSignal();
  }

  const staticFailed = !response.ok;

  if (staticFailed && !forceBrowser) {
    if (getPaywallRule(resolvedUrl)) {
      paywallDetected = true;
      const waybackHtml = await fetchWaybackSnapshot(resolvedUrl, abortSignal);
      if (waybackHtml && waybackHtml.length > 1000) {
        finalHtml = waybackHtml;
        fallbacks.add("wayback_pre_fetch");
      } else {
        const archiveHtml = await fetchArchiveToday(resolvedUrl, abortSignal);
        if (archiveHtml && archiveHtml.length > 1000) {
          finalHtml = archiveHtml;
          fallbacks.add("archive_pre_fetch");
        } else {
          throw new ConvertError(
            "Fetch Failed",
            `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`,
            502,
          );
        }
      }
    } else {
      throw new ConvertError(
        "Fetch Failed",
        `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`,
        502,
      );
    }
  }

  if (staticFailed && !finalHtml) {
    // forceBrowser 为 true — 直接进入浏览器渲染
    throwIfAborted(abortSignal);
    await progress("browser", "Rendering with browser");
    try {
      finalHtml = await fetchWithBrowser(targetUrl, env, host, abortSignal);
      method = "browser+readability+turndown";
      browserRendered = true;
      fallbacks.add("browser_after_static_failure");
    } catch (error) {
      if (abortSignal?.aborted) throw new RequestAbortedError();
      console.error("Browser fallback failed:", errorMessage(error));
      throw new ConvertError(
        "Fetch Failed",
        `Static fetch returned ${response.status} and browser rendering also failed.`,
        502,
      );
    }
  } else {
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

    // 6. 原生 markdown
    if (isMarkdown) {
      const nativeOutput = formatOutput(body, format, resolvedUrl, "", "native");

      if (!noCache) {
        throwIfAborted(abortSignal);
        await setCache(
          env, targetUrl, format,
          { content: nativeOutput, method: "native", title: "", sourceContentType },
          selector, undefined, engine,
        );
      }

      return {
        earlyReturn: {
          content: nativeOutput,
          title: "",
          method: "native",
          tokenCount,
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
    if (forceBrowser || needsBrowserRendering(body, resolvedUrl)) {
      throwIfAborted(abortSignal);
      await progress("browser", "Rendering with browser");
      try {
        finalHtml = await fetchWithBrowser(targetUrl, env, host, abortSignal);
        method = "browser+readability+turndown";
        browserRendered = true;
        fallbacks.add(forceBrowser ? "browser_forced" : "browser_auto");
      } catch (e) {
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
