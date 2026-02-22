/**
 * Paywall bypass module.
 *
 * Techniques:
 * 1. Googlebot UA spoofing — sites serving full content to Googlebot
 * 2. Google Referer — sites offering free access to Google search visitors
 * 3. JSON-LD articleBody extraction — full text embedded in structured data
 * 4. Paywall DOM element removal — strip overlays, modals, truncation markers
 * 5. Puppeteer JS script blocking — block paywall/metering provider scripts
 * 6. Multi-Referer (Facebook/Twitter) — WSJ, Barrons bypass
 * 7. X-Forwarded-For Googlebot IP — naively-configured sites
 * 8. AMP page fetch + attribute stripping — sites with AMP versions
 * 9. Wayback Machine / Archive.today fallback — archived content retrieval
 */

// ─── Types ───────────────────────────────────────────────────

export interface PaywallRule {
  domains: string[];
  googlebot?: boolean;
  referer?: string;
  removeSelectors?: string[];
  jsonLd?: boolean;
  xForwardedFor?: boolean;
}

export interface PaywallRuleStats {
  source: string;
  ruleCount: number;
  domainCount: number;
  updatedAt: string;
}

// ─── Googlebot UA ────────────────────────────────────────────

const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const GOOGLE_REFERER = "https://www.google.com/";
const FACEBOOK_REFERER = "https://www.facebook.com/";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ─── Paywall script domains (for Puppeteer blocking) ────────

export const PAYWALL_SCRIPT_PATTERNS: string[] = [
  // Paywall/metering providers
  "tinypass.com",
  "piano.io",
  "cdn.tinypass.com",
  // Analytics used for metering
  "cxense.com",
  "blueconic.net",
  // Site-specific meter scripts
  "meter-svc.nytimes.com",
  "mwcm.nyt.com",
  // Paywall SDKs
  "poool.fr",
  "pelcro.com",
  "tribdss.com",
  // Bloomberg fence
  "assets.bwbx.io/s3/fence",
];

/** Check if a URL matches a known paywall/metering script. */
export function isPaywallScript(url: string): boolean {
  const lower = url.toLowerCase();
  return PAYWALL_SCRIPT_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ─── Known paywalled sites ──────────────────────────────────

const DEFAULT_PAYWALL_RULES: PaywallRule[] = [
  // US News
  {
    domains: ["nytimes.com", "newyorker.com", "washingtonpost.com", "latimes.com", "chicagotribune.com", "sfchronicle.com"],
    googlebot: true,
    referer: GOOGLE_REFERER,
    jsonLd: true,
    xForwardedFor: true,
  },
  // Business / Finance — WSJ/Barrons use Facebook referer
  {
    domains: ["wsj.com", "barrons.com"],
    googlebot: true,
    referer: FACEBOOK_REFERER,
    jsonLd: true,
    xForwardedFor: true,
  },
  {
    domains: ["bloomberg.com", "ft.com", "economist.com", "hbr.org", "seekingalpha.com"],
    googlebot: true,
    referer: GOOGLE_REFERER,
    jsonLd: true,
    xForwardedFor: true,
  },
  // Tech / Science
  {
    domains: ["wired.com", "theatlantic.com", "technologyreview.com", "scientificamerican.com"],
    googlebot: true,
    referer: GOOGLE_REFERER,
    jsonLd: true,
  },
  // Medium ecosystem
  {
    domains: ["medium.com", "towardsdatascience.com", "levelup.gitconnected.com", "betterprogramming.pub"],
    referer: GOOGLE_REFERER,
    jsonLd: true,
  },
  // International
  {
    domains: ["telegraph.co.uk", "thetimes.co.uk", "lemonde.fr", "spiegel.de"],
    googlebot: true,
    referer: GOOGLE_REFERER,
    jsonLd: true,
  },
  // Chinese
  {
    domains: ["caixin.com"],
    googlebot: true,
    referer: GOOGLE_REFERER,
    jsonLd: true,
  },
];

let activeRules: PaywallRule[] = DEFAULT_PAYWALL_RULES;
let domainRuleMap = createDomainRuleMap(activeRules);
let paywallRuleStats: PaywallRuleStats = {
  source: "default",
  ruleCount: activeRules.length,
  domainCount: domainRuleMap.size,
  updatedAt: new Date().toISOString(),
};

function createDomainRuleMap(rules: PaywallRule[]): Map<string, PaywallRule> {
  const map = new Map<string, PaywallRule>();
  for (const rule of rules) {
    for (const rawDomain of rule.domains) {
      const domain = rawDomain.trim().toLowerCase();
      if (!domain) continue;
      map.set(domain, rule);
    }
  }
  return map;
}

function normalizePaywallRule(rule: Partial<PaywallRule>): PaywallRule | null {
  const domains = Array.isArray(rule.domains)
    ? rule.domains
      .filter((domain): domain is string => typeof domain === "string")
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => domain.length > 0)
    : [];
  if (domains.length === 0) return null;

  return {
    domains,
    googlebot: !!rule.googlebot,
    referer: typeof rule.referer === "string" && rule.referer.length > 0
      ? rule.referer
      : undefined,
    removeSelectors: Array.isArray(rule.removeSelectors)
      ? rule.removeSelectors.filter((selector): selector is string => typeof selector === "string")
      : undefined,
    jsonLd: !!rule.jsonLd,
    xForwardedFor: !!rule.xForwardedFor,
  };
}

