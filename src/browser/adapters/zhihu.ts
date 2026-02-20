import type { SiteAdapter, ExtractResult } from "../../types";
import { DESKTOP_UA } from "../../config";

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
    // Zhihu uses ZSE (Zhihu Security Engine) JS challenge that fingerprints
    // the browser environment. We must hide all headless indicators.
    await page.evaluateOnNewDocument(`
      // 1. Hide webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // 2. Realistic navigator properties
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

      // 3. Fake plugins array (Chrome always has plugins)
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

      // 4. Chrome runtime object
      window.chrome = {
        runtime: { onConnect: null, onMessage: null, connect: function() {}, sendMessage: function() {} },
        loadTimes: function() { return {}; },
        csi: function() { return {}; }
      };

      // 5. Permissions API
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

      // 6. Remove CDP (Chrome DevTools Protocol) artifacts
      // Puppeteer injects variables starting with cdc_ or $cdc_ or __cdc
      (function removeCdcProps() {
        for (var prop in window) {
          if (prop.match && prop.match(/^([\\$_]*(cdc|driver|selenium|webdriver))/i)) {
            try { delete window[prop]; } catch(e) {}
          }
        }
      })();

      // 7. Override toString to hide native code modifications
      var origToString = Function.prototype.toString;
      var nativeCode = 'function toString() { [native code] }';
      Function.prototype.toString = function() {
        if (this === Function.prototype.toString) return nativeCode;
        return origToString.call(this);
      };
    `);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Zhihu uses a ZSE JS challenge: the initial page is a tiny challenge page
    // that sets cookies and then reloads to the actual content.
    // Detect the challenge page and wait for the redirect to complete.
    const isChallenge = await page.evaluate(
      `!!document.querySelector('#zh-zse-ck') || document.body.innerHTML.length < 1000`,
    );

    if (isChallenge) {
      try {
        // The challenge JS is running — wait for it to trigger a reload
        await page.waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 15000,
        });
      } catch {
        // Navigation might have already completed or timed out
      }
      // Wait for SPA content to render after challenge redirect
      await new Promise((r) => setTimeout(r, 3000));
    } else {
      // Not a challenge page — still wait for SPA render
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Check if Zhihu returned an anti-bot block or login-required page
    const pageState = await page.evaluate(`
      (function() {
        var text = document.body ? document.body.innerText : '';
        if (text.indexOf('请求存在异常') !== -1 || text.indexOf('限制本次访问') !== -1) return 'blocked';
        if (text.indexOf('安全验证') !== -1 && text.length < 500) return 'blocked';
        try {
          var json = JSON.parse(text.trim());
          if (json && json.error && json.error.code) return 'blocked';
        } catch(e) {}
        // Check if actual article content is present
        if (document.querySelector('.Post-RichTextContainer') ||
            document.querySelector('.RichContent-inner') ||
            document.querySelector('[class*="RichText"]') ||
            document.querySelector('article')) return 'content';
        if (document.querySelector('#zh-zse-ck')) return 'challenge_stuck';
        return 'unknown';
      })()
    `);

    if (pageState === "blocked" || pageState === "challenge_stuck") {
      throw new Error(
        "Zhihu anti-bot protection triggered. The page could not be accessed.",
      );
    }

    // Remove login walls, overlays, and clean up
    await page.evaluate(`
      (function() {
        // Remove login modal, overlays, and app download prompts
        var selectors = [
          '[class*="Modal"]', '[class*="signflow"]', '.OpenInAppButton',
          '[class*="CornerAnimay498"]', '.AppHeader-login', '[class*="Banner"]',
          '.ContentItem-expandButton', '[class*="RichContent-collapsed"]'
        ];
        selectors.forEach(function(sel) {
          try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
        });
        // Restore scrolling
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
        // Expand collapsed content
        document.querySelectorAll('.RichContent.is-collapsed').forEach(function(el) {
          el.classList.remove('is-collapsed');
          el.style.maxHeight = 'none';
        });
        // Swap lazy images
        document.querySelectorAll('img[data-original], img[data-actualsrc]').forEach(function(img) {
          var real = img.getAttribute('data-original') || img.getAttribute('data-actualsrc');
          if (real) img.setAttribute('src', real);
        });
        // Expand lazy-loaded noscript images
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
