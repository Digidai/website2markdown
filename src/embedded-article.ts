/**
 * Article text that a page ships as data rather than markup: JSON-LD
 * articleBody, Next.js __NEXT_DATA__, Arc XP Fusion.globalContent, other
 * window.__*_STATE__ blobs, and the WordPress REST API. Sites that hide or
 * hydrate the body with JavaScript often still embed all of it here.
 */

import { extractJsonLdArticle } from "./paywall";

export type EmbeddedSource = "jsonld" | "next_data" | "fusion" | "page_state" | "wp_json";

export interface EmbeddedArticle {
  source: EmbeddedSource;
  /** A minimal HTML page for htmlToMarkdown. */
  html: string;
}

/** Text shorter than this is a teaser or metadata, not an article body. */
const MIN_TEXT_CHARS = 500;
/** Bounds the walk over large page-state blobs. */
const MAX_WALK_NODES = 200_000;

/**
 * A tag. `[^<>]` rather than `[^>]` keeps every scan linear: an unclosed `<`
 * stops at the next `<` instead of rescanning the rest of the string.
 */
const TAG = /<[^<>]*>/g;

function stripTags(html: string): string {
  return html.replace(TAG, "");
}

/** Non-whitespace characters of text, the same measure as markdownBodyChars. */
export function htmlTextChars(html: string): number {
  return stripTags(html).replace(/\s+/g, "").length;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapArticle(title: string, body: string): string {
  // Titles are text that may hold entities (WordPress "&#8217;"), so only tags are escaped.
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<html><head><title>${safeTitle}</title></head><body><article>${body}</article></body></html>`;
}

/** Drops the document wrapper some CMSs leave around a stored body. */
function stripDocumentTags(html: string): string {
  return html.replace(/<!DOCTYPE[^<>]*>|<\/?(?:html|head|body)\b[^<>]*>/gi, "");
}

/**
 * Reads the JSON object that starts at `start`, honouring strings, so a page
 * script like `X = {...};` parses without the trailing code.
 */
function readJsonObject(text: string, start: number): unknown {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Longest opening tag nextDataStart() looks at. */
const MAX_TAG_CHARS = 1000;

/**
 * Where the `<script id="__NEXT_DATA__">` body starts, or -1. Each mention is
 * checked within a bounded window, so repeated unclosed tags stay linear.
 */
function nextDataStart(html: string): number {
  for (let at = html.indexOf("__NEXT_DATA__"); at >= 0; at = html.indexOf("__NEXT_DATA__", at + 1)) {
    // Search only the window around the mention, in both directions.
    const windowStart = Math.max(0, at - MAX_TAG_CHARS);
    const before = html.slice(windowStart, at).lastIndexOf("<");
    const after = html.slice(at, at + MAX_TAG_CHARS).indexOf(">");
    if (before < 0 || after < 0) continue;
    const open = windowStart + before;
    const close = at + after;
    if (/^<script\b[^<>]*\bid\s*=\s*["']__NEXT_DATA__["'][^<>]*>$/i.test(html.slice(open, close + 1))) return close + 1;
  }
  return -1;
}

function readAssignedJson(html: string, marker: RegExp): unknown {
  const match = marker.exec(html);
  return match ? readJsonObject(html, match.index + match[0].length) : null;
}

/** What identifies the requested article among the records in page state. */
interface ArticleIdentity {
  /** The page URL as articleUrl() normalises it. */
  url: string;
  pageUrl: string;
  /** The path's last segment, case kept; short ones only rule records out. */
  slug: string;
  title: string;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Query parameters that track a visit rather than choose an article. */
const TRACKING_PARAM = /^(?:utm_\w+|fbclid|gclid|mc_[ce]id|ref|source|cmpid|smid)$/i;

/**
 * A URL or path, resolved against the page, as host (without www.), path,
 * and query without tracking parameters, or null. Only the host is
 * lowercased: paths and query values may tell articles apart by case
 * (`?id=AbCd`), and `/view.aspx?id=1` and `?id=2` are different articles.
 */
function articleUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    const params = [...url.searchParams].filter(([name]) => !TRACKING_PARAM.test(name));
    const query = params.length > 0 ? `?${new URLSearchParams(params.sort()).toString()}` : "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${decodeURIComponent(url.pathname).replace(/\/+$/, "")}${query}`;
  } catch {
    return null;
  }
}

