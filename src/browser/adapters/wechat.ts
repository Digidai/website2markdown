import type { SiteAdapter, ExtractResult } from "../../types";
import { WECHAT_UA } from "../../config";

export const wechatAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("mp.weixin.qq.com");
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await page.setUserAgent(WECHAT_UA);
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
    // WeChat doesn't need special extraction — Readability handles it well
    // Just wait for content to load and swap lazy images
    await new Promise((r) => setTimeout(r, 2000));
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
