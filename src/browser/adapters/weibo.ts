import type { SiteAdapter, ExtractResult } from "../../types";
import { MOBILE_UA } from "../../config";
import { escapeHtml } from "../../security";
import { applyStealthAndDesktop } from "../stealth";
import { createProxyRetrySignal } from "../proxy-retry";

const CONTENT_SELECTOR = '.Feed_body, [class*="wbpro-feed"], [class*="detail_wbtext"], .card-feed';

export const weiboAdapter: SiteAdapter = {
  match(url: string): boolean {
    return (
      url.includes("weibo.com/") ||
      url.includes("weibo.cn/") ||
      url.includes("m.weibo.cn/")
    );
  },

  alwaysBrowser: true,

  async fetchDirect(url: string): Promise<string | null> {
    // Extract status ID from various Weibo URL formats
    const match =
      url.match(/(?:weibo\.com\/\d+\/|weibo\.com\/detail\/|m\.weibo\.cn\/(?:status|detail)\/)([A-Za-z0-9]+)/) ||
      url.match(/weibo\.com\/[A-Za-z0-9_]+\/([A-Za-z0-9]{8,})/);
    if (!match) return null;

    const statusId = match[1];
    // Ignore non-status sub-paths like home, fav, message
    if (["home", "fav", "message", "profile", "setting", "hot"].includes(statusId.toLowerCase())) {
      return null;
    }

    try {
      const apiUrl = `https://m.weibo.cn/statuses/show?id=${statusId}`;
      const resp = await fetch(apiUrl, {
        headers: {
          "User-Agent": MOBILE_UA,
          "Accept": "application/json, text/plain, */*",
          "Referer": "https://m.weibo.cn/",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!resp.ok) return null;
      const json = (await resp.json()) as any;
      if (!json || json.ok !== 1 || !json.data) return null;

      const data = json.data;
      const author = data.user?.screen_name || "微博用户";
      const createdAt = data.created_at || "";
      const textHtml = data.text || "";

      // Collect images
      const pics: string[] = [];
      if (Array.isArray(data.pics)) {
        for (const pic of data.pics) {
          const imgUrl = pic.large?.url || pic.url;
          if (imgUrl) pics.push(imgUrl);
        }
      }

      // Collect retweeted post if present
      let retweetHtml = "";
      if (data.retweeted_status) {
        const ret = data.retweeted_status;
        const retAuthor = ret.user?.screen_name || "转发微博";
        const retText = ret.text || "";
        const retPics: string[] = [];
        if (Array.isArray(ret.pics)) {
          for (const p of ret.pics) {
            const u = p.large?.url || p.url;
            if (u) retPics.push(u);
          }
        }
        retweetHtml = `<blockquote><p><strong>@${escapeHtml(retAuthor)}:</strong></p>${retText}`;
        for (const pic of retPics) {
          retweetHtml += `<figure><img src="${escapeHtml(pic)}" /></figure>`;
        }
        retweetHtml += `</blockquote>`;
      }

      let html = `<html><head><title>${escapeHtml(author)}的微博</title></head><body><article data-adapter="weibo">`;
      html += `<h1>${escapeHtml(author)}的微博</h1>`;
      if (createdAt) {
        html += `<p><time>${escapeHtml(createdAt)}</time></p>`;
      }
      html += `<div class="weibo-text">${textHtml}</div>`;
      for (const pic of pics) {
        html += `<figure><img src="${escapeHtml(pic)}" /></figure>`;
      }
      if (retweetHtml) {
        html += retweetHtml;
      }
      html += `</article></body></html>`;
      return html;
    } catch {
      return null;
    }
  },

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
        const retrySignal = createProxyRetrySignal(cookies);
        if (retrySignal) {
          throw new Error(retrySignal);
        }
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
        const retrySignal = createProxyRetrySignal(cookies);
        if (retrySignal) {
          throw new Error(retrySignal);
        }
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
        const retrySignal = createProxyRetrySignal(cookies);
        if (retrySignal) {
          throw new Error(retrySignal);
        }
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
