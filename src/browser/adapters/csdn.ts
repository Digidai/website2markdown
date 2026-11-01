import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";
import { applyStealthAndDesktop } from "../stealth";
import { createProxyRetrySignal } from "../proxy-retry";

const CONTENT_SELECTOR = ".article_content, #article_content, .blog-content-box, #content_views";

export const csdnAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("csdn.net/");
  },

  alwaysBrowser: true,

  // Article pages are server-rendered: a plain GET usually returns the full
  // body in #content_views, so no browser or proxy is needed. CSDN's WAF
  // answers repeat visitors with a 521 JS challenge instead; that response
  // lacks the container and falls through to the browser/proxy path.
  async fetchDirect(url: string): Promise<string | null> {
    if (!/\/article\/details\/\d+/.test(url)) return null;
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": DESKTOP_UA,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return null;
      const html = await resp.text();
      return html.includes('id="content_views"') ? html : null;
    } catch {
      return null;
    }
  },

  async configurePage(page: any): Promise<void> {
    await applyStealthAndDesktop(page);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Wait for Cloudflare challenge to resolve and content to load
    // CSDN behind CF: challenge → redirect → page load → content render
    try {
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: 15_000 });
    } catch {
      // Check if we have substantial page content despite selector miss
      const bodyLen = await page.evaluate(
        "document.body ? document.body.innerText.length : 0",
      );

      // If the browser rendered substantial content, return it even without exact selector match
      if (bodyLen > 1000) {
        const html = await page.content();
        return { html };
      }

      // Content didn't appear — try proxy retry with whatever cookies the browser got
      let cookies: Array<{ name: string; value: string }> = [];
      try { cookies = await page.cookies(); } catch {}

      if (cookies.length > 0) {
        const retrySignal = createProxyRetrySignal(cookies);
        if (retrySignal) {
          throw new Error(retrySignal);
        }
      }
      throw new Error("CSDN page did not load article content within timeout.");
    }

    await new Promise((r) => setTimeout(r, 1500));

    // Remove noise: login walls, sidebars, comments
    await page.evaluate(`
      (function() {
        var noise = [
          '[class*="login"]', '[class*="passport"]', '.csdn-side-toolbar',
          '#csdn-toolbar', '[class*="recommend"]', '[class*="comment"]',
          '.hide-article-box', '.more-toolbox'
        ];
        noise.forEach(function(sel) {
          try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
        });
        var readMore = document.querySelector('#btn-readmore, .btn-readmore, .open_full_article');
        if (readMore) {
          try { readMore.click(); } catch(e) {}
        }
        document.querySelectorAll('.hide-article-box, .hide-article-pos').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.article_content, #article_content, .blog-content-box').forEach(function(content) {
          content.style.height = 'auto';
          content.style.maxHeight = 'none';
          content.style.overflow = 'visible';
        });
        // Unhide login-restricted code blocks
        document.querySelectorAll('pre.set-code-hide').forEach(function(el) {
          el.classList.remove('set-code-hide');
          el.style.height = 'auto';
          el.style.maxHeight = 'none';
        });
        document.querySelectorAll('img[data-src], img[data-original]').forEach(function(img) {
          var real = img.getAttribute('data-src') || img.getAttribute('data-original');
          if (real) img.setAttribute('src', real);
        });
      })()
    `);

    const html = await page.content();
    return { html };
  },
};
