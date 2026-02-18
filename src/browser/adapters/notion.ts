import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";

export const notionAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("notion.site/") || url.includes("notion.so/");
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 900 });
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Notion pages are SPAs — wait for content blocks to render
    await new Promise((r) => setTimeout(r, 4000));

    // Scroll through to trigger lazy rendering
    await page.evaluate(`
      (async function() {
        var scrollEl = document.querySelector('[class*="scroller"]') || document.documentElement;
        var totalH = Math.max(scrollEl.scrollHeight, 5000);
        for (var y = 0; y < totalH; y += 500) {
          scrollEl.scrollTop = y;
          window.scrollTo(0, y);
          await new Promise(function(r) { setTimeout(r, 300); });
        }
        // Swap lazy images
        document.querySelectorAll('img[data-src], img[loading="lazy"]').forEach(function(img) {
          var real = img.getAttribute('data-src');
          if (real) img.setAttribute('src', real);
        });
      })()
    `);

    const html = await page.content();
    return { html };
  },
};
