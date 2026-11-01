/** Anonymous abuse gates that must not be inferred from provider or browser flags. */

export const SEARCH_PAGE_API_KEY_MESSAGE = "Search result pages require an API key.";
export const PRIVATE_ERROR_CACHE_CONTROL = "private, no-store";
export const GOV_EMPTY_SHELL_MESSAGE =
  "This government page returned a not-found or empty shell instead of the article content.";

const NEGATIVE_ORIGIN_STATUSES = new Set([429, 403, 404, 410]);

/** Origin statuses worth remembering for anonymous callers. Timeouts and 5xx are not. */
export function isNegativeOriginStatus(status: number): boolean {
  return NEGATIVE_ORIGIN_STATUSES.has(status);
}

/**
 * Exact search-result paths that anonymous callers were converting in bulk.
 * Other paths on these hosts, and lookalike hosts, stay convertible.
 */
const SEARCH_RESULT_PATHS: Record<string, readonly string[]> = {
  "www.bing.com": ["/search", "/news/search", "/images/search"],
  "searx.be": ["/search"],
  // SearXNG instance; anonymous product-search scraping here failed 100%.
  "priv.au": ["/search"],
  "html.duckduckgo.com": ["/html", "/html/"],
  "duckduckgo.com": ["/html", "/html/"],
  "search.brave.com": ["/search", "/images"],
  "www.google.com": ["/search"],
  "google.com": ["/search"],
  "yandex.com": ["/search", "/search/", "/images/search"],
  "search.yahoo.com": ["/search"],
  "www.startpage.com": ["/sp/search", "/do/search"],
  "www.baidu.com": ["/s"],
};

export function isSearchResultPage(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return SEARCH_RESULT_PATHS[url.hostname.toLowerCase()]?.includes(url.pathname) ?? false;
}

export const PROXY_SERVICE_API_KEY_MESSAGE =
  "Converting another proxy or scraping service requires an API key.";

/** Proxy and scraping services anonymous callers were chaining through us. */
const PROXY_SERVICE_HOSTS = new Set([
  "r.jina.ai",
  "proxy.cors.dev",
  "api.microlink.io",
  "httpbin.org",
  "validator.w3.org",
]);

/** Why an anonymous caller may not convert this URL, or null when it may. */
export function anonymousBlockMessage(raw: string): string | null {
  if (isSearchResultPage(raw)) return SEARCH_PAGE_API_KEY_MESSAGE;
  try {
    if (PROXY_SERVICE_HOSTS.has(new URL(raw).hostname.toLowerCase())) return PROXY_SERVICE_API_KEY_MESSAGE;
  } catch {
    return null;
  }
  return null;
}

export function isAnonymousBlockMessage(message: string): boolean {
  return message === SEARCH_PAGE_API_KEY_MESSAGE || message === PROXY_SERVICE_API_KEY_MESSAGE;
}

export function isGovCnHost(raw: string): boolean {
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "gov.cn" || host.endsWith(".gov.cn");
}

/** Soft-404 locations such as /404.htm. Article ids like /art/40412.html do not match. */
export function isGovNotFoundUrl(raw: string): boolean {
  try {
    const path = decodeURIComponent(new URL(raw).pathname).toLowerCase();
    return /(?:^|\/)404(?:\.html?)?$/.test(path)
      || /(?:^|\/)notfound(?:\.html?)?$/.test(path)
      || /(?:^|\/)not-found(?:\.html?)?$/.test(path);
  } catch {
    return false;
  }
}

const NOT_FOUND_PHRASES = [
  "您访问的页面不存在",
  "页面不存在",
  "页面未找到",
  "找不到该页面",
  "内容不存在",
  "页面已删除",
  "404 not found",
  "404错误",
];

/** Extra chrome, with whitespace removed, still allowed around a not-found phrase. */
const NOT_FOUND_CHROME_CHARS = 80;

function compactText(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * True when a not-found phrase is the page, plus a small chrome allowance.
 * A long article that only mentions the phrase stays false.
 */
export function notFoundPhraseDominates(text: string): boolean {
  const compact = compactText(text);
  if (!compact) return false;
  for (const phrase of NOT_FOUND_PHRASES) {
    const needle = compactText(phrase);
    if (!needle || !compact.includes(needle)) continue;
    const remainder = compact.split(needle).join("");
    if (remainder.length <= NOT_FOUND_CHROME_CHARS) return true;
  }
  return false;
}

/**
 * Browser-rendered gov.cn page that is a known empty shell or soft 404.
 * Length alone is not a failure: short notices and selector extracts stay valid.
 */
export function isGovEmptyShell(
  targetUrl: string,
  resolvedUrl: string,
  markdown: string,
  title = "",
): boolean {
  if (!isGovCnHost(targetUrl) && !isGovCnHost(resolvedUrl)) return false;
  if (isGovNotFoundUrl(targetUrl) || isGovNotFoundUrl(resolvedUrl)) return true;
  if (notFoundPhraseDominates(markdown)) return true;
  return notFoundPhraseDominates(title) && compactText(markdown).length <= NOT_FOUND_CHROME_CHARS;
}
