import type { SiteAdapter, ExtractResult } from "../../types";
import { MOBILE_UA } from "../../config";
import { escapeHtml } from "../../security";
import { applyStealthAndDesktop } from "../stealth";
import { createProxyRetrySignal } from "../proxy-retry";

const CONTENT_SELECTOR = '.article-content, [class*="articleDetail"], .content-article';

// www.toutiao.com/article/<id>, /a<id>, /group/<id>, m.toutiao.com/i<id>
const ARTICLE_ID = /toutiao\.com\/(?:article\/|group\/|a|i)(\d{15,20})/;

export const toutiaoAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("toutiao.com/");
  },

  alwaysBrowser: true,

  // The mobile article endpoint returns the full body HTML with title and
  // source, no cookie or signature needed. Trending/topic pages have no
  // article id and still go to the browser.
  async fetchDirect(url: string): Promise<string | null> {
    const id = url.match(ARTICLE_ID)?.[1];
    if (!id) return null;
    try {
      const resp = await fetch(`https://m.toutiao.com/i${id}/info/`, {
        headers: { "User-Agent": MOBILE_UA, "Referer": "https://m.toutiao.com/", "Accept": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return null;
      const data = ((await resp.json()) as any)?.data;
      if (typeof data?.content !== "string" || !data.content) return null;

      const title = String(data.title || id);
      const seconds = Number(data.publish_time);
      // Dates in Beijing time, as Toutiao shows them.
      const date = seconds > 0 ? new Date((seconds + 8 * 3600) * 1000).toISOString().slice(0, 10) : "";
      const byline = [data.source, date].filter(Boolean).join(" · ");
      return `<html><head><title>${escapeHtml(title)}</title></head><body><article data-adapter="toutiao">` +
        `<h1>${escapeHtml(title)}</h1>` +
        (byline ? `<p>${escapeHtml(byline)}</p>` : "") +
        data.content +
        `</article></body></html>`;
    } catch {
      return null;
    }
  },

  async configurePage(page: any): Promise<void> {
    await applyStealthAndDesktop(page);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Wait for article content
    try {
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: 12_000 });
    } catch {
      // Content didn't appear — try proxy retry with whatever cookies the browser got
      let cookies: Array<{ name: string; value: string }> = [];
      try { cookies = await page.cookies(); } catch {}

      if (cookies.length > 0) {
        const retrySignal = createProxyRetrySignal(cookies);
        if (retrySignal) {
          throw new Error(retrySignal);
        }
      }
      throw new Error("Toutiao page did not load article content within timeout.");
    }

    await new Promise((r) => setTimeout(r, 1500));

    // Remove noise
    await page.evaluate(`
      (function() {
        var noise = [
          '[class*="sidebar"]', '[class*="recommend"]', '[class*="comment"]',
          '[class*="login"]', '[class*="modal"]', '[class*="banner"]',
          '[class*="footer"]', '[class*="download-guide"]'
        ];
        noise.forEach(function(sel) {
          try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
        });
        document.querySelectorAll('img[data-src]').forEach(function(img) {
          var real = img.getAttribute('data-src');
          if (real) img.setAttribute('src', real);
        });
      })()
    `);

    const html = await page.content();
    return { html };
  },
};
