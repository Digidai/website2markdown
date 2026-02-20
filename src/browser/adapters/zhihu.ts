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

  alwaysBrowser: false,

  async configurePage(page: any): Promise<void> {
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });

    // Anti-detection: patch headless browser fingerprints before page loads
    await page.evaluateOnNewDocument(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
      Object.defineProperty(navigator, 'permissions', {
        get: () => ({
          query: function(params) {
            return Promise.resolve({ state: params.name === 'notifications' ? 'denied' : 'granted' });
          }
        })
      });
    `);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    // Wait for Zhihu's SPA to render
    await new Promise((r) => setTimeout(r, 3000));

    // Check if Zhihu returned an anti-bot block page
    const blocked = await page.evaluate(`
      (function() {
        var text = document.body ? document.body.innerText : '';
        if (text.indexOf('请求存在异常') !== -1 || text.indexOf('限制本次访问') !== -1) return true;
        try {
          var json = JSON.parse(text);
          if (json && json.error && json.error.code) return true;
        } catch(e) {}
        return false;
      })()
    `);
    if (blocked) {
      throw new Error("Zhihu anti-bot protection triggered. The page could not be accessed.");
    }

    // Remove login walls, overlays, and clean up
    await page.evaluate(`
      (function() {
        // Remove login modal and overlays
        document.querySelectorAll('[class*="Modal"]').forEach(function(el) { el.remove(); });
        document.querySelectorAll('[class*="signflow"]').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.OpenInAppButton').forEach(function(el) { el.remove(); });
        // Restore scrolling
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
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
          if (img) ns.parentNode.insertBefore(img, ns);
        });
      })()
    `);

    const html = await page.content();
    return { html };
  },
};
