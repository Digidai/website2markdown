import puppeteer from "@cloudflare/puppeteer";
import type { Env, SiteAdapter } from "../types";
import { BROWSER_TIMEOUT } from "../config";
import { isSafeUrl } from "../security";

// Adapter registry — order matters (first match wins, generic is last)
import { feishuAdapter } from "./adapters/feishu";
import { wechatAdapter } from "./adapters/wechat";
import { zhihuAdapter } from "./adapters/zhihu";
import { yuqueAdapter } from "./adapters/yuque";
import { notionAdapter } from "./adapters/notion";
import { juejinAdapter } from "./adapters/juejin";
import { genericAdapter } from "./adapters/generic";

const adapters: SiteAdapter[] = [
  feishuAdapter,
  wechatAdapter,
  zhihuAdapter,
  yuqueAdapter,
  notionAdapter,
  juejinAdapter,
  genericAdapter, // Must be last
];

/** Find the matching adapter for a URL. */
export function getAdapter(url: string): SiteAdapter {
  for (const adapter of adapters) {
    if (adapter.match(url)) return adapter;
  }
  return genericAdapter;
}

/** Check if a URL always needs browser rendering. */
export function alwaysNeedsBrowser(url: string): boolean {
  const adapter = getAdapter(url);
  return adapter.alwaysBrowser;
}

/**
 * Fetch a URL using headless Chrome via Cloudflare Browser Rendering.
 * Selects the appropriate site adapter for optimal extraction.
 */
export async function fetchWithBrowser(
  url: string,
  env: Env,
): Promise<string> {
  const adapter = getAdapter(url);
  const capturedImages = new Map<string, string>();

  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();

    // Configure page for this site (pass capturedImages for response interception)
    await adapter.configurePage(page, capturedImages);

    // SSRF protection — intercept every request
    await page.setRequestInterception(true);
    page.on("request", (req: any) => {
      const reqUrl = req.url();
      if (!isSafeUrl(reqUrl)) {
        req.abort("accessdenied");
      } else {
        req.continue();
      }
    });

    // Navigate
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: BROWSER_TIMEOUT,
    });

    // Let adapter extract content
    const result = await adapter.extract(page, capturedImages);
    if (result?.html) {
      return result.html;
    }

    // Fallback: return raw page content
    const html = await page.content();
    return html;
  } finally {
    try {
      await browser.close();
    } catch (e) {
      console.error("Browser close error:", e instanceof Error ? e.message : e);
    }
  }
}
