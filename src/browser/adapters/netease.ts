import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";

export const neteaseAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("163.com/");
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
    const html = await page.content();
    return { html };
  },

  postProcess(html: string): string {
    // Remove massive navigation sections that confuse Readability
    return html
      .replace(/<div[^>]*class="[^"]*ne_wrap_header[^"]*"[^>]*>[\s\S]*?<\/div>\s*<!--\s*\/header\s*-->/gi, "")
      .replace(/<div[^>]*class="[^"]*N-nav[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<div[^>]*id="[^"]*footer[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<div[^>]*class="[^"]*post_recommend[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<div[^>]*class="[^"]*post_comment[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  },
};
