import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";

export const yuqueAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("yuque.com/");
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Yuque is an SPA — wait for content to render
    await new Promise((r) => setTimeout(r, 3000));

    // Remove UI chrome and expand content
    await page.evaluate(`
      (function() {
        // Remove sidebar, header, toc
        var noise = [
          '[class*="sidebar"]', '[class*="Sidebar"]',
          '[class*="header"]', '[class*="Header"]',
          '[class*="catalogTree"]', '[class*="toc-"]',
          '[class*="reader-helper"]', '[class*="lake-alert"]'
        ];
        noise.forEach(function(sel) {
          try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
        });
        // Swap lazy images
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
