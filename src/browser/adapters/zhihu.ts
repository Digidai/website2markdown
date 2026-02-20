import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";

/** Max time to wait for article content after challenge redirect (ms). */
const ZHIHU_CONTENT_TIMEOUT = 15_000;

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
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });

    // Anti-detection: patch headless browser fingerprints before page loads.
    await page.evaluateOnNewDocument(`
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          var arr = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
          ];
          arr.item = function(i) { return this[i] || null; };
          arr.namedItem = function(n) { for (var i = 0; i < this.length; i++) if (this[i].name === n) return this[i]; return null; };
          arr.refresh = function() {};
          return arr;
        }
      });
      window.chrome = {
        runtime: { onConnect: null, onMessage: null, connect: function() {}, sendMessage: function() {} },
        loadTimes: function() { return {}; },
        csi: function() { return {}; }
      };
      var origQuery = navigator.permissions && navigator.permissions.query
        ? navigator.permissions.query.bind(navigator.permissions) : null;
      Object.defineProperty(navigator, 'permissions', {
        get: () => ({
          query: function(params) {
            if (params.name === 'notifications') return Promise.resolve({ state: 'denied', onchange: null });
            if (origQuery) return origQuery(params);
            return Promise.resolve({ state: 'prompt', onchange: null });
          }
        })
      });
      (function() {
        for (var prop in window) {
          if (prop.match && prop.match(/^([\\$_]*(cdc|driver|selenium|webdriver))/i)) {
            try { delete window[prop]; } catch(e) {}
          }
        }
      })();
      var origToString = Function.prototype.toString;
      Function.prototype.toString = function() {
        if (this === Function.prototype.toString) return 'function toString() { [native code] }';
        return origToString.call(this);
      };
    `);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Zhihu uses a ZSE JS challenge that redirects based on IP reputation.
    // Datacenter IPs (like Cloudflare) get redirected to a login page.
    // Wait for either article content or the login redirect to settle.
    try {
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: ZHIHU_CONTENT_TIMEOUT });
    } catch {
      // Content didn't appear — check what page we're on
      let currentUrl = "";
      try { currentUrl = await page.evaluate("location.href"); } catch {}

      if (currentUrl.includes("unhuman") || currentUrl.includes("signin")) {
        throw new Error(
          "知乎要求登录验证，无法从云端服务器访问。" +
          "知乎会对数据中心 IP 地址强制要求登录，此限制暂时无法绕过。",
        );
      }

      throw new Error("Zhihu page did not load article content within timeout.");
    }

    // Brief settle time for SPA hydration
    await new Promise((r) => setTimeout(r, 1500));

    // Check for anti-bot block
    const blocked = await page.evaluate(`
      (function() {
        var text = document.body ? document.body.innerText : '';
        return text.indexOf('请求存在异常') !== -1 || text.indexOf('限制本次访问') !== -1;
      })()
    `);
    if (blocked) {
      throw new Error(
        "知乎反爬机制已触发，暂时无法访问该页面。",
      );
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
