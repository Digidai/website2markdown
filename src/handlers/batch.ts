// 批量转换处理

import type { Env, OutputFormat } from "../types";
import {
  CORS_HEADERS,
  MAX_SELECTOR_LENGTH,
  VALID_FORMATS,
  BROWSER_CONCURRENCY,
} from "../config";
import { isSafeUrl, isValidUrl } from "../security";
import { incrementCounter, logMetric } from "../runtime-state";
import { ConvertError } from "../helpers/response";
import { timingSafeEqual } from "../middleware/auth";
import {
  convertUrlWithMetrics,
  readBodyWithLimit,
  BodyTooLargeError,
} from "./convert";

const BATCH_BODY_MAX_BYTES = 100_000;

/** Simple concurrency limiter for browser rendering tasks. */
export async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      try {
        const value = await tasks[i]();
        results[i] = { status: "fulfilled", value };
      } catch (reason: any) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}

interface BatchUrlObjectInput {
  url: string;
  format?: OutputFormat;
  selector?: string;
  force_browser?: boolean;
  no_cache?: boolean;
  engine?: string;
}

export interface BatchNormalizedItem {
  url: string;
  format: OutputFormat;
  selector?: string;
  forceBrowser: boolean;
  noCache: boolean;
  engine?: string;
}

export function normalizeBatchItem(input: unknown): BatchNormalizedItem | null {
  if (typeof input === "string") {
    const url = input.trim();
    if (!url) return null;
    return {
      url,
      format: "markdown",
      selector: undefined,
      forceBrowser: false,
      noCache: false,
    };
  }
  if (!input || typeof input !== "object") {
    return null;
  }
  const item = input as Partial<BatchUrlObjectInput>;
  if (typeof item.url !== "string") {
    return null;
  }
  const normalizedUrl = item.url.trim();
  if (!normalizedUrl) {
    return null;
  }
  const format = item.format || "markdown";
  if (!VALID_FORMATS.has(format)) {
    return null;
  }
  if (item.selector !== undefined && typeof item.selector !== "string") {
    return null;
  }
  const normalizedSelector = typeof item.selector === "string"
    ? item.selector.trim()
    : undefined;
  if (normalizedSelector && normalizedSelector.length > MAX_SELECTOR_LENGTH) {
    return null;
  }
  if (item.force_browser !== undefined && typeof item.force_browser !== "boolean") {
    return null;
  }
  if (item.no_cache !== undefined && typeof item.no_cache !== "boolean") {
    return null;
  }
  const engine = typeof item.engine === "string" ? item.engine : undefined;
  return {
    url: normalizedUrl,
    format: format as OutputFormat,
    selector: normalizedSelector || undefined,
    forceBrowser: item.force_browser === true,
    noCache: item.no_cache === true,
    engine,
  };
}

/** Handle POST /api/batch — convert multiple URLs. */
export async function handleBatch(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  incrementCounter("batchRequests");
  // Require API_TOKEN
  if (!env.API_TOKEN) {
    return Response.json(
      { error: "Service misconfigured", message: "API_TOKEN not set" },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  // Timing-safe authentication
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !(await timingSafeEqual(auth.slice(7), env.API_TOKEN))) {
    return Response.json(
      { error: "Unauthorized", message: "Valid Bearer token required" },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  // Body size limit
  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > BATCH_BODY_MAX_BYTES) {
    return Response.json(
      { error: "Request too large", message: "Maximum body size is 100 KB" },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  try {
    let bodyText = "";
    try {
      const bodyBytes = await readBodyWithLimit(
        request.body,
        BATCH_BODY_MAX_BYTES,
        "Maximum body size is 100 KB",
        request.signal,
      );
      bodyText = new TextDecoder().decode(bodyBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return Response.json(
          { error: "Request too large", message: "Maximum body size is 100 KB" },
          { status: 413, headers: CORS_HEADERS },
        );
      }
      throw error;
    }

    if (!bodyText.trim()) {
      return Response.json(
        { error: "Invalid request body", message: "Body must be valid JSON and include a 'urls' array." },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const body = JSON.parse(bodyText) as { urls?: unknown };
    if (!Array.isArray(body.urls)) {
      return Response.json(
        { error: "Request body must contain 'urls' array" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (body.urls.length > 10) {
      return Response.json(
        { error: "Maximum 10 URLs per batch" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const items = body.urls
      .map((item) => normalizeBatchItem(item))
      .filter((item): item is BatchNormalizedItem => item !== null);

    if (items.length !== body.urls.length) {
      return Response.json(
        {
          error:
            "Each batch item must be either a URL string or { url, format?, selector?, force_browser?, no_cache?, engine? }",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const tasks = items.map((item) => async () => {
      if (!isValidUrl(item.url) || !isSafeUrl(item.url)) {
        return { url: item.url, format: item.format, error: "Invalid or blocked URL" };
      }
      try {
        const result = await convertUrlWithMetrics(
          item.url,
          env,
          host,
          item.format,
          item.selector,
          item.forceBrowser,
          item.noCache,
          undefined,
          request.signal,
          item.engine,
        );
        incrementCounter("conversionsTotal");
        if (result.cached || result.diagnostics.cacheHit) incrementCounter("cacheHits");
        if (result.method === "browser+readability+turndown" || result.diagnostics.browserRendered) {
          incrementCounter("browserRenderCalls");
        }
        if (result.diagnostics.paywallDetected) incrementCounter("paywallDetections");
        if (result.diagnostics.fallbacks.length > 0) {
          incrementCounter("paywallFallbacks", result.diagnostics.fallbacks.length);
        }
        return {
          url: item.url,
          format: item.format,
          content: result.content,
          ...(item.format === "markdown" ? { markdown: result.content } : {}),
          title: result.title,
          method: result.method,
          cached: result.cached,
          fallbacks: result.diagnostics.fallbacks,
        };
      } catch (e) {
        if (e instanceof ConvertError) {
          incrementCounter("conversionFailures");
          return { url: item.url, format: item.format, error: e.message };
        }
        incrementCounter("conversionFailures");
        console.error("Batch item failed:", item.url, e instanceof Error ? e.message : e);
        return { url: item.url, format: item.format, error: "Failed to process this URL." };
      }
    });

    const results = await pLimit(tasks, BROWSER_CONCURRENCY);
    const output = results.map((r) =>
      r.status === "fulfilled" ? r.value : { error: "Processing failed" },
    );

    logMetric("batch.completed", {
      items: items.length,
      failures: output.filter((item: any) => !!item.error).length,
    });
    return Response.json({ results: output }, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error("Batch request parse failed:", error);
      return Response.json(
        { error: "Invalid request body", message: "Body must be valid JSON and include a 'urls' array." },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    console.error("Batch request processing failed:", error);
    return Response.json(
      { error: "Internal Error", message: "Failed to process batch request." },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
