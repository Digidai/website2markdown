// 响应构建辅助函数

import type { ConvertMethod, OutputFormat } from "../types";
import { CORS_HEADERS } from "../config";
import { errorPageHTML } from "../templates/error";
import { renderedPageHTML } from "../templates/rendered";

export const LANDING_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src https://fonts.googleapis.com https://fonts.gstatic.com; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export const ERROR_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";

export const LOADING_CSP =
  "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; " +
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
  "font-src https://fonts.gstatic.com; connect-src 'self'; img-src * data:; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function withExtraHeaders(
  response: Response,
  headersToMerge: Record<string, string>,
): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(headersToMerge)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export class ConvertError extends Error {
  constructor(
    public readonly title: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

/** Check if the request prefers JSON error responses. */
export function wantsJsonError(request: Request): boolean {
  const accept = request.headers.get("Accept") || "";
  return (
    accept.includes("application/json") ||
    accept.includes("text/markdown")
  );
}

/**
 * Return error as JSON or HTML depending on caller.
 * `message` should be a raw string — it will be escaped in the HTML template.
 */
export function errorResponse(
  title: string,
  message: string,
  status: number,
  asJson: boolean,
): Response {
  if (asJson) {
    return Response.json(
      { error: title, message, status },
      { status, headers: CORS_HEADERS },
    );
  }
  return new Response(
    errorPageHTML(title, message, status),
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": ERROR_CSP,
        "X-Frame-Options": "DENY",
        ...CORS_HEADERS,
      },
    },
  );
}

export interface ConvertDiagnostics {
  cacheHit: boolean;
  browserRendered: boolean;
  paywallDetected: boolean;
  fallbacks: string[];
}

export function buildResponse(
  content: string,
  sourceUrl: string,
  host: string,
  method: ConvertMethod,
  format: OutputFormat,
  wantsRaw: boolean,
  tokenCount: string,
  cached: boolean,
  title: string = "",
  diagnostics?: ConvertDiagnostics,
  rawRequestPath?: string,
): Response {
  type MethodLabel = "native" | "fallback" | "browser" | "jina" | "cloudflare";
  const methodLabelMap: Record<ConvertMethod, MethodLabel> = {
    "browser+readability+turndown": "browser",
    "native": "native",
    "jina": "jina",
    "cf": "cloudflare",
    "readability+turndown": "fallback",
  };
  const methodLabel = methodLabelMap[method];

  if (wantsRaw || format === "json" || format === "text" || format === "html") {
    const contentType =
      format === "json"
        ? "application/json; charset=utf-8"
        : format === "html"
          ? "text/html; charset=utf-8"
          : format === "text"
            ? "text/plain; charset=utf-8"
            : "text/markdown; charset=utf-8";

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "X-Source-URL": sourceUrl.replace(/[\r\n]/g, ""),
        "X-Markdown-Native": method === "native" ? "true" : "false",
        "X-Markdown-Method": method,
        "X-Cache-Status": cached ? "HIT" : "MISS",
        ...(diagnostics?.fallbacks.length
          ? { "X-Markdown-Fallbacks": diagnostics.fallbacks.join(",") }
          : {}),
        ...(diagnostics?.browserRendered ? { "X-Browser-Rendered": "true" } : {}),
        ...(diagnostics?.paywallDetected ? { "X-Paywall-Detected": "true" } : {}),
        ...(tokenCount ? { "X-Markdown-Tokens": tokenCount } : {}),
        ...(format === "html"
          ? {
              "Content-Security-Policy":
                "default-src 'none'; img-src * data:; style-src 'unsafe-inline'",
              "X-Content-Type-Options": "nosniff",
            }
          : {}),
        ...CORS_HEADERS,
      },
    });
  }

  return new Response(
    renderedPageHTML(
      host,
      content,
      sourceUrl,
      tokenCount,
      methodLabel,
      cached,
      title,
      rawRequestPath,
    ),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; " +
          "style-src https://fonts.googleapis.com https://cdnjs.cloudflare.com 'unsafe-inline'; " +
          "img-src * data:; font-src https://fonts.gstatic.com; connect-src 'none'",
        "X-Frame-Options": "DENY",
        ...CORS_HEADERS,
      },
    },
  );
}