function articleIdentity(pageUrl: string, title: string): ArticleIdentity {
  let path = "";
  let hasQuery = false;
  try {
    const parsed = new URL(pageUrl);
    path = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
    hasQuery = [...parsed.searchParams.keys()].some((name) => !TRACKING_PARAM.test(name));
  } catch {
    /* keep empty */
  }
  return {
    url: path.length > 1 || hasQuery ? articleUrl(pageUrl, pageUrl) ?? "" : "",
    pageUrl,
    slug: hasQuery ? "" : path.split("/").pop() ?? "",
    title: normalizeText(title),
  };
}

/** Titles shorter than this rule a record out only when they cannot abbreviate the page title. */
const MIN_COMPARABLE_TITLE = 12;

/** Keys whose value says which article a record is. */
const IDENTITY_KEY = /^(?:url|canonical_?url|path|slug|permalink|link|headline|title)$/i;
/** Keys that say which page a record is when they hold a URL (JSON-LD `@id`, `mainEntityOfPage`). */
const PAGE_REF_KEY = /^(?:@?id|mainentityofpage)$/i;
/** Keys that hold an address, absolute or relative to the page (`other-vote`). */
const ADDRESS_KEY = /^(?:url|canonical_?url|path|permalink|link)$/i;
const URL_LIKE = /^(?:https?:)?\/\/|^\//i;
/** Bare slugs this long are specific enough to name the page by themselves. */
const MIN_NAMING_SLUG = 8;

/**
 * Whether a record names the requested article: true if it names the page,
 * false if it names something else, null if it says nothing about which
 * article it is. A URL decides over a title, so a prefetched article with
 * the same headline ("Live election updates") but another URL is not taken.
 */
function recordNamesArticle(record: object, id: ArticleIdentity): boolean | null {
  let namesOtherUrl = false;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string" || value.length > 2000 || /\s/.test(value)) continue;
    const isAddress = ADDRESS_KEY.test(key) || (PAGE_REF_KEY.test(key) && URL_LIKE.test(value));
    if (!isAddress || !value) continue;
    if (id.url && articleUrl(value, id.pageUrl) === id.url) return true;
    namesOtherUrl = true;
  }
  if (namesOtherUrl) return false;
  // A bare slug decides over a title the same way; a short one can only rule out.
  const slug = (record as Record<string, unknown>).slug;
  if (id.slug && typeof slug === "string" && slug && !URL_LIKE.test(slug)) {
    if (slug !== id.slug) return false;
    if (slug.length >= MIN_NAMING_SLUG) return true;
  }
  if (namesArticle(record, id)) return true;
  const hasIdentity = Object.entries(record).some(([key, value]) => {
    if (typeof value !== "string" || !IDENTITY_KEY.test(key)) return false;
    if (/^(?:headline|title)$/i.test(key)) {
      if (!id.title) return false;
      const text = normalizeText(value);
      // A short title the page title starts with may abbreviate it ("AI" for "AI news"); any other names another article.
      return text.length >= MIN_COMPARABLE_TITLE || !id.title.startsWith(text);
    }
    return true;
  });
  return hasIdentity ? false : null;
}

/**
 * Whole-value matches only: a URL or path must be the page's whole URL, and
 * only a bare value is compared with the slug, so `/harbour-vote` claims
 * neither `/harbour-vote-delayed` nor `/2025/sports/harbour-vote`.
 */