function applyRuntimeRules(rules: PaywallRule[], source: string): PaywallRuleStats {
  if (rules.length === 0) {
    activeRules = DEFAULT_PAYWALL_RULES;
    domainRuleMap = createDomainRuleMap(activeRules);
    paywallRuleStats = {
      source: "default",
      ruleCount: activeRules.length,
      domainCount: domainRuleMap.size,
      updatedAt: new Date().toISOString(),
    };
    return paywallRuleStats;
  }

  activeRules = rules;
  domainRuleMap = createDomainRuleMap(activeRules);
  paywallRuleStats = {
    source,
    ruleCount: activeRules.length,
    domainCount: domainRuleMap.size,
    updatedAt: new Date().toISOString(),
  };
  return paywallRuleStats;
}

/** Configure paywall rules from typed data. Falls back to defaults on empty input. */
export function setPaywallRules(
  rules: PaywallRule[] | null | undefined,
  source: string = "runtime",
): PaywallRuleStats {
  if (!rules || rules.length === 0) {
    return applyRuntimeRules([], "default");
  }

  const normalized = rules
    .map((rule) => normalizePaywallRule(rule))
    .filter((rule): rule is PaywallRule => !!rule);
  return applyRuntimeRules(normalized, source);
}

/** Configure paywall rules from JSON string. Falls back to defaults on invalid input. */
export function setPaywallRulesFromJson(
  rulesJson: string | null | undefined,
  source: string = "runtime-json",
): PaywallRuleStats {
  if (!rulesJson || !rulesJson.trim()) {
    return applyRuntimeRules([], "default");
  }

  try {
    const parsed = JSON.parse(rulesJson) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Paywall rules JSON must be an array.");
    }
    const normalized = parsed
      .map((rule) => normalizePaywallRule(rule as Partial<PaywallRule>))
      .filter((rule): rule is PaywallRule => !!rule);
    return applyRuntimeRules(normalized, source);
  } catch (error) {
    console.warn("Invalid paywall rules JSON. Keeping existing rules.", {
      source,
      error: errorMessage(error),
    });
    return paywallRuleStats;
  }
}

/** Get metadata for currently active paywall rules. */
export function getPaywallRuleStats(): PaywallRuleStats {
  return { ...paywallRuleStats };
}

// ─── Common paywall CSS selectors ───────────────────────────

const PAYWALL_SELECTORS = [
  ".paywall",
  ".subscription-wall",
  ".premium-content-blocker",
  ".metered-content",
  "[data-paywall]",
  "[data-piano]",
  '[data-testid="paywall"]',
  ".tp-modal",
  ".tp-backdrop",
  "#piano-offer",
  "#gateway-content",
  ".subscriber-only",
  ".locked-content",
  ".truncated-content",
  ".meteredContent",
  ".paywall-overlay",
  ".subscribe-overlay",
  ".pw-overlay",
];

// ─── Paywall detection phrases ──────────────────────────────

const PAYWALL_PHRASES = [
  "subscribe to continue",
  "members only",
  "unlock this article",
  "continue reading with",
  "subscribe to read",
  "sign in to read",
  "already a subscriber",
  "become a member",
  "subscribe for full access",
  "this article is for subscribers",
  "premium article",
  "subscriber exclusive",
];

// ─── Exported functions ─────────────────────────────────────

