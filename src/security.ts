import { MAX_URL_LENGTH } from "./config";

const SAFE_URL_MEMO_MAX_SIZE = 2048;
const safeUrlMemo = new Map<string, boolean>();
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const IDEMPOTENT_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "PUT",
  "DELETE",
  "TRACE",
]);
const DEFAULT_FETCH_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 80;
const DEFAULT_MAX_RETRY_DELAY_MS = 400;
const REBIND_SUFFIXES = [".nip.io", ".sslip.io", ".xip.io", ".localtest.me"];

type FetchRetryOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
};

function normalizeHostname(parsed: URL): string {
  // Strip trailing dot (FQDN notation: "localhost." bypasses exact match)
  return parsed.hostname.toLowerCase().replace(/\.$/, "");
}

function getSafeUrlMemoKey(protocol: string, hostname: string): string {
  return `${protocol}//${hostname}`;
}

function memoizeSafeUrlResult(key: string, value: boolean): void {
  if (safeUrlMemo.size >= SAFE_URL_MEMO_MAX_SIZE) {
    const oldestKey = safeUrlMemo.keys().next().value;
    if (oldestKey !== undefined) {
      safeUrlMemo.delete(oldestKey);
    }
  }
  safeUrlMemo.set(key, value);
}

function isSafeUrlForParsed(protocol: string, hostname: string): boolean {
  // Loopback
  if (
    hostname === "localhost" ||
    /^127\./.test(hostname) ||
    hostname === "[::1]" ||
    hostname === "::1"
  )
    return false;

  // Unspecified / wildcard
  if (hostname === "0.0.0.0") return false;

  // Carrier-grade NAT (100.64.0.0/10)
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname))
    return false;

  // IPv4 private ranges
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname))
    return false;

  // AWS / cloud metadata
  if (hostname === "169.254.169.254") return false;

  // Link-local IPv4
  if (/^169\.254\./.test(hostname)) return false;

  // IPv6 private / link-local (bracket-stripped)
  const bare = hostname.replace(/^\[|\]$/g, "");

  // Standard IPv6 private/link-local
  if (/^(fc|fd|fe80)/i.test(bare)) return false;

  // IPv6 loopback — all representations
  if (
    bare === "::1" ||
    bare === "0:0:0:0:0:0:0:1" ||
    bare === "0000:0000:0000:0000:0000:0000:0000:0001" ||
    /^0*:0*:0*:0*:0*:0*:0*:0*1$/.test(bare)
  )
    return false;

  // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
  // These are equivalent to the IPv4 address and bypass simple hostname checks
  const v4MappedMatch = bare.match(
    /^(?:0*:)*:?(?:ffff:?)?((?:\d{1,3}\.){3}\d{1,3})$/i,
  );
  if (v4MappedMatch) {
    const mappedIp = v4MappedMatch[1];
    // Check the embedded IPv4 against private ranges
    if (mappedIp === "127.0.0.1" || mappedIp.startsWith("127."))
      return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(mappedIp))
      return false;
    if (/^169\.254\./.test(mappedIp)) return false;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(mappedIp))
      return false;
    if (mappedIp === "0.0.0.0") return false;
  }

  // IPv4-compatible IPv6 in hex form (e.g., ::ffff:7f00:0001 = 127.0.0.1)
  const hexMappedMatch = bare.match(
    /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
  );
  if (hexMappedMatch) {
    const hi = parseInt(hexMappedMatch[1], 16);
    const lo = parseInt(hexMappedMatch[2], 16);
    const ip1 = (hi >> 8) & 0xff;
    const ip2 = hi & 0xff;
    const ip3 = (lo >> 8) & 0xff;
    const ip4 = lo & 0xff;
    const mappedIp = `${ip1}.${ip2}.${ip3}.${ip4}`;
    if (mappedIp.startsWith("127.") || mappedIp.startsWith("10."))
      return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(mappedIp)) return false;
    if (mappedIp.startsWith("192.168.") || mappedIp.startsWith("169.254."))
      return false;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(mappedIp))
      return false;
    if (mappedIp === "0.0.0.0") return false;
  }

  // IPv4-compatible IPv6 WITHOUT ffff (e.g., ::7f00:1 from ::127.0.0.1)
  // Deprecated but still parsed by URL implementations
  const hexCompatMatch = bare.match(
    /^(?:0*:)*:?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
  );
  if (hexCompatMatch && !hexMappedMatch) {
    const hi = parseInt(hexCompatMatch[1], 16);
    const lo = parseInt(hexCompatMatch[2], 16);
    const ip1 = (hi >> 8) & 0xff;
    const ip2 = hi & 0xff;
    const ip3 = (lo >> 8) & 0xff;
    const ip4 = lo & 0xff;
    const mappedIp = `${ip1}.${ip2}.${ip3}.${ip4}`;
    if (mappedIp.startsWith("127.") || mappedIp.startsWith("10."))
      return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(mappedIp)) return false;
    if (mappedIp.startsWith("192.168.") || mappedIp.startsWith("169.254."))
      return false;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(mappedIp))
      return false;
    if (mappedIp === "0.0.0.0") return false;
  }

  // Internal / local TLDs
  if (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid")
  )
    return false;

  // Must be HTTP(S)
  if (protocol !== "http:" && protocol !== "https:")
    return false;

  // Decimal integer IP (e.g., 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(hostname)) return false;

  // Hex IP (e.g., 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(hostname)) return false;

  // DNS rebinding services that resolve to arbitrary IPs
  for (const d of REBIND_SUFFIXES) {
    if (hostname.endsWith(d)) return false;
  }

  return true;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isIdempotentRequest(init: RequestInit): boolean {
  const method = (init.method ?? "GET").toUpperCase();
  return IDEMPOTENT_METHODS.has(method);
}

