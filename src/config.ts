/** Maximum response body size (5 MB). */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Maximum URL length to prevent abuse. */
export const MAX_URL_LENGTH = 4096;

/** Cache TTL defaults (seconds). */
export const CACHE_TTL_DEFAULT = 3600; // 1 hour
export const CACHE_TTL_SHORT = 600; // 10 min (dynamic content)

/** Browser rendering budget (ms). */
export const BROWSER_TIMEOUT = 30_000;
export const FEISHU_BROWSER_TIMEOUT = 55_000;
export const FEISHU_SCROLL_BUDGET = 25_000;
export const FEISHU_SETTLE_WAIT = 3000;
export const FEISHU_SCROLL_STEP = 300;
export const FEISHU_SCROLL_DELAY = 400;
export const FEISHU_STALE_LIMIT = 15;
export const FEISHU_MAX_CAPTURED_IMAGES = 50;

/** Image limits for capture. */
export const IMAGE_MIN_BYTES = 5000;
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Max concurrent browser sessions in batch mode. */
export const BROWSER_CONCURRENCY = 2;

/** Valid output formats. */
export const VALID_FORMATS = new Set(["markdown", "html", "text", "json"]);

// WeChat in-app browser UA — mp.weixin.qq.com checks for "MicroMessenger"
export const WECHAT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2f) " +
  "NetType/WIFI Language/zh_CN";

// Generic mobile UA for other sites that block headless Chrome
export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

// Desktop UA for sites that require desktop viewport
export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

// Googlebot UA — sites allow this through anti-bot to be indexed by Google
export const GOOGLEBOT_UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; " +
  "+http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};
