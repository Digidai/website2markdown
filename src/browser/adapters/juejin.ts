import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";

export const juejinAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("juejin.cn/post/");
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
    await new Promise((r) => setTimeout(r, 2000));

    // Remove UI noise and expand collapsed content
    await page.evaluate(`
      (function() {
        // Remove login popup, sidebar, recommended articles
        var noise = [
          '[class*="login-guide"]', '[class*="sidebar"]',
          '[class*="recommended"]', '[class*="comment-box"]',
          '[class*="article-end"]', '[class*="extension"]'
        ];
        noise.forEach(function(sel) {
          try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
        });
        // Expand collapsed code blocks
        document.querySelectorAll('[class*="code-block-extension"]').forEach(function(el) {
          el.style.maxHeight = 'none';
          el.style.overflow = 'visible';
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
