import type { SiteAdapter, ExtractResult } from "../../types";
import { applyStealthAndDesktop } from "../stealth";

const CONTENT_SELECTOR = ".article_content, #article_content, .blog-content-box, #content_views";

export const csdnAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("csdn.net/");
  },

  alwaysBrowser: true,

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
        const cookieStr = cookies
          .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
          .join("; ");
        throw new Error(`PROXY_RETRY:${cookieStr}`);
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
        document.querySelectorAll('.hide-article-box').forEach(function(el) { el.remove(); });
        var content = document.querySelector('#article_content');
        if (content) {
          content.style.height = 'auto';
          content.style.overflow = 'visible';
        }
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