/** Extract the registerable domain from a URL hostname. */
function extractDomain(hostname: string): string {
  // Handle cases like "www.nytimes.com" → "nytimes.com"
  const parts = hostname.replace(/\.+$/, "").split(".");
  if (parts.length <= 2) return hostname;
  // Handle two-part TLDs like .co.uk
  const last2 = parts.slice(-2).join(".");
  if (["co.uk", "com.au", "co.jp", "co.kr", "com.br", "com.cn"].includes(last2)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/** Find matching paywall rule for a URL. */
export function getPaywallRule(url: string): PaywallRule | null {
  try {
    const hostname = new URL(url).hostname;
    const domain = extractDomain(hostname);
    return domainRuleMap.get(domain) ?? null;
  } catch {
    return null;
  }
}

/** Apply Googlebot UA, Referer, and X-Forwarded-For headers for known paywalled sites. */
export function applyPaywallHeaders(
  url: string,
  headers: Record<string, string>,
): void {
  const rule = getPaywallRule(url);
  if (!rule) return;

  if (rule.googlebot) {
    headers["User-Agent"] = GOOGLEBOT_UA;
  }
  if (rule.referer) {
    headers["Referer"] = rule.referer;
  }
  if (rule.xForwardedFor) {
    headers["X-Forwarded-For"] = "66.249.66.1";
  }
}

/** JSON-LD article types we recognize. */
const ARTICLE_TYPES = new Set([
  "NewsArticle",
  "Article",
  "BlogPosting",
  "ReportageNewsArticle",
  "TechArticle",
  "ScholarlyArticle",
  "AnalysisNewsArticle",
  "OpinionNewsArticle",
  "ReviewNewsArticle",
  "Report",
  "LiveBlogPosting",
]);

/**
 * Extract article content from JSON-LD structured data.
 * Returns minimal HTML suitable for Readability, or null.
 */
export function extractJsonLdArticle(html: string): string | null {
  // Find all <script type="application/ld+json"> blocks
  const regex = /<script\s+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  const candidates: Array<{ headline: string; body: string }> = [];

  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      // Handle both single objects and arrays
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        // Also check @graph arrays (common in Yoast SEO etc.)
        const nodes = item["@graph"] ? [...item["@graph"], item] : [item];
        for (const node of nodes) {
          const nodeType = node["@type"];
          const types = Array.isArray(nodeType) ? nodeType : [nodeType];
          const isArticle = types.some((t: string) => ARTICLE_TYPES.has(t));

          if (isArticle && node.articleBody && typeof node.articleBody === "string") {
            const body = node.articleBody.trim();
            if (body.length >= 200) {
              candidates.push({
                headline: (node.headline || "").trim(),
                body,
              });
            }
          }
        }
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  if (candidates.length === 0) return null;

  // Pick the candidate with the longest body
  const best = candidates.reduce((a, b) => (a.body.length >= b.body.length ? a : b));

  // Convert plain text body to paragraphed HTML
  const paragraphs = best.body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeForHtml(p)}</p>`)
    .join("\n");

  const headlineHtml = best.headline
    ? `<h1>${escapeForHtml(best.headline)}</h1>\n`
    : "";

  return `<html><head><title>${escapeForHtml(best.headline)}</title></head><body><article>${headlineHtml}${paragraphs}</article></body></html>`;
}

/** Minimal HTML escaping for JSON-LD content insertion. */
function escapeForHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Remove common paywall overlay/modal DOM elements from HTML.
 * Also strips CSS truncation tricks on article containers.
 */
export function removePaywallElements(html: string): string {
  let result = html;

  // Remove elements matching paywall selectors
  for (const selector of PAYWALL_SELECTORS) {
    if (selector.startsWith(".")) {
      // Class-based: remove elements with this class
      const className = selector.slice(1);
      // Match opening tag with this class through its closing tag or self-closing
      const classRegex = new RegExp(
        `<([a-z][a-z0-9]*)\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
        "gi",
      );
      result = result.replace(classRegex, "");
    } else if (selector.startsWith("#")) {
      // ID-based
      const id = selector.slice(1);
      const idRegex = new RegExp(
        `<([a-z][a-z0-9]*)\\b[^>]*\\bid\\s*=\\s*["']${escapeRegex(id)}["'][^>]*>[\\s\\S]*?<\\/\\1>`,
        "gi",
      );
      result = result.replace(idRegex, "");
    } else if (selector.startsWith("[")) {
      // Attribute-based: [data-paywall], [data-testid="paywall"]
      const attrMatch = selector.match(/\[([a-z-]+)(?:="([^"]*)")?\]/i);
      if (attrMatch) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2];
        const attrPattern = attrVal
          ? `\\b${escapeRegex(attrName)}\\s*=\\s*["']${escapeRegex(attrVal)}["']`
          : `\\b${escapeRegex(attrName)}(?:\\s*=\\s*["'][^"']*["'])?`;
        const attrRegex = new RegExp(
          `<([a-z][a-z0-9]*)\\b[^>]*${attrPattern}[^>]*>[\\s\\S]*?<\\/\\1>`,
          "gi",
        );
        result = result.replace(attrRegex, "");
      }
    }
  }

  // Remove style attributes with overflow:hidden or max-height on article containers
  // This is a common CSS truncation trick
  result = result.replace(
    /(<(?:article|div)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:article[-_]?body|article[-_]?content|story[-_]?body)\b[^"']*["'][^>]*)\bstyle\s*=\s*["'][^"']*(?:overflow\s*:\s*hidden|max-height\s*:\s*\d+)[^"']*["']/gi,
    "$1",
  );

  return result;
}

