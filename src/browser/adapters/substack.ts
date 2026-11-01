import type { SiteAdapter } from "../../types";
import { DESKTOP_UA } from "../../config";
import { escapeHtml } from "../../security";
import { genericAdapter } from "./generic";

/**
 * Substack serves each post as JSON at /api/v1/posts/<slug>. One small API
 * call is far less likely to hit Substack's 429s than fetching the page, and
 * `body_html` is the clean article body. Paid posts return their free preview.
 */
export const substackAdapter: SiteAdapter = {
  ...genericAdapter,

  match(url: string): boolean {
    try {
      const { hostname, pathname } = new URL(url);
      return hostname.endsWith(".substack.com") && pathname.startsWith("/p/");
    } catch {
      return false;
    }
  },

  async fetchDirect(url: string): Promise<string | null> {
    const { origin, pathname } = new URL(url);
    const slug = pathname.split("/")[2];
    if (!slug) return null;
    try {
      const resp = await fetch(`${origin}/api/v1/posts/${encodeURIComponent(slug)}`, {
        headers: {
          "User-Agent": DESKTOP_UA,
          "Accept": "application/json",
          "Referer": url,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as any;
      const post = json?.post ?? json;
      if (!post?.body_html) return null;

      const title = post.title || slug;
      const author = Array.isArray(post.publishedBylines)
        ? post.publishedBylines.map((b: any) => b?.name).filter(Boolean).join(", ")
        : "";
      const date = typeof post.post_date === "string" ? post.post_date.slice(0, 10) : "";
      const byline = [author, date].filter(Boolean).join(" · ");
      return `<html><head><title>${escapeHtml(title)}</title></head><body><article data-adapter="substack">` +
        `<h1>${escapeHtml(title)}</h1>` +
        (post.subtitle ? `<p><em>${escapeHtml(post.subtitle)}</em></p>` : "") +
        (byline ? `<p>${escapeHtml(byline)}</p>` : "") +
        post.body_html +
        `</article></body></html>`;
    } catch {
      return null;
    }
  },
};
