import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";

export const zhihuAdapter: SiteAdapter = {
  match(url: string): boolean {
    return (
      url.includes("zhihu.com/p/") ||
      url.includes("zhuanlan.zhihu.com/")
    );
  },

  alwaysBrowser: false,

  async configurePage(page: any): Promise<void> {
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Wait for Zhihu's SPA to render
    await new Promise((r) => setTimeout(r, 2000));

    // Remove login walls and overlays
    await page.evaluate(`
      (function() {
        // Remove login modal
        document.querySelectorAll('[class*="Modal"]').forEach(function(el) { el.remove(); });
        document.querySelectorAll('[class*="signflow"]').forEach(function(el) { el.remove(); });
        // Restore scrolling
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
        // Swap lazy images
        document.querySelectorAll('img[data-original]').forEach(function(img) {
          var real = img.getAttribute('data-original') || img.getAttribute('data-actualsrc');
          if (real) img.setAttribute('src', real);
        });
      })()
    `);

    const html = await page.content();
    return { html };
  },
};
