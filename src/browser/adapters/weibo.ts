import type { SiteAdapter, ExtractResult } from "../../types";
import { applyStealthAndDesktop } from "../stealth";

const CONTENT_SELECTOR = '.Feed_body, [class*="wbpro-feed"], [class*="detail_wbtext"], .card-feed';

export const weiboAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("weibo.com/");
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await applyStealthAndDesktop(page);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Wait for the page to settle after any redirects
    await new Promise((r) => setTimeout(r, 3000));

    // Check if we were redirected to login/visitor page
    let currentUrl = "";
    try { currentUrl = await page.evaluate("location.href"); } catch {}

    if (
      currentUrl.includes("passport.weibo") ||
      currentUrl.includes("login.sina") ||
      currentUrl.includes("visitor/visitor") ||
      currentUrl.includes("weibo.com/login") ||
      currentUrl.includes("signin")
    ) {
      // On login page — extract cookies and retry via proxy
      let cookies: Array<{ name: string; value: string }> = [];
      try { cookies = await page.cookies(); } catch {}

      if (cookies.length > 0) {
        const cookieStr = cookies
          .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
          .join("; ");
        throw new Error(`PROXY_RETRY:${cookieStr}`);
      }
      throw new Error("Weibo redirected to login page.");
    }

    // Check for login page content (Weibo renders login inline at original URL)
    const isLoginPage = await page.evaluate(`
      (function() {
        var text = document.body ? document.body.innerText : '';
        var html = document.body ? document.body.innerHTML : '';
        // Detect Weibo login page: QR code login script or login form
        if (html.indexOf('qrcode_login') !== -1) return true;
        if (html.indexOf('login_type') !== -1) return true;
        if (html.indexOf('passport.weibo') !== -1) return true;
        if (text.indexOf('登录') !== -1 && text.indexOf('注册') !== -1 && text.length < 3000) return true;
        return false;
      })()
    `);

    if (isLoginPage) {
      let cookies: Array<{ name: string; value: string }> = [];
      try { cookies = await page.cookies(); } catch {}

      if (cookies.length > 0) {
        const cookieStr = cookies
          .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
          .join("; ");
        throw new Error(`PROXY_RETRY:${cookieStr}`);
      }
      throw new Error("Weibo requires login verification.");
    }

    // Try to wait for content
    try {
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: 8_000 });
    } catch {
      // Content didn't appear — try proxy retry
      let cookies: Array<{ name: string; value: string }> = [];
      try { cookies = await page.cookies(); } catch {}

      if (cookies.length > 0) {
        const cookieStr = cookies
          .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
          .join("; ");
        throw new Error(`PROXY_RETRY:${cookieStr}`);
      }
      throw new Error("Weibo page did not load content within timeout.");
    }

    await new Promise((r) => setTimeout(r, 1500));

    // Clean up
    await page.evaluate(`
      (function() {
        var noise = [
          '[class*="sidebar"]', '[class*="login"]', '[class*="modal"]',
          '[class*="recommend"]', '[class*="comment"]', '[class*="footer"]',
          '[class*="toolbar"]', '[class*="nav-main"]'
        ];
        noise.forEach(function(sel) {
          try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
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