function namesArticle(record: object, id: ArticleIdentity): boolean {
  for (const value of Object.values(record)) {
    if (typeof value !== "string" || value.length > 2000) continue;
    if (URL_LIKE.test(value)) {
      if (id.url && articleUrl(value, id.pageUrl) === id.url) return true;
    } else if (id.slug.length >= MIN_NAMING_SLUG && value === id.slug) {
      return true;
    }
    if (id.title) {
      // The page title may add a site name after a separator ("Headline | Site").
      const text = normalizeText(value);
      if (text.length >= 3 && (text === id.title ||
        (id.title.startsWith(text) && /^\s*[|\-–—:·•_]/.test(id.title.slice(text.length))))) return true;
    }
  }
  return false;
}

/** Keys whose string can be the article body; site-wide HTML (privacyPolicyHtml, footerHtml) is not. */
const BODY_KEY = /^(?:body|content|html|text|rendered|article_?body|body_?html|content_?html|story_?body|full_?text)$/i;

/** Branches of page state that hold other text than the article body. */
const NON_BODY_KEY = /^(?:comments?|replies|responses|discussion|related\w*|recommend\w*|more\w*|popular\w*|trending\w*|most\w*|next\w*|previous\w*|sidebar|footer|nav\w*|ads?)$/i;

/**
 * The longest article HTML string (one with paragraphs) in `data` that belongs
 * to the requested article, so a longer prefetched or related article
 * cannot replace it.
 */
function longestArticleHtml(data: unknown, id: ArticleIdentity): string | null {
  let best: string | null = null;
  let bestChars = MIN_TEXT_CHARS - 1;
  // A string belongs when a record enclosing it, at any depth, names the page
  // and none names another article. A record naming another article prunes
  // its whole subtree: a prefetched {url: old, content: {data: {headline:
  // same}}} by its URL, a related story under the page by its headline.
  // Each entry carries whether an enclosing record named the page, and the key
  // it sits under (array items take their array's key). Only strings and
  // containers are queued, and the budget is spent when queuing, so a huge
  // array cannot allocate a stack entry per element.
  const stack: Array<[unknown, boolean, string]> = [[data, false, ""]];
  let budget = MAX_WALK_NODES;
  const queue = (value: unknown, named: boolean, key: string) => {
    if (budget > 0 && (typeof value === "string" || (value !== null && typeof value === "object"))) {
      budget--;
      stack.push([value, named, key]);
    }
  };
  while (stack.length > 0) {
    const [node, named, nodeKey] = stack.pop()!;
    if (typeof node === "string") {
      if (named && node.length > bestChars && BODY_KEY.test(nodeKey) && /<p[\s>]/i.test(node)) {
        const chars = htmlTextChars(node);
        if (chars > bestChars) {
          best = node;
          bestChars = chars;
        }
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        if (budget <= 0) break;
        queue(item, named, nodeKey);
      }
    } else if (node && typeof node === "object") {
      const verdict = recordNamesArticle(node, id);
      if (verdict === false) continue;
      for (const key in node) {
        if (budget <= 0) break;
        if (NON_BODY_KEY.test(key)) continue;
        queue((node as Record<string, unknown>)[key], named || verdict === true, key);
      }
    }
  }
  return best;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Renders Arc XP ANS content_elements (Washington Post, Globe and Mail, ...). */
function renderArcElements(elements: unknown, depth = 0): string {
  if (!Array.isArray(elements) || depth > 3) return "";
  const parts: string[] = [];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const e = el as Record<string, unknown>;
    switch (e.type) {
      case "text":
        if (str(e.content)) parts.push(`<p>${str(e.content)}</p>`);
        break;
      case "header": {
        const level = Math.min(6, Math.max(2, Number(e.level) || 2));
        if (str(e.content)) parts.push(`<h${level}>${str(e.content)}</h${level}>`);
        break;
      }
      case "list": {
        const tag = e.list_type === "ordered" ? "ol" : "ul";
        const items = Array.isArray(e.items)
          ? e.items.map((item) => str((item as Record<string, unknown>)?.content)).filter(Boolean)
          : [];
        if (items.length > 0) parts.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
        break;
      }
      case "image": {
        const url = str(e.url);
        if (/^https?:\/\//i.test(url)) {
          const caption = str(e.caption);
          parts.push(
            `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(stripTags(caption))}">` +
              (caption ? `<figcaption>${caption}</figcaption>` : "") +
              "</figure>",
          );
        }
        break;
      }
      case "quote":
        parts.push(`<blockquote>${renderArcElements(e.content_elements, depth + 1)}</blockquote>`);
        break;
    }
  }
  return parts.join("\n");
}

