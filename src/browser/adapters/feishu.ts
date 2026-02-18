import type { SiteAdapter, ExtractResult } from "../../types";

/**
 * Feishu adapter — provides URL matching and alwaysBrowser flag.
 *
 * The actual Feishu extraction logic lives in browser/index.ts as
 * fetchWithBrowserFeishu(). This adapter is used by getAdapter() and
 * alwaysNeedsBrowser() for URL matching and routing decisions.
 *
 * Feishu requires dedicated handling (not the generic adapter pattern)
 * because its virtual-scroll evaluate script must be an inline template
 * literal to avoid double-interpolation escaping issues.
 */
export const feishuAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes(".feishu.cn/") || url.includes(".larksuite.com/");
  },

  alwaysBrowser: true,

  async configurePage(): Promise<void> {
    // Feishu page configuration is handled directly in fetchWithBrowserFeishu
  },

  async extract(): Promise<ExtractResult | null> {
    // Feishu extraction is handled directly in fetchWithBrowserFeishu
    return null;
  },
};
