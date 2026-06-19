const FIRECRAWL_DEFAULT_API_URL = "https://api.firecrawl.dev";
const FIRECRAWL_DEFAULT_TIMEOUT_MS = 20_000;
const FIRECRAWL_ORIGIN = "md-genedai@1.0.0";

export interface FirecrawlConfig {
  apiKey?: string;
  apiUrl?: string;
  timeoutMs?: number;
  origin?: string;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    title?: string;
    metadata?: {
      title?: string;
      sourceURL?: string;
      url?: string;
      statusCode?: number;
      error?: string;
    };
  };
  error?: string;
}

function normalizeApiUrl(apiUrl?: string): string {
  const raw = (apiUrl || FIRECRAWL_DEFAULT_API_URL).trim();
  return raw.replace(/\/+$/, "") || FIRECRAWL_DEFAULT_API_URL;
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

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * Fetch a URL's content as Markdown via Firecrawl v2 scrape.
 *
 * When `apiKey` is omitted, this intentionally sends no Authorization header
 * so Firecrawl can use its keyless free tier when the upstream accepts it.
 */
export async function fetchViaFirecrawl(
  targetUrl: string,
  config: FirecrawlConfig = {},
  signal?: AbortSignal,
): Promise<{ markdown: string; title: string }> {
  const timeoutMs = config.timeoutMs ?? FIRECRAWL_DEFAULT_TIMEOUT_MS;
  const { signal: requestSignal, cleanup } = buildSignal(timeoutMs, signal);
  const apiUrl = normalizeApiUrl(config.apiUrl);
  const apiKey = config.apiKey?.trim();

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(`${apiUrl}/v2/scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: targetUrl,
        formats: ["markdown"],
        onlyMainContent: true,
        onlyCleanContent: false,
        removeBase64Images: true,
        blockAds: true,
        timeout: timeoutMs,
        origin: config.origin || FIRECRAWL_ORIGIN,
      }),
      signal: requestSignal,
    });

    if (response.status === 429) {
      throw new Error("Firecrawl rate limited (429)");
    }
    if (response.status === 402) {
      throw new Error("Firecrawl credits exhausted (402)");
    }
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(
        `Firecrawl returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    let json: FirecrawlScrapeResponse;
    try {
      json = (await response.json()) as FirecrawlScrapeResponse;
    } catch {
      throw new Error("Firecrawl returned invalid JSON");
    }

    if (json.success === false) {
      throw new Error(json.error || "Firecrawl returned success=false");
    }

    const markdown = json.data?.markdown || "";
    if (!markdown.trim()) {
      throw new Error("Firecrawl returned empty markdown");
    }

    return {
      markdown,
      title: json.data?.metadata?.title || json.data?.title || "",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (signal?.aborted) {
        throw new Error("Request aborted");
      }
      throw new Error("Firecrawl timed out");
    }
    throw error;
  } finally {
    cleanup();
  }
}