/**
 * Every article body embedded in the raw page HTML (scripts intact) of
 * `pageUrl`. `title` is the page title from the normal conversion; it heads
 * each candidate and helps pick the requested article out of page state.
 */
export function extractEmbeddedArticles(rawHtml: string, title: string, pageUrl: string): EmbeddedArticle[] {
  const found: EmbeddedArticle[] = [];
  const id = articleIdentity(pageUrl, title);

  const jsonLd = extractJsonLdArticle(rawHtml, (node) => {
    const page = node.mainEntityOfPage;
    return recordNamesArticle({
      url: node.url,
      id: node["@id"],
      mainEntityOfPage: typeof page === "object" && page ? (page as Record<string, unknown>)["@id"] : page,
      headline: node.headline,
    }, id);
  });
  if (jsonLd) found.push({ source: "jsonld", html: jsonLd });

  const fusion = readAssignedJson(rawHtml, /Fusion\.globalContent\s*=\s*/) as Record<string, unknown> | null;
  if (fusion) {
    const body = renderArcElements(fusion.content_elements);
    if (htmlTextChars(body) >= MIN_TEXT_CHARS) {
      const headline = str((fusion.headlines as Record<string, unknown> | undefined)?.basic);
      found.push({ source: "fusion", html: wrapArticle(title || headline, body) });
    }
  }

  const nextStart = nextDataStart(rawHtml);
  const nextEnd = nextStart >= 0 ? rawHtml.indexOf("</script>", nextStart) : -1;
  if (nextEnd > nextStart) {
    try {
      const body = longestArticleHtml(JSON.parse(rawHtml.slice(nextStart, nextEnd)), id);
      if (body) found.push({ source: "next_data", html: wrapArticle(title, stripDocumentTags(body)) });
    } catch {
      /* not JSON */
    }
  }

  const state = readAssignedJson(rawHtml, /\b__(?:PRELOADED|INITIAL|APOLLO)_STATE__\s*=\s*/);
  if (state) {
    const body = longestArticleHtml(state, id);
    if (body) found.push({ source: "page_state", html: wrapArticle(title, stripDocumentTags(body)) });
  }

  return found;
}

/**
 * The WordPress REST URL a page advertises for itself
 * (`<link rel="alternate" type="application/json" href=".../wp/v2/posts/123">`),
 * only on the page's own host.
 */
export function findWpJsonUrl(rawHtml: string, pageUrl: string): string | null {
  const page = new URL(pageUrl);
  for (const tag of rawHtml.match(/<link\b[^<>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?alternate\b/i.test(tag)) continue;
    if (!/\btype\s*=\s*["']application\/json["']/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.replace(/&amp;/g, "&");
    if (!href) continue;
    try {
      const url = new URL(href, page);
      // The route is in the path, or URL-decoded in ?rest_route=.
      const route = url.searchParams.get("rest_route") ?? decodeURIComponent(url.pathname);
      if (!/(?:^|\/wp-json)\/wp\/v2\/[a-z_-]+\/\d+\/?$/i.test(route)) continue;
      const bare = (host: string) => host.replace(/^www\./, "");
      if (url.protocol === "https:" && bare(url.hostname) === bare(page.hostname)) return url.toString();
    } catch {
      /* bad href */
    }
  }
  return null;
}

/** The article in a WordPress REST post response, or null. */
export function wpJsonArticle(json: unknown, title: string): EmbeddedArticle | null {
  const post = json as { content?: { rendered?: unknown }; title?: { rendered?: unknown } } | null;
  const body = str(post?.content?.rendered);
  if (htmlTextChars(body) < MIN_TEXT_CHARS) return null;
  const restTitle = stripTags(str(post?.title?.rendered));
  return { source: "wp_json", html: wrapArticle(title || restTitle, body) };
}
