/**
 * Core conversion logic for the MCP server.
 * Separated from index.ts for testability.
 */

export interface ConvertOptions {
  url: string;
  format?: "markdown" | "html" | "text" | "json";
  selector?: string;
  force_browser?: boolean;
  apiUrl?: string;
  apiToken?: string;
}

export interface ConvertResult {
  [key: string]: unknown;
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

/**
 * Build the full API URL for the conversion request.
 */
export function buildApiUrl(options: ConvertOptions): string {
  const base = options.apiUrl || "https://md.genedai.me";
  const params = new URLSearchParams({ format: options.format ?? "markdown" });
  if (options.selector) params.set("selector", options.selector);
  if (options.force_browser) params.set("force_browser", "true");
  return `${base}/${encodeURIComponent(options.url)}?${params}`;
}

/**
 * Build the request headers.
 */
export function buildHeaders(apiToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/markdown",
  };
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }
  return headers;
}

/**
 * Convert a URL to markdown by calling the hosted API.
 */
export async function convertUrl(options: ConvertOptions): Promise<ConvertResult> {
  const apiUrl = buildApiUrl(options);
  const headers = buildHeaders(options.apiToken);

  try {
    const response = await fetch(apiUrl, {
      headers,
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error ${response.status}: ${errorText}` }],
      };
    }

    const contentLength = parseInt(response.headers?.get("Content-Length") || "0", 10);
    if (contentLength > 10_000_000) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "Response too large (>10MB)" }],
      };
    }
    const markdown = await response.text();
    if (markdown.length > 10_000_000) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "Response too large (>10MB)" }],
      };
    }
    return {
      content: [{ type: "text" as const, text: markdown }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Failed to convert URL: ${message}` }],
    };
  }
}
