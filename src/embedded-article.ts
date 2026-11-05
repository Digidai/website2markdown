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

function readAssignedJson(html: string, marker: RegExp): unknown {
  const match = marker.exec(html);
  return match ? readJsonObject(html, match.index + match[0].length) : null;
}

/** What identifies the requested article among the records in page state. */
interface ArticleIdentity {
  path: string;
  slug: string;
  title: string;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The normalised path of a URL or path string, or null. */
function urlPath(value: string): string | null {
  try {
    return decodeURIComponent(new URL(value, "https://page.invalid").pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return null;
  }
}

function articleIdentity(pageUrl: string, title: string): ArticleIdentity {
  const path = urlPath(pageUrl) ?? "";
  const slug = path.split("/").pop() ?? "";
  const normalizedTitle = normalizeText(title);
  return {
    path: path.length > 1 ? path : "",
    slug: slug.length >= 8 ? slug : "",
    title: normalizedTitle.length >= 12 ? normalizedTitle : "",
  };
}

/** Keys whose value says which article a record is. */
const IDENTITY_KEY = /^(?:url|canonical_?url|path|slug|permalink|link|headline|title)$/i;

/**
 * Whether a record names the requested article: true if one of its own short
 * string values is the article's URL, path, slug, or headline; false if it has
 * identity keys that name something else; null if it has no identity keys.
 */
function recordNamesArticle(record: object, id: ArticleIdentity): boolean | null {
  if (namesArticle(record, id)) return true;
  const hasIdentity = Object.entries(record).some(([key, value]) => typeof value === "string" && IDENTITY_KEY.test(key));
  return hasIdentity ? false : null;
}

/**
 * Whole-value matches only: a URL or path must be the page's whole path, and
 * only a bare value is compared with the slug, so `/harbour-vote` claims
 * neither `/harbour-vote-delayed` nor `/2025/sports/harbour-vote`.
 */
function namesArticle(record: object, id: ArticleIdentity): boolean {
  for (const value of Object.values(record)) {
    if (typeof value !== "string" || value.length > 2000) continue;
    if (/^(?:https?:)?\/\/|^\//i.test(value)) {
      if (id.path && urlPath(value) === id.path) return true;
    } else if (id.slug && value.toLowerCase() === id.slug) {
      return true;
    }
    if (id.title) {
      // The page title may add a site name after a separator ("Headline | Site").
      const text = normalizeText(value);
      if (
        text.length >= 12 &&
        (text === id.title || (id.title.startsWith(text) && /^\s*[|\-–—:·•]/.test(id.title.slice(text.length))))
      ) return true;
    }
  }
  return false;
}

/**
 * The longest article HTML string (one with paragraphs) in `data` that belongs
 * to the requested article: the nearest of its three enclosing records that
 * says which article it is must name this one. That keeps a longer prefetched
 * related article from replacing the requested one.
 */
function longestArticleHtml(data: unknown, id: ArticleIdentity): string | null {
  let best: string | null = null;
  let bestChars = MIN_TEXT_CHARS - 1;
  const verdicts = new Map<object, boolean | null>();
  const belongs = (records: object[]) => {
    for (const record of records) {
      let verdict = verdicts.get(record);
      if (verdict === undefined) verdicts.set(record, (verdict = recordNamesArticle(record, id)));
      if (verdict !== null) return verdict;
    }
    return false;
  };
  // Each entry carries its nearest enclosing records, nearest first. Only
  // strings and containers are queued, and the budget is spent when queuing,
  // so a huge array cannot allocate a stack entry per element.
  const stack: Array<[unknown, object[]]> = [[data, []]];
  let budget = MAX_WALK_NODES;
  const queue = (value: unknown, records: object[]) => {
    if (budget > 0 && (typeof value === "string" || (value !== null && typeof value === "object"))) {
      budget--;
      stack.push([value, records]);
    }
  };
  while (stack.length > 0) {
    const [node, records] = stack.pop()!;
    if (typeof node === "string") {
      if (node.length > bestChars && /<p[\s>]/i.test(node) && belongs(records)) {
        const chars = htmlTextChars(node);
        if (chars > bestChars) {
          best = node;
          bestChars = chars;
        }
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        if (budget <= 0) break;
        queue(item, records);
      }
    } else if (node && typeof node === "object") {
      const inner = [node, ...records].slice(0, 3);
      for (const key in node) {
        if (budget <= 0) break;
        queue((node as Record<string, unknown>)[key], inner);
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
      page: typeof page === "object" && page ? (page as Record<string, unknown>)["@id"] : page,
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

  const nextOpen = /<script\b[^<>]*\bid\s*=\s*["']__NEXT_DATA__["'][^<>]*>/i.exec(rawHtml);
  const nextStart = nextOpen ? nextOpen.index + nextOpen[0].length : -1;
  const nextEnd = nextOpen ? rawHtml.indexOf("</script>", nextStart) : -1;
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