function normalizeRetryOptions(
  retryOptions?: FetchRetryOptions,
): Required<FetchRetryOptions> {
  return {
    maxRetries: Math.max(0, retryOptions?.maxRetries ?? DEFAULT_FETCH_RETRIES),
    retryDelayMs: Math.max(
      0,
      retryOptions?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    ),
    maxRetryDelayMs: Math.max(
      0,
      retryOptions?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
    ),
  };
}

function waitMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(
  attempt: number,
  retryDelayMs: number,
  maxRetryDelayMs: number,
): number {
  return Math.min(retryDelayMs * 2 ** attempt, maxRetryDelayMs);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct.toUpperCase();
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") return causeCode.toUpperCase();
  }
  return "";
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "target host";
  }
}

function normalizeFetchFailure(error: unknown, requestUrl: string): Error {
  if (
    error instanceof Error &&
    error.message.includes("Redirect target blocked by SSRF protection")
  ) {
    return error;
  }

  const code = errorCode(error);
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  const host = hostnameOf(requestUrl);

  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    lower.includes("enotfound") ||
    lower.includes("eai_again") ||
    lower.includes("dns") ||
    lower.includes("could not resolve host") ||
    lower.includes("name or service not known")
  ) {
    return new Error(`DNS resolution failed for ${host}.`);
  }

  if (
    code === "ECONNRESET" ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up") ||
    lower.includes("connection reset") ||
    lower.includes("network reset")
  ) {
    return new Error("Connection reset while fetching the target URL.");
  }

  if (
    code === "ETIMEDOUT" ||
    lower.includes("etimedout") ||
    lower.includes("timed out") ||
    lower.includes("timeout")
  ) {
    return new Error("Request timed out while fetching the target URL.");
  }

  return error instanceof Error ? error : new Error(message);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retryable: boolean,
  retryOptions: Required<FetchRetryOptions>,
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
      });

      if (
        !retryable ||
        !isRetryableStatus(response.status) ||
        attempt === retryOptions.maxRetries
      ) {
        return response;
      }
    } catch (error) {
      const normalizedError = normalizeFetchFailure(error, url);
      lastError = normalizedError;

      // Abort errors should not be retried
      const aborted =
        init.signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError");

      if (aborted || !retryable || attempt === retryOptions.maxRetries) {
        throw normalizedError;
      }
    }

    const delay = getRetryDelayMs(
      attempt,
      retryOptions.retryDelayMs,
      retryOptions.maxRetryDelayMs,
    );
    await waitMs(delay);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("No response received");
}

