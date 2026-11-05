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

/** Non-whitespace characters of text, the same measure as markdownBodyChars. */
export function htmlTextChars(html: string): number {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, "").length;
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
  return html.replace(/<!DOCTYPE[^>]*>|<\/?(?:html|head|body)\b[^>]*>/gi, "");
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

/** The longest string in `data` that is article HTML (has paragraphs). */
function longestHtmlString(data: unknown): string | null {
  let best: string | null = null;
  let bestChars = MIN_TEXT_CHARS - 1;
  const stack: unknown[] = [data];
  let visited = 0;
  while (stack.length > 0 && visited++ < MAX_WALK_NODES) {
    const node = stack.pop();
    if (typeof node === "string") {
      if (node.length > bestChars && /<p[\s>]/i.test(node)) {
        const chars = htmlTextChars(node);
        if (chars > bestChars) {
          best = node;
          bestChars = chars;
        }
      }
    } else if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
    } else if (node && typeof node === "object") {
      for (const value of Object.values(node)) stack.push(value);
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
            `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(caption.replace(/<[^>]*>/g, ""))}">` +
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
 * Every article body embedded in the raw page HTML (scripts intact). `title`
 * is the page title from the normal conversion; it heads each candidate.
 */
export function extractEmbeddedArticles(rawHtml: string, title: string): EmbeddedArticle[] {
  const found: EmbeddedArticle[] = [];

  const jsonLd = extractJsonLdArticle(rawHtml);
  if (jsonLd) found.push({ source: "jsonld", html: jsonLd });

  const fusion = readAssignedJson(rawHtml, /Fusion\.globalContent\s*=\s*/) as Record<string, unknown> | null;
  if (fusion) {
    const body = renderArcElements(fusion.content_elements);
    if (htmlTextChars(body) >= MIN_TEXT_CHARS) {
      const headline = str((fusion.headlines as Record<string, unknown> | undefined)?.basic);
      found.push({ source: "fusion", html: wrapArticle(title || headline, body) });
    }
  }

  const nextData = /<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(rawHtml);
  if (nextData) {
    try {
      const body = longestHtmlString(JSON.parse(nextData[1]));
      if (body) found.push({ source: "next_data", html: wrapArticle(title, stripDocumentTags(body)) });
    } catch {
      /* not JSON */
    }
  }

  const state = readAssignedJson(rawHtml, /\b__(?:PRELOADED|INITIAL|APOLLO)_STATE__\s*=\s*/);
  if (state) {
    const body = longestHtmlString(state);
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
  for (const tag of rawHtml.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?alternate\b/i.test(tag)) continue;
    if (!/\btype\s*=\s*["']application\/json["']/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.replace(/&amp;/g, "&");
    if (!href || !/(?:\/wp-json\/|rest_route=\/)wp\/v2\/[a-z_-]+\/\d+/i.test(href)) continue;
    try {
      const url = new URL(href, page);
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
  const restTitle = str(post?.title?.rendered).replace(/<[^>]*>/g, "");
  return { source: "wp_json", html: wrapArticle(title || restTitle, body) };
}
