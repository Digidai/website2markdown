import type { SiteAdapter, ExtractResult } from "../../types";
import { applyStealthAndDesktop } from "../stealth";
import { createProxyRetrySignal } from "../proxy-retry";

const CONTENT_SELECTOR = ".article-content, .markdown-body, [class*='article-viewer']";

export const juejinAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("juejin.cn/post/");
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await applyStealthAndDesktop(page);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Wait for article content to render
    try {
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: 12_000 });
    } catch {
      // Content didn't appear — try proxy retry with whatever cookies the browser got
      let cookies: Array<{ name: string; value: string }> = [];
      try { cookies = await page.cookies(); } catch {}

      if (cookies.length > 0) {
        const retrySignal = createProxyRetrySignal(cookies);
        if (retrySignal) {
          throw new Error(retrySignal);
        }
      }
      throw new Error("Juejin page did not load article content within timeout.");
    }

    await new Promise((r) => setTimeout(r, 2000));

    // Remove UI noise and expand collapsed content
    await page.evaluate(`
      (function() {
        var noise = [
          '[class*="login-guide"]', '[class*="sidebar"]',
          '[class*="recommended"]', '[class*="comment-box"]',
          '[class*="article-end"]', '[class*="extension"]'
        ];
        noise.forEach(function(sel) {
          try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
        });
        document.querySelectorAll('[class*="code-block-extension"]').forEach(function(el) {
          el.style.maxHeight = 'none';
          el.style.overflow = 'visible';
        });
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
