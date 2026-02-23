import type { SiteAdapter, ExtractResult } from "../../types";
import { applyStealthAndDesktop } from "../stealth";
import { createProxyRetrySignal } from "../proxy-retry";

/** Max time to wait for ZSE challenge to complete (ms). */
const ZHIHU_CHALLENGE_TIMEOUT = 15_000;

const CONTENT_SELECTOR =
  ".Post-RichTextContainer, .RichContent-inner, .QuestionRichText, article";

export const zhihuAdapter: SiteAdapter = {
  match(url: string): boolean {
    return (
      url.includes("zhihu.com/p/") ||
      url.includes("zhihu.com/question/") ||
      url.includes("zhuanlan.zhihu.com/")
    );
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await applyStealthAndDesktop(page);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // First check if content loaded directly (no challenge or challenge passed + good IP)
    try {
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: ZHIHU_CHALLENGE_TIMEOUT });
    } catch {
      // Content didn't appear — check if we landed on the login/unhuman page
      let currentUrl = "";
      try { currentUrl = await page.evaluate("location.href"); } catch {}

      if (currentUrl.includes("unhuman") || currentUrl.includes("signin")) {
        // ZSE challenge was solved but datacenter IP triggered login.
        // Extract cookies and signal the caller to retry via proxy.
        let cookies: Array<{ name: string; value: string; domain: string }> = [];
        try { cookies = await page.cookies(); } catch {}

        if (cookies.length > 0) {
          const retrySignal = createProxyRetrySignal(cookies);
          if (retrySignal) {
            throw new Error(retrySignal);
          }
        }

        throw new Error(
          "知乎要求登录验证，无法从云端服务器访问。",
        );
      }

      throw new Error("Zhihu page did not load article content within timeout.");
    }

    // Content loaded — extract it
    await new Promise((r) => setTimeout(r, 1500));

    // Check for anti-bot block
    const blocked = await page.evaluate(`
      (function() {
        var text = document.body ? document.body.innerText : '';
        return text.indexOf('请求存在异常') !== -1 || text.indexOf('限制本次访问') !== -1;
      })()
    `);
    if (blocked) {
      throw new Error("知乎反爬机制已触发，暂时无法访问该页面。");
    }

    // Remove login walls, overlays, and clean up
    await page.evaluate(`
      (function() {
        ['[class*="Modal"]','[class*="signflow"]','.OpenInAppButton','.AppHeader-login','.ContentItem-expandButton']
          .forEach(function(sel) {
            try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
          });
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
        document.querySelectorAll('.RichContent.is-collapsed').forEach(function(el) {
          el.classList.remove('is-collapsed');
          el.style.maxHeight = 'none';
        });
        document.querySelectorAll('img[data-original], img[data-actualsrc]').forEach(function(img) {
          var real = img.getAttribute('data-original') || img.getAttribute('data-actualsrc');
          if (real) img.setAttribute('src', real);
        });
        document.querySelectorAll('noscript').forEach(function(ns) {
          var tmp = document.createElement('div');
          tmp.innerHTML = ns.textContent || '';
          var img = tmp.querySelector('img');
          if (img && ns.parentNode) ns.parentNode.insertBefore(img, ns);
        });
      })()
    `);

    const html = await page.content();
    return { html };
  },
};
