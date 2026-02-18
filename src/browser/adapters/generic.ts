import type { SiteAdapter, ExtractResult } from "../../types";
import { MOBILE_UA } from "../../config";

export const genericAdapter: SiteAdapter = {
  match(): boolean {
    return true; // Fallback — matches everything
  },

  alwaysBrowser: false,

  async configurePage(page: any): Promise<void> {
    await page.setUserAgent(MOBILE_UA);
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });
  },

  async extract(page: any): Promise<ExtractResult | null> {
    await new Promise((r) => setTimeout(r, 2000));
    // Swap lazy-loaded images
    await page.evaluate(`
      document.querySelectorAll("img[data-src]").forEach(function(img) {
        var real = img.getAttribute("data-src");
        if (real) img.setAttribute("src", real);
      });
    `);
    const html = await page.content();
    return { html };
  },
};
