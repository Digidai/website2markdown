import { CF_REST_TIMEOUT_MS } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CfRestConfig {
  accountId: string;
  apiToken: string;
  timeoutMs?: number;
}

export interface CfMarkdownResult {
  markdown: string;
  browserMsUsed?: number;
}

export interface CfCrawlJobResult {
  jobId: string;
  status: string;
  browserSecondsUsed: number;
  total: number;
  finished: number;
  records: CfCrawlRecord[];
  cursor?: number;
}

export interface CfCrawlRecord {
  url: string;
  status: string;
  markdown?: string;
  html?: string;
  metadata?: { status: number; title: string; url: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;
}

function buildSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;

  return {
    signal,
    cleanup: () => clearTimeout(timer),
  };
}

async function assertOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;

  let detail = "";
  try {
    const body = await response.text();
    detail = body.slice(0, 200);
  } catch {
    // ignore
  }

  if (response.status === 429) {
    throw new Error(`${label} rate limited (429)`);
  }
  throw new Error(
    `${label} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

function handleAbortError(error: unknown, label: string, callerSignal?: AbortSignal): never {
  if (error instanceof DOMException && error.name === "AbortError") {
    if (callerSignal?.aborted) {
      throw new Error("Request aborted");
    }
    throw new Error(`${label} timed out`);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// POST /markdown — single-page Markdown conversion
// ---------------------------------------------------------------------------

export async function fetchViaCfMarkdown(
  targetUrl: string,
  config: CfRestConfig,
  options?: {
    render?: boolean;
    waitForSelector?: string;
    userAgent?: string;
    rejectResourceTypes?: string[];
    gotoOptions?: { waitUntil?: string; timeout?: number };
    signal?: AbortSignal;
  },
): Promise<CfMarkdownResult> {
  const timeout = config.timeoutMs ?? CF_REST_TIMEOUT_MS;
  const { signal, cleanup } = buildSignal(timeout, options?.signal);

  const body: Record<string, unknown> = { url: targetUrl };
  if (options?.render !== undefined) body.render = options.render;
  if (options?.waitForSelector) body.waitForSelector = options.waitForSelector;
  if (options?.userAgent) body.userAgent = options.userAgent;
  if (options?.rejectResourceTypes) body.rejectResourceTypes = options.rejectResourceTypes;
  if (options?.gotoOptions) body.gotoOptions = options.gotoOptions;

  try {
    const response = await fetch(`${baseUrl(config.accountId)}/markdown`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    await assertOk(response, "CF /markdown");

    const json = (await response.json()) as {
      success: boolean;
      result: unknown;
    };

    if (json.success === false) {
      throw new Error("CF /markdown returned success=false");
    }
    if (typeof json.result !== "string" && json.result != null) {
      throw new Error("CF /markdown returned non-string result");
    }

    const browserMs = response.headers.get("x-browser-ms-used");

    return {
      markdown: (json.result as string) ?? "",
      browserMsUsed: browserMs ? Number(browserMs) : undefined,
    };
  } catch (error) {
    handleAbortError(error, "CF /markdown", options?.signal);
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// POST /content — get rendered HTML
// ---------------------------------------------------------------------------

export async function fetchViaCfContent(
  targetUrl: string,
  config: CfRestConfig,
  options?: {
    render?: boolean;
    waitForSelector?: string;
    signal?: AbortSignal;
  },
): Promise<string> {
  const timeout = config.timeoutMs ?? CF_REST_TIMEOUT_MS;
  const { signal, cleanup } = buildSignal(timeout, options?.signal);

  const body: Record<string, unknown> = { url: targetUrl };
  if (options?.render !== undefined) body.render = options.render;
  if (options?.waitForSelector) body.waitForSelector = options.waitForSelector;

  try {
    const response = await fetch(`${baseUrl(config.accountId)}/content`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    await assertOk(response, "CF /content");

    const json = (await response.json()) as {
      success: boolean;
      result: unknown;
    };

    if (json.success === false) {
      throw new Error("CF /content returned success=false");
    }
    if (typeof json.result !== "string" && json.result != null) {
      throw new Error("CF /content returned non-string result");
    }

    return (json.result as string) ?? "";
  } catch (error) {
    handleAbortError(error, "CF /content", options?.signal);
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// POST /crawl — submit a crawl job
// ---------------------------------------------------------------------------

export async function submitCfCrawlJob(
  seedUrl: string,
  config: CfRestConfig,
  options?: {
    limit?: number;
    depth?: number;
    formats?: string[];
    render?: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
    includeExternalLinks?: boolean;
    includeSubdomains?: boolean;
  },
): Promise<string> {
  const timeout = config.timeoutMs ?? CF_REST_TIMEOUT_MS;
  const { signal, cleanup } = buildSignal(timeout);

  const body: Record<string, unknown> = { url: seedUrl };
  if (options?.limit !== undefined) body.limit = options.limit;
  if (options?.depth !== undefined) body.depth = options.depth;
  if (options?.formats) body.formats = options.formats;
  if (options?.render !== undefined) body.render = options.render;

  const crawlOptions: Record<string, unknown> = {};
  if (options?.includePatterns) crawlOptions.includePatterns = options.includePatterns;
  if (options?.excludePatterns) crawlOptions.excludePatterns = options.excludePatterns;
  if (options?.includeExternalLinks !== undefined)
    crawlOptions.includeExternalLinks = options.includeExternalLinks;
  if (options?.includeSubdomains !== undefined)
    crawlOptions.includeSubdomains = options.includeSubdomains;
  if (Object.keys(crawlOptions).length > 0) body.options = crawlOptions;

  try {
    const response = await fetch(`${baseUrl(config.accountId)}/crawl`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    await assertOk(response, "CF /crawl POST");

    const json = (await response.json()) as { success: boolean; result: string };

    if (json.success === false || !json.result) {
      throw new Error("CF /crawl POST returned empty job ID");
    }

    return json.result;
  } catch (error) {
    handleAbortError(error, "CF /crawl POST");
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// GET /crawl/{jobId} — retrieve crawl results
// ---------------------------------------------------------------------------

export async function getCfCrawlResults(
  jobId: string,
  config: CfRestConfig,
  options?: { limit?: number; cursor?: number; status?: string },
): Promise<CfCrawlJobResult> {
  const timeout = config.timeoutMs ?? CF_REST_TIMEOUT_MS;
  const { signal, cleanup } = buildSignal(timeout);

  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.cursor !== undefined) params.set("cursor", String(options.cursor));
  if (options?.status) params.set("status", options.status);

  const qs = params.toString();
  const url = `${baseUrl(config.accountId)}/crawl/${jobId}${qs ? `?${qs}` : ""}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
      },
      signal,
    });

    await assertOk(response, "CF /crawl GET");

    const json = (await response.json()) as {
      success: boolean;
      result?: {
        id: string;
        status: string;
        browserSecondsUsed: number;
        total: number;
        finished: number;
        records: CfCrawlRecord[];
        cursor?: number;
      };
    };

    if (!json.result || json.success === false) {
      throw new Error("CF /crawl GET returned invalid response");
    }

    const r = json.result;
    return {
      jobId: r.id,
      status: r.status,
      browserSecondsUsed: r.browserSecondsUsed ?? 0,
      total: r.total ?? 0,
      finished: r.finished ?? 0,
      records: r.records ?? [],
      cursor: r.cursor,
    };
  } catch (error) {
    handleAbortError(error, "CF /crawl GET");
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// DELETE /crawl/{jobId} — cancel a crawl job
// ---------------------------------------------------------------------------

export async function cancelCfCrawlJob(
  jobId: string,
  config: CfRestConfig,
): Promise<void> {
  const timeout = config.timeoutMs ?? CF_REST_TIMEOUT_MS;
  const { signal, cleanup } = buildSignal(timeout);

  try {
    const response = await fetch(`${baseUrl(config.accountId)}/crawl/${jobId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
      },
      signal,
    });

    await assertOk(response, "CF /crawl DELETE");
  } catch (error) {
    handleAbortError(error, "CF /crawl DELETE");
  } finally {
    cleanup();
  }
}
