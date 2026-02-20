import { DESKTOP_UA } from "../config";

/**
 * Shared stealth JavaScript to patch headless browser fingerprints.
 * Injected via page.evaluateOnNewDocument() before page loads.
 */
export const STEALTH_SCRIPT = `
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
`;

/**
 * Apply stealth patches and desktop viewport/UA to a Puppeteer page.
 */
export async function applyStealthAndDesktop(page: any): Promise<void> {
  await page.setUserAgent(DESKTOP_UA);
  await page.setViewport({ width: 1280, height: 900 });
  await page.setExtraHTTPHeaders({
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  });
  await page.evaluateOnNewDocument(STEALTH_SCRIPT);
}