/**
 * Validate that a URL is safe to fetch (no SSRF).
 * Blocks localhost, private/internal IPs (v4 + v6 + mapped), link-local, AWS metadata.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = normalizeHostname(parsed);
    const cacheKey = getSafeUrlMemoKey(parsed.protocol, hostname);
    const cached = safeUrlMemo.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = isSafeUrlForParsed(parsed.protocol, hostname);
    memoizeSafeUrlResult(cacheKey, result);
    return result;
  } catch {
    return false;
  }
}

/** Check that the URL is valid HTTP(S). */
export function isValidUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Detect if a static-fetch HTML response is an anti-bot / JS-challenge page
 * that needs browser rendering to get real content.
 */
export function needsBrowserRendering(html: string, _url: string): boolean {
  const lower = html.toLowerCase();

  // Cloudflare JS challenge
  if (lower.includes("cf-challenge") || lower.includes("cf_chl_opt"))
    return true;

  // Generic CAPTCHA on short pages
  if (lower.includes("captcha") && html.length < 10_000) return true;

  // Very short page with JS redirect (likely anti-bot).
  // Only flag truly minimal pages — real content pages are longer than this.
  if (
    html.length < 2000 &&
    (lower.includes("document.location") ||
      lower.includes("window.location"))
  ) {
    // If the page has substantial visible text content, it's probably real
    const textOnly = html.replace(/<[^>]+>/g, "").trim();
    if (textOnly.length < 200) return true;
  }

  return false;
}

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/**
 * Fetch a URL following redirects manually, validating each hop for SSRF.
 * Returns the final response or throws on failure.
 */
export async function fetchWithSafeRedirects(
  url: string,
  init: RequestInit,
  maxHops: number = 5,
  retryOptions?: FetchRetryOptions,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = url;
  let response: Response | null = null;
  const retryable = isIdempotentRequest(init);
  const normalizedRetryOptions = normalizeRetryOptions(retryOptions);

  for (let hops = 0; hops <= maxHops; hops++) {
    try {
      response = await fetchWithRetry(
        currentUrl,
        init,
        retryable,
        normalizedRetryOptions,
      );
    } catch (error) {
      throw normalizeFetchFailure(error, currentUrl);
    }

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      break;
    }

    const location = response.headers.get("Location");
    if (!location) break;

    const nextUrl = new URL(location, currentUrl).href;
    if (!isSafeUrl(nextUrl)) {
      throw new Error("Redirect target blocked by SSRF protection");
    }
    currentUrl = nextUrl;
  }

  if (!response) {
    throw new Error("No response received");
  }

  return { response, finalUrl: currentUrl };
}

/**
 * Extract target URL from request path.
 * Handles bare domains, http/https prefixed, and strips our own query params.
 */
export function extractTargetUrl(
  path: string,
  search: string,
): string | null {
  let raw = path.slice(1); // Remove leading slash
  if (!raw) return null;

  // Decode percent-encoded URLs (e.g., /https%3A%2F%2Fexample.com)
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
      raw = decoded;
    }
  } catch {
    // Keep raw as-is if decoding fails
  }

  // Auto-prepend https:// for bare domains
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    if (raw.includes(".") && !raw.startsWith(".")) {
      raw = "https://" + raw;
    } else {
      return null;
    }
  }

  // Re-attach query string (excluding our params)
  const targetSearchParams = new URLSearchParams(search);
  targetSearchParams.delete("raw");
  targetSearchParams.delete("force_browser");
  targetSearchParams.delete("no_cache");
  targetSearchParams.delete("format");
  targetSearchParams.delete("selector");
  const remainingSearch = targetSearchParams.toString();

  if (remainingSearch) {
    raw += (raw.includes("?") ? "&" : "?") + remainingSearch;
  }

  // Length check
  if (raw.length > MAX_URL_LENGTH) return null;

  return raw;
}

/** Build a stable raw markdown request path for a target URL. */
export function buildRawRequestPath(targetUrl: string): string {
  return `/${encodeURIComponent(targetUrl)}?raw=true`;
}
