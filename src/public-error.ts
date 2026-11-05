/**
 * What a caller is told when a conversion fails.
 *
 * Callers are often agents: they need to know whose problem a failure is (the
 * link, the site, their account, or us), whether retrying can help, and what
 * to try instead. They must not learn how we fetch pages: which providers,
 * proxies, archives, or rendering paths we tried. So the public message comes
 * from this catalog, keyed by a stable code, and never from an internal error
 * message, which stays in logs.
 */

/** Whose problem a failure is. */
export type ErrorCause = "request" | "target" | "account" | "service";

export type PublicErrorCode =
  | "invalid_request"
  | "blocked_address"
  | "auth_required"
  | "plan_required"
  | "quota_exceeded"
  | "rate_limited"
  | "target_not_found"
  | "target_gone"
  | "target_forbidden"
  | "target_blocked"
  | "target_rate_limited"
  | "target_rejected"
  | "target_error"
  | "target_unreachable"
  | "target_timeout"
  | "target_unreadable"
  | "unsupported_content"
  | "content_too_large"
  | "no_content"
  | "temporary_failure"
  | "internal_error";

export interface PublicError {
  code: PublicErrorCode;
  cause: ErrorCause;
  retryable: boolean;
  message: string;
  hint: string;
  /** The status the target site answered with, when it answered. */
  targetStatus?: number;
}

/** What a failure site knows beyond its code; every field is safe to show. */
export interface PublicErrorDetail {
  /** The target's HTTP status. */
  originStatus?: number;
  /** A curated, caller-safe sentence that replaces the catalog message. */
  publicMessage?: string;
  /** Whether the caller is anonymous (an API key would open more pages). */
  anonymous?: boolean;
}

export const SIGN_IN_URL = "https://mdget.dev/portal/?ref=blocked";
const KEY_HINT = `Requests with a free API key can read more of these pages: ${SIGN_IN_URL}`;

interface CatalogEntry {
  cause: ErrorCause;
  retryable: boolean;
  message: (status?: number) => string;
  hint: string;
}

const httpStatus = (status?: number) => (status ? ` (HTTP ${status})` : "");

const CATALOG: Record<PublicErrorCode, CatalogEntry> = {
  invalid_request: {
    cause: "request",
    retryable: false,
    message: () => "The request is not valid.",
    hint: "Fix the request as the message describes, then send it again.",
  },
  blocked_address: {
    cause: "request",
    retryable: false,
    message: () => "This URL points or redirects to a private or internal address, which cannot be fetched.",
    hint: "Use a public http(s) URL.",
  },
  auth_required: {
    cause: "account",
    retryable: false,
    message: () => "This request needs an API key.",
    hint: `Create a free API key at ${SIGN_IN_URL} and send it as "Authorization: Bearer <key>".`,
  },
  plan_required: {
    cause: "account",
    retryable: false,
    message: () => "This option needs a Pro API key.",
    hint: "Remove the option and send the request again, or upgrade to Pro at https://mdget.dev/portal/.",
  },
  quota_exceeded: {
    cause: "account",
    retryable: false,
    message: () => "The account's monthly credits are used up.",
    hint: "Upgrade the plan at https://mdget.dev/portal/, or wait for the monthly reset.",
  },
  rate_limited: {
    cause: "account",
    retryable: true,
    message: () => "Too many requests in a short time.",
    hint: "Wait for the time in the Retry-After header, then retry. Send requests one after another rather than in bursts.",
  },
  target_not_found: {
    cause: "target",
    retryable: false,
    message: (s) => `The site says there is no page at this URL${httpStatus(s)}.`,
    hint: "Check the URL for typos, truncation, or extra characters, and that the page still exists. Retrying the same URL will not help.",
  },
  target_gone: {
    cause: "target",
    retryable: false,
    message: (s) => `The site says this page was removed${httpStatus(s)}.`,
    hint: "Find another source for the same content. Retrying will not help.",
  },
  target_forbidden: {
    cause: "target",
    retryable: false,
    message: (s) => `The site refused access to this page${httpStatus(s)}.`,
    hint: "The page may need a login or subscription, or the site may refuse automated access. Try the public URL of the same content, such as the article itself rather than a share, search, or session link.",
  },
  target_blocked: {
    cause: "target",
    retryable: true,
    message: () => "The site refuses automated access to this page.",
    hint: "This restriction is set by the site. Try again later, or use another public source for the same content.",
  },
  target_rate_limited: {
    cause: "target",
    retryable: true,
    message: (s) => `The site is limiting how often it can be read${httpStatus(s)}.`,
    hint: "Wait a few minutes before reading this site again, and avoid many requests to it in a short time.",
  },
  target_rejected: {
    cause: "target",
    retryable: false,
    message: (s) => `The site rejected the request for this URL${httpStatus(s)}.`,
    hint: "Check the URL and its query parameters; the address may be incomplete or need parameters the site expects.",
  },
  target_error: {
    cause: "target",
    retryable: true,
    message: (s) => `The site's server answered with an error${httpStatus(s)}.`,
    hint: "The problem is on the site's side. Retry later.",
  },
  target_unreachable: {
    cause: "target",
    retryable: true,
    message: (s) => `The site could not be reached: its domain did not resolve, or its server did not answer${httpStatus(s)}.`,
    hint: "Check that the domain is spelled correctly and the site is online. If it is down, retry later.",
  },
  target_timeout: {
    cause: "target",
    retryable: true,
    message: () => "The site did not answer in time.",
    hint: "Retry later. If the site is slow or overloaded, this may keep failing.",
  },
  target_unreadable: {
    cause: "target",
    retryable: true,
    message: () => "The page could not be read. The site may refuse automated access, or the page failed to load.",
    hint: "Check that the URL opens the content in a browser. Retry later, or use another public source for the same content.",
  },
  unsupported_content: {
    cause: "target",
    retryable: false,
    message: () => "This URL does not return a web page. Only HTML and plain-text pages can be converted.",
    hint: "Pass the URL of the web page that shows this content, not a file, image, feed, or API endpoint.",
  },
  content_too_large: {
    cause: "target",
    retryable: false,
    message: () => "The page is larger than the 5 MB limit.",
    hint: "Use a more specific URL, such as one article or section instead of a whole archive or listing.",
  },
  no_content: {
    cause: "target",
    retryable: false,
    message: () => "The page loaded, but it has no readable text.",
    hint: "The URL may point to an empty page, a login or app shell, or a video. Check that it opens the content in a browser, or use the direct article URL.",
  },
  temporary_failure: {
    cause: "service",
    retryable: true,
    message: () => "mdget could not finish this request because of a temporary problem on our side.",
    hint: "Retry in a moment. If it keeps failing, contact support with the X-Request-ID header value.",
  },
  internal_error: {
    cause: "service",
    retryable: true,
    message: () => "mdget failed to process this URL.",
    hint: "Retry in a moment. If it keeps failing, contact support with the X-Request-ID header value.",
  },
};

