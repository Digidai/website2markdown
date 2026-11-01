import type { Env, SiteAdapter } from "../../types";
import { DESKTOP_UA } from "../../config";
import { escapeHtml } from "../../security";
import { genericAdapter } from "./generic";
import { fetchViaProxyPool, parseProxyPool } from "../../proxy";

/**
 * Substack serves each post as JSON at /api/v1/posts/<slug>. One small API
 * call is far less likely to hit Substack's 429s than fetching the page, and
 * `body_html` is the clean article body. Paid posts return their free preview.
 * Workers egress still gets 429 at times; the same call is then retried once
 * through the configured proxy.
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

  async fetchDirect(url: string, env?: Env): Promise<string | null> {
    const { origin, pathname } = new URL(url);
    const slug = pathname.split("/")[2];
    if (!slug) return null;
    const apiUrl = `${origin}/api/v1/posts/${encodeURIComponent(slug)}`;
    const headers = { "User-Agent": DESKTOP_UA, "Accept": "application/json", "Referer": url };
    try {
      let json: any;
      const resp = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        json = await resp.json();
      } else {
        const proxies = resp.status === 429 ? parseProxyPool(env?.PROXY_POOL || env?.PROXY_URL || "") : [];
        if (proxies.length === 0) return null;
        const viaProxy = (target: string) => fetchViaProxyPool(target, proxies, [{
          name: "default",
          headers: { ...headers, "Accept-Encoding": "identity" },
        }], { timeoutMs: 10_000, acceptResult: (r) => r.status === 200 || (r.status >= 301 && r.status <= 308) });
        let proxied = await viaProxy(apiUrl);
        // Publications with a custom domain answer the proxy with a redirect
        // to that domain, which fetchViaProxy does not follow. Follow it once.
        if (proxied.status !== 200 && proxied.headers.location) {
          proxied = await viaProxy(new URL(proxied.headers.location, apiUrl).href);
        }
        if (proxied.status !== 200) return null;
        json = JSON.parse(proxied.body);
      }
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