/** Escape a string for use in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Heuristic: does this content look truncated/paywalled?
 *
 * Checks:
 * - Very short visible text content vs large HTML size
 * - Presence of paywall-related phrases near paywall classes
 */
export function looksPaywalled(html: string): boolean {
  // Strip tags for visible text estimation
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const htmlSize = html.length;

  // Large HTML but very little visible text → likely truncated
  if (textOnly.length < 500 && htmlSize > 10_000) {
    return true;
  }

  // Check for paywall phrases in the HTML
  const lower = html.toLowerCase();
  for (const phrase of PAYWALL_PHRASES) {
    if (lower.includes(phrase)) {
      return true;
    }
  }

  return false;
}

// ─── Wayback Machine fallback ───────────────────────────────

/**
 * Fetch an archived snapshot from the Wayback Machine.
 * Returns raw HTML if a recent snapshot is available, null otherwise.
 */
export async function fetchWaybackSnapshot(
  targetUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(targetUrl)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    let apiResp: Response;
    try {
      apiResp = await fetch(apiUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!apiResp.ok) return null;

    const data = (await apiResp.json()) as any;
    const snapshot = data?.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot?.url) return null;

    // Fetch raw content (add id_ suffix to get original HTML)
    const rawUrl = snapshot.url.replace(/\/web\/(\d+)\//, "/web/$1id_/");
    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 10_000);
    if (signal) {
      signal.addEventListener("abort", () => fetchController.abort(), { once: true });
    }
    let htmlResp: Response;
    try {
      htmlResp = await fetch(rawUrl, { signal: fetchController.signal });
    } finally {
      clearTimeout(fetchTimeout);
    }
    if (!htmlResp.ok) return null;

    const body = await htmlResp.text();
    return body.length > 1000 ? body : null;
  } catch (error) {
    console.warn("Wayback fallback failed:", { targetUrl, error: errorMessage(error) });
    return null;
  }
}

// ─── Archive.today fallback ─────────────────────────────────

/**
 * Fetch the newest archived page from Archive.today.
 * Returns HTML if an archive exists, null otherwise.
 */
export async function fetchArchiveToday(
  targetUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const archiveUrl = `https://archive.today/newest/${encodeURIComponent(targetUrl)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    let resp: Response;
    try {
      resp = await fetch(archiveUrl, {
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) return null;

    const body = await resp.text();
    return body.length > 1000 ? body : null;
  } catch (error) {
    console.warn("Archive.today fallback failed:", { targetUrl, error: errorMessage(error) });
    return null;
  }
}

// ─── AMP page extraction ────────────────────────────────────

/** Extract AMP page URL from HTML if present. */
export function extractAmpLink(html: string): string | null {
  const match = html.match(/<link\s[^>]*rel\s*=\s*["']amphtml["'][^>]*>/i);
  if (!match) return null;
  const hrefMatch = match[0].match(/href\s*=\s*["']([^"']+)["']/i);
  return hrefMatch ? hrefMatch[1] : null;
}

/** Strip AMP access control attributes that hide content behind paywalls. */
export function stripAmpAccessControls(html: string): string {
  return html
    .replace(/\s*subscriptions-section\s*=\s*["']content-not-granted["']/gi, "")
    .replace(/\s*amp-access-hide\b/gi, "")
    .replace(/\s*subscriptions-display\s*=\s*["'][^"']*["']/gi, "");
}
