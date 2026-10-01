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
    try {
      await page.waitForSelector(
        ".notion-page-content, [data-block-id], .notion-selectable",
        { timeout: 8_000 },
      );
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Scroll through to trigger lazy block rendering
    await page.evaluate(`
      (async function() {
        var scrollEl = document.querySelector('[class*="scroller"]') || document.documentElement;
        var totalH = Math.max(scrollEl.scrollHeight, 5000);
        for (var y = 0; y < totalH; y += 600) {
          scrollEl.scrollTop = y;
          window.scrollTo(0, y);
          await new Promise(function(r) { setTimeout(r, 250); });
        }

        // Expand collapsed toggle blocks
        document.querySelectorAll('.notion-toggle-block, [aria-expanded="false"]').forEach(function(el) {
          try {
            var toggleBtn = el.querySelector('[role="button"]') || el;
            toggleBtn.click();
          } catch(e) {}
        });

        // Remove topbar, sidebar, and overlays
        var noise = [
          '.notion-topbar', '.notion-sidebar', '.notion-overlay-container',
          '.notion-help-button', '[class*="notion-sidebar"]'
        ];
        noise.forEach(function(sel) {
          try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
        });

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