export function isPublicErrorCode(value: unknown): value is PublicErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CATALOG, value);
}

/** The code for a page the target answered with this HTTP status. */
export function codeForOriginStatus(status: number): PublicErrorCode {
  if (status === 404) return "target_not_found";
  if (status === 410) return "target_gone";
  if (status === 401 || status === 403) return "target_forbidden";
  if (status === 429) return "target_rate_limited";
  // Cloudflare's origin errors (520-527, 530): the site's server or DNS is down.
  if ((status >= 520 && status <= 527) || status === 530) return "target_unreachable";
  if (status === 504) return "target_timeout";
  if (status >= 500) return "target_error";
  return "target_rejected";
}

/** The code for one of our own response statuses, when a failure site gave none. */
function codeForStatus(status: number): PublicErrorCode {
  switch (status) {
    case 400: return "invalid_request";
    case 401: return "auth_required";
    case 403: return "blocked_address";
    case 410: return "target_gone";
    case 413: return "content_too_large";
    case 415: return "unsupported_content";
    case 422: return "no_content";
    case 429: return "rate_limited";
    case 502: return "target_unreadable";
    case 504: return "target_timeout";
    default: return status >= 500 ? "internal_error" : "invalid_request";
  }
}

/** The public form of a failure: its code (or one derived from `status`) and caller-safe text. */
export function publicError(code: PublicErrorCode | undefined, status: number, detail: PublicErrorDetail = {}): PublicError {
  const resolved = code ?? (detail.originStatus !== undefined ? codeForOriginStatus(detail.originStatus) : codeForStatus(status));
  const entry = CATALOG[resolved];
  const anonymousHint = detail.anonymous &&
    (resolved === "target_blocked" || resolved === "target_forbidden" || resolved === "target_unreadable");
  return {
    code: resolved,
    cause: entry.cause,
    retryable: entry.retryable,
    message: detail.publicMessage || entry.message(detail.originStatus),
    hint: anonymousHint ? `${entry.hint} ${KEY_HINT}` : entry.hint,
    ...(detail.originStatus !== undefined ? { targetStatus: detail.originStatus } : {}),
  };
}

/** The JSON fields a public error adds to `{ error, message, status }`. */
export function publicErrorFields(error: PublicError): Record<string, unknown> {
  return {
    code: error.code,
    cause: error.cause,
    retryable: error.retryable,
    hint: error.hint,
    ...(error.targetStatus !== undefined ? { target_status: error.targetStatus } : {}),
  };
}
