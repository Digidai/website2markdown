// 响应构建辅助函数

import type { ConvertMethod, OutputFormat } from "../types";
import { CORS_HEADERS } from "../config";
import { buildRawRequestPath } from "../security";
import { errorPageHTML, renderedPageHTML } from "@web/server";
import { publicError, publicErrorFields, type PublicError, type PublicErrorCode } from "../public-error";

// Every HTML page is server-rendered React plus the same-origin HeroUI bundle
// at /_app/* (web-dist). The only inline script is the theme boot in <head>.
const PAGE_COMMON_CSP =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
  "base-uri 'none'; frame-ancestors 'none'";

// Cloudflare Web Analytics auto-injects its beacon from static.cloudflareinsights.com
// (path /beacon.min.js/v…, so allow the host) and reports to same-origin /cdn-cgi/rum.
const PAGE_BASE_CSP =
  `${PAGE_COMMON_CSP}; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com`;

export const LANDING_CSP = `${PAGE_BASE_CSP}; img-src 'self' data:; connect-src 'self'; form-action 'self'`;

export const ERROR_CSP = `${PAGE_BASE_CSP}; img-src 'self' data:; connect-src 'self'`;

export const LOADING_CSP = `${PAGE_BASE_CSP}; img-src * data:; connect-src 'self'; form-action 'none'`;

/** Portal shows plaintext API keys in a modal: same-origin only, no third parties, so no analytics. */
export const PORTAL_CSP =
  `${PAGE_COMMON_CSP}; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'`;

export const READER_CSP = `${PAGE_BASE_CSP}; img-src * data:; connect-src 'self'`;

/** HSTS: 1 year, include subdomains, not yet preload-ready */
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

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

/** How a failure is shown to callers; see public-error.ts. */
export interface ConvertErrorPublic {
  code?: PublicErrorCode;
  /** The target's HTTP status, for the caller and to pick a code. */
  originStatus?: number;
  /** A caller-safe sentence instead of the catalog's. */
  publicMessage?: string;
}

/**
 * A conversion failure. `message` is internal: it can name providers, proxies,
 * or fallbacks, so it goes to logs only. Callers see `toPublic()`.
 */
export class ConvertError extends Error {
  constructor(
    public readonly title: string,
    message: string,
    public readonly statusCode: number,
    /** Origin HTTP status when this failure is safe to remember for anonymous retries. */
    public readonly targetStatus?: number,
    /** True when replayed from the negative cache instead of a fresh origin fetch. */
    public readonly fromCache = false,
    public readonly reason: ConvertErrorPublic = {},
  ) {
    super(message);
  }

  toPublic(anonymous = false): PublicError {
    return publicError(this.reason.code, this.statusCode, {
      // targetStatus can be a synthetic status kept for the negative cache; only originStatus is the site's.
      originStatus: this.reason.originStatus,
      publicMessage: this.reason.publicMessage,
      anonymous,
    });
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
  /** The failure's code, cause, and hint; derived from `status` when omitted. */
  reason?: PublicError | PublicErrorCode,
): Response {
  const pub = typeof reason === "object" ? reason : { ...publicError(reason, status), message };
  if (asJson) {
    return Response.json(
      { error: title, message: pub.message, status, ...publicErrorFields(pub) },
      { status, headers: CORS_HEADERS },
    );
  }
  return new Response(
    errorPageHTML(title, pub.message, status, pub.hint),
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

/** The response for a failed conversion: only its public form reaches the caller. */
export function convertErrorResponse(error: ConvertError, asJson: boolean, anonymous = false): Response {
  return errorResponse(error.title, "", error.statusCode, asJson, error.toPublic(anonymous));
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
  type MethodLabel = "native" | "fallback" | "browser" | "proxy" | "jina" | "firecrawl" | "cloudflare";
  const methodLabelMap: Record<ConvertMethod, MethodLabel> = {
    "browser+readability+turndown": "browser",
    "proxy+readability+turndown": "proxy",
    "native": "native",
    "jina": "jina",
    "firecrawl": "firecrawl",
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
        "Content-Security-Policy": READER_CSP,
        "X-Frame-Options": "DENY",
        "X-Robots-Tag": "noindex, follow",
        "Link": `<${(rawRequestPath || buildRawRequestPath(sourceUrl)).replace(/[\r\n<>]/g, "")}>; rel="alternate"; type="text/markdown"`,
        ...CORS_HEADERS,
      },
    },
  );
}
