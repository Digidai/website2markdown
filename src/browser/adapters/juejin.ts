import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";
import { applyStealthAndDesktop } from "../stealth";
import { createProxyRetrySignal } from "../proxy-retry";

const CONTENT_SELECTOR = ".article-content, .markdown-body, [class*='article-viewer']";

async function getPost(url: string, cookie?: string): Promise<string | null> {
  const headers: Record<string, string> = {
    "User-Agent": DESKTOP_UA, "Accept": "text/html", "Accept-Language": "zh-CN,zh;q=0.9",
  };
  if (cookie) headers.Cookie = cookie;
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  return resp.ok ? resp.text() : null;
}

const b64bytes = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/**
 * The challenge page embeds cs = base64({v:{a,b,c},s}). The browser finds the
 * small integer n with sha256(bytes(a) + String(n)) === bytes(c), adds
 * d = btoa(String(n)) and sends base64(JSON) back as the _wafchallengeid
 * cookie. n is normally a single digit, so the search is capped low to bound
 * CPU. Returns the cookie value, or null when there is no solvable challenge.
 */
export async function solveWafChallenge(html: string): Promise<string | null> {
  const cs = html.match(/cs="([^"]+)"/)?.[1];
  if (!cs || !html.includes("_wafchallengeid")) return null;
  const challenge = JSON.parse(atob(cs));
  const prefix = b64bytes(challenge.v.a);
  const target = b64bytes(challenge.v.c).join(",");
  for (let n = 0; n < 10_000; n++) {
    const digits = new TextEncoder().encode(String(n));
    const input = new Uint8Array(prefix.length + digits.length);
    input.set(prefix);
    input.set(digits, prefix.length);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    if (hash.join(",") === target) {
      challenge.d = btoa(String(n));
      return btoa(JSON.stringify(challenge));
    }
  }
  return null;
}

export const juejinAdapter: SiteAdapter = {
  match(url: string): boolean {
    return (
      url.includes("juejin.cn/post/") ||
      url.includes("juejin.cn/pin/") ||
      url.includes("juejin.cn/book/")
    );
  },

  alwaysBrowser: true,

  // Post pages are server-rendered (Nuxt SSR) with the full article in
  // .article-viewer, so a plain GET is enough. Some egress IPs first get the
  // WAF's _wafchallengeid page; solve it and retry with the cookie. The
  // solution is bound to the egress IP, and Workers sometimes sends the retry
  // from another one (403), so the whole round is tried twice.
  async fetchDirect(url: string): Promise<string | null> {
    if (!url.includes("juejin.cn/post/")) return null;
    try {
      for (let round = 0; round < 2; round++) {
        let html = await getPost(url);
        if (html?.includes("article-viewer")) return html;
        const cookie = html && (await solveWafChallenge(html));
        if (!cookie) return null;
        html = await getPost(url, `_wafchallengeid=${cookie}`);
        if (html?.includes("article-viewer")) return html;
      }
      return null;
    } catch {
      return null;
    }
  },

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
          '[class*="article-end"]', '[class*="copy-code-btn"]',
          '.code-block-extension-header'
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
