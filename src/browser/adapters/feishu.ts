import type { SiteAdapter, ExtractResult } from "../../types";

const FEISHU_DOC_PATH_PREFIXES = [
  "/wiki/",
  "/docx/",
  "/docs/",
  "/sheet/",
  "/sheets/",
  "/base/",
  "/bitable/",
  "/slides/",
  "/minutes/",
  "/mindnotes/",
];

const FEISHU_DOC_HOST_SUFFIXES = [
  ".feishu.cn",
  ".larksuite.com",
];

const FEISHU_EXCLUDED_HOSTS = new Set([
  "www.feishu.cn",
  "open.feishu.cn",
  "accounts.feishu.cn",
  "www.larksuite.com",
  "open.larksuite.com",
  "accounts.larksuite.com",
]);

export function isFeishuDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (FEISHU_EXCLUDED_HOSTS.has(host)) {
      return false;
    }
    if (!FEISHU_DOC_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      return false;
    }
    return FEISHU_DOC_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

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
    return isFeishuDocumentUrl(url);
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
