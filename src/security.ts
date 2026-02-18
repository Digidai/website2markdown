import { MAX_URL_LENGTH } from "./config";

/**
 * Validate that a URL is safe to fetch (no SSRF).
 * Blocks localhost, private/internal IPs (v4 + v6 + mapped), link-local, AWS metadata.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Strip trailing dot (FQDN notation: "localhost." bypasses exact match)
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

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
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return false;

    return true;
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
 * Extract target URL from request path.
 * Handles bare domains, http/https prefixed, and strips our own query params.
 */
export function extractTargetUrl(
  path: string,
  search: string,
): string | null {
  let raw = path.slice(1); // Remove leading slash
  if (!raw) return null;

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

  if (remainingSearch && !raw.includes("?")) {
    raw += "?" + remainingSearch;
  }

  // Length check
  if (raw.length > MAX_URL_LENGTH) return null;

  return raw;
}
