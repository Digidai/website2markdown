import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";

export const redditAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("reddit.com/");
  },

  alwaysBrowser: false,

  transformUrl(url: string): string {
    // Use old.reddit.com which is server-rendered and works with static fetch
    return url
      .replace("://www.reddit.com/", "://old.reddit.com/")
      .replace("://reddit.com/", "://old.reddit.com/");
  },

  async configurePage(page: any): Promise<void> {
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 900 });
  },

  async extract(page: any): Promise<ExtractResult | null> {
    const html = await page.content();
    return { html };
  },

  postProcess(html: string): string {
    // Old Reddit has a massive sidebar and header that confuse Readability.
    // Remove them so Readability focuses on the post content.
    // 1. Remove everything before the siteTable (header, nav, sidebar start)
    // Look for siteTable with either quote style
    let siteTableIdx = html.indexOf('id="siteTable"');
    if (siteTableIdx < 0) siteTableIdx = html.indexOf("id='siteTable'");
    if (siteTableIdx > 0) {
      // Find the opening <div of siteTable
      const divStart = html.lastIndexOf("<div", siteTableIdx);
      if (divStart > 0) {
        html = html.slice(0, html.indexOf("<body")) +
          "<body>" + html.slice(divStart);
      }
    }
    // 2. Remove comment area (old Reddit uses single quotes for this class)
    let commentIdx = html.indexOf("commentarea");
    if (commentIdx > 0) {
      const divStart = html.lastIndexOf("<div", commentIdx);
      if (divStart > 0) {
        html = html.slice(0, divStart) + "</body></html>";
      }
    }
    return html;
  },
};
