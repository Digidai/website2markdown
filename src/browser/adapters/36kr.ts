import type { SiteAdapter, ExtractResult } from "../../types";
import { applyStealthAndDesktop } from "../stealth";

const CONTENT_SELECTOR = ".article-content, .common-width, .articleDetailContent";

export const kr36Adapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("36kr.com/");
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await applyStealthAndDesktop(page);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Wait for article content
    try {
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: 12_000 });
    } catch {
      // Check if we have substantial content despite selector miss
      const bodyLen = await page.evaluate(
        "document.body ? document.body.innerText.length : 0",
      );
      if (bodyLen > 1000) {
        const html = await page.content();
        return { html };
      }

      // Content didn't appear — try proxy retry with whatever cookies the browser got
      let cookies: Array<{ name: string; value: string }> = [];
      try { cookies = await page.cookies(); } catch {};

      if (cookies.length > 0) {
        const cookieStr = cookies
          .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
          .join("; ");
        throw new Error(`PROXY_RETRY:${cookieStr}`);
      }
      throw new Error("36kr page did not load article content within timeout.");
    }

    await new Promise((r) => setTimeout(r, 1500));

    // Clean up UI noise
    await page.evaluate(`
      (function() {
        var noise = [
          '[class*="sidebar"]', '[class*="recommend"]', '[class*="comment"]',
          '[class*="login"]', '[class*="modal"]', '[class*="toast"]',
          '[class*="banner"]', '[class*="footer"]'
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
