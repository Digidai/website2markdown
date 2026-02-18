import type { SiteAdapter, ExtractResult } from "../../types";
import {
  FEISHU_SETTLE_WAIT,
  FEISHU_SCROLL_BUDGET,
  FEISHU_SCROLL_STEP,
  FEISHU_SCROLL_DELAY,
  IMAGE_MIN_BYTES,
  IMAGE_MAX_BYTES,
} from "../../config";

export const feishuAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes(".feishu.cn/") || url.includes(".larksuite.com/");
  },

  alwaysBrowser: true,

  async configurePage(page: any, capturedImages?: Map<string, string>): Promise<void> {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });
    // Set up image capture BEFORE navigation (Feishu tokens are single-use)
    if (capturedImages) {
      setupImageCapture(page, capturedImages);
    }
  },

  async extract(
    page: any,
    capturedImages: Map<string, string>,
  ): Promise<ExtractResult | null> {
    // Image capture was already set up in configurePage() (before navigation).
    // The launcher already called page.goto() and waited for networkidle2.
    await new Promise((r) => setTimeout(r, FEISHU_SETTLE_WAIT));

    const content = await page.evaluate(
      `(${feishuEvaluateScript})(${FEISHU_SCROLL_BUDGET}, ${FEISHU_SCROLL_STEP}, ${FEISHU_SCROLL_DELAY})`,
    );

    // Wait for pending response handlers to finish
    await new Promise((r) => setTimeout(r, 1000));

    const result = content as { text?: string; images?: string[] } | null;
    if (!result?.text || result.text.length <= 100) return null;

    const title = await page.title();

    // Find captured images that the evaluate missed (e.g. first image in <header>)
    const usedPathnames = new Set<string>();
    for (const imgUrl of result.images || []) {
      try {
        usedPathnames.add(new URL(imgUrl).pathname);
      } catch {}
    }
    const missingImages: string[] = [];
    for (const [key] of capturedImages) {
      if (!key.startsWith("http")) continue;
      if (!key.includes("/space/api/box/stream/download/")) continue;
      try {
        const p = new URL(key).pathname;
        if (!usedPathnames.has(p)) {
          usedPathnames.add(p);
          missingImages.push(key);
        }
      } catch {}
    }

    // Build HTML with resolved images
    let html = `<html><head><title>${escapeTitle(title)}</title></head><body>`;
    html += `<h1>${escapeTitle(title)}</h1>`;

    // Prepend missing images
    for (const missUrl of missingImages) {
      const src = resolveImage(missUrl, capturedImages);
      html += `<figure><img src="${src}" /></figure>\n`;
    }

    const imgMarkerRe = /^\{\{IMG:(.+)\}\}$/;
    html += result.text
      .split("\n\n")
      .map((block: string) => {
        const imgMatch = block.match(imgMarkerRe);
        if (imgMatch) {
          const src = resolveImage(imgMatch[1], capturedImages);
          return `<figure><img src="${src}" /></figure>`;
        }
        if (block.startsWith("#")) return `<p>${block}</p>`;
        return `<p>${block}</p>`;
      })
      .join("\n");
    html += `</body></html>`;

    return { html, images: result.images };
  },
};

function escapeTitle(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveImage(
  rawUrl: string,
  capturedImages: Map<string, string>,
): string {
  const exact = capturedImages.get(rawUrl);
  if (exact) return exact;
  try {
    const pathMatch = capturedImages.get(new URL(rawUrl).pathname);
    if (pathMatch) return pathMatch;
  } catch {}
  try {
    const path = new URL(rawUrl).pathname;
    for (const [key, val] of capturedImages) {
      if (key.includes(path) || path.includes(key)) return val;
    }
  } catch {}
  return rawUrl;
}

function setupImageCapture(
  page: any,
  capturedImages: Map<string, string>,
): void {
  page.on("response", async (resp: any) => {
    try {
      if (resp.status() !== 200) return;
      const rUrl: string = resp.url();
      const ct: string = resp.headers()["content-type"] || "";
      if (ct.includes("svg")) return;
      if (!ct.includes("image") && !ct.includes("octet-stream")) return;
      const buf = await resp.buffer();
      if (buf.length < IMAGE_MIN_BYTES || buf.length > IMAGE_MAX_BYTES)
        return;
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const mime = ct.split(";")[0].trim() || "image/png";
      const dataUrl = `data:${mime};base64,${btoa(binary)}`;
      capturedImages.set(rUrl, dataUrl);
      try {
        capturedImages.set(new URL(rUrl).pathname, dataUrl);
      } catch {}
    } catch (e) {
      console.error("Feishu image capture error:", e instanceof Error ? e.message : e);
    }
  });
}

/**
 * This function runs inside the browser via page.evaluate().
 * It must be self-contained (no external references).
 * Parameters are injected: scrollBudget, scrollStep, scrollDelay.
 */
const feishuEvaluateScript = `async function(scrollBudget, scrollStep, scrollDelay) {
  // 1. Remove Feishu UI noise
  var uiNoise = [
    'nav', 'header', 'footer',
    '[class*="sidebar"]', '[class*="Sidebar"]', '[class*="side-bar"]',
    '[class*="catalog"]', '[class*="Catalog"]',
    '[class*="header-bar"]', '[class*="HeaderBar"]',
    '[class*="help-center"]', '[class*="HelpCenter"]',
    '[class*="shortcut"]', '[class*="Shortcut"]',
    '[class*="share-"]', '[class*="comment-"]', '[class*="Comment"]',
    '[class*="navigation"]', '[class*="Navigation"]',
    '[class*="breadcrumb"]', '[class*="Breadcrumb"]',
    '[class*="toast"]', '[class*="Toast"]',
    '[class*="modal"]', '[class*="Modal"]',
    '[class*="toolbar"]', '[class*="Toolbar"]',
    '[class*="suite-header"]', '[class*="lark-header"]',
    '[class*="reaction"]', '[class*="Reaction"]',
    '[class*="emoji-panel"]', '[class*="quick-action"]',
    '[class*="doc-meta"]', '[class*="last-edit"]',
    '[class*="wiki-header"]', '[class*="wiki-nav"]'
  ];
  uiNoise.forEach(function(sel) {
    try { document.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(e) {}
  });

  // 2. Find content container
  var contentRoot =
    document.querySelector('[data-content-editable-root="true"]') ||
    document.querySelector('[class*="wiki-content"]') ||
    document.querySelector('[class*="docx-content"]') ||
    document.querySelector('[class*="doc-reader-content"]') ||
    document.querySelector('.wiki-docs-reader') ||
    document.querySelector('[class*="page-content"]') ||
    document.querySelector('article') ||
    document.body;

  // 3. Find scrollable ancestor
  var scrollEl = null;
  var el = contentRoot;
  while (el && el !== document.body) {
    var style = window.getComputedStyle(el);
    var ov = style.overflow + style.overflowY;
    if ((ov.indexOf('auto') !== -1 || ov.indexOf('scroll') !== -1) && el.scrollHeight > el.clientHeight + 100) {
      scrollEl = el;
      break;
    }
    el = el.parentElement;
  }
  if (!scrollEl) {
    scrollEl = document.querySelector('[class*="docx-scroller"]') ||
      document.querySelector('[class*="scroll"]') || document.documentElement;
  }

  // 4. Disable virtual scroll
  document.querySelectorAll('[style*="overflow"]').forEach(function(c) {
    if (c.scrollHeight > c.clientHeight) {
      c.style.overflow = 'visible';
      c.style.maxHeight = 'none';
      c.style.height = 'auto';
    }
  });
  await new Promise(function(r) { setTimeout(r, 2000); });

  // 5. Filters
  var uiStrings = [
    'Help Center', 'Keyboard Shortcuts', 'Shared With Me',
    'Last updated', 'Share', 'Copy Link', 'More', 'Comments',
    'Table of Contents', 'Getting Started', 'Created by',
    'Feishu Docs', 'Wiki', 'Lark Docs'
  ];

  function isUiText(text) {
    for (var i = 0; i < uiStrings.length; i++) {
      if (text === uiStrings[i]) return true;
      if (text.length < 30 && text.indexOf(uiStrings[i]) !== -1) return true;
    }
    if (text.length < 20 && text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d/)) return true;
    return false;
  }

  function isContentImage(img) {
    var w = img.naturalWidth || parseInt(img.getAttribute('width')) || 0;
    var h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
    if (w > 0 && w < 80) return false;
    if (h > 0 && h < 80) return false;
    var cls = (img.className || '').toLowerCase();
    if (cls.indexOf('emoji') !== -1 || cls.indexOf('reaction') !== -1 ||
        cls.indexOf('sticker') !== -1 || cls.indexOf('icon') !== -1 ||
        cls.indexOf('avatar') !== -1) return false;
    var src = img.getAttribute('src') || '';
    if (src.indexOf('data:image/svg') === 0) return false;
    return true;
  }

  var collected = [];
  var seenText = new Set();
  var imgUrls = [];

  function harvest() {
    var scope = contentRoot || document;

    scope.querySelectorAll('img').forEach(function(img) {
      var real = img.getAttribute('data-src') || img.getAttribute('data-origin-src') || img.getAttribute('data-original');
      if (real && (!img.getAttribute('src') || img.getAttribute('src').indexOf('data:') === 0)) {
        img.setAttribute('src', real);
      }
    });

    var blocks = scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, img, figure, [class*="image-block"]');
    blocks.forEach(function(b) {
      var tag = b.tagName.toLowerCase();

      if (tag === 'img') {
        if (!isContentImage(b)) return;
        var src = b.getAttribute('src') || b.getAttribute('data-src') || '';
        if (!src || src.indexOf('data:') === 0) return;
        var pathKey = '';
        try { pathKey = new URL(src, location.href).pathname; } catch(e) {}
        var key = pathKey || src;
        if (!seenText.has('IMG:' + key)) {
          seenText.add('IMG:' + key);
          imgUrls.push(src);
          collected.push('{{IMG:' + src + '}}');
        }
        return;
      }

      if (tag === 'figure' || (b.className && b.className.indexOf('image') !== -1)) {
        var imgEl = b.querySelector('img');
        if (imgEl && isContentImage(imgEl)) {
          var src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
          if (!src || src.indexOf('data:') === 0) return;
          var pathKey = '';
          try { pathKey = new URL(src, location.href).pathname; } catch(e) {}
          var key = pathKey || src;
          if (!seenText.has('IMG:' + key)) {
            seenText.add('IMG:' + key);
            imgUrls.push(src);
            collected.push('{{IMG:' + src + '}}');
          }
        }
        return;
      }

      var text = b.textContent.trim();
      if (text.length < 2 || seenText.has(text)) return;
      if (isUiText(text)) return;
      seenText.add(text);

      if (tag.match(/^h[1-6]$/)) {
        var level = tag.charAt(1);
        var prefix = '';
        for (var j = 0; j < parseInt(level); j++) prefix += '#';
        collected.push(prefix + ' ' + text);
      } else if (tag === 'li') {
        collected.push('- ' + text);
      } else if (tag === 'blockquote') {
        collected.push('> ' + text);
      } else if (tag === 'pre') {
        collected.push('\\n\\\`\\\`\\\`\\n' + text + '\\n\\\`\\\`\\\`\\n');
      } else {
        collected.push(text);
      }
    });
  }

  // 6. Scroll and harvest with time budget
  var startTime = Date.now();
  var totalH = Math.max(scrollEl.scrollHeight, document.body.scrollHeight, 8000);
  for (var y = 0; y < totalH; y += scrollStep) {
    if (Date.now() - startTime > scrollBudget) break;
    scrollEl.scrollTop = y;
    window.scrollTo(0, y);
    await new Promise(function(r) { setTimeout(r, scrollDelay); });
    harvest();
  }
  scrollEl.scrollTop = 999999;
  window.scrollTo(0, 999999);
  await new Promise(function(r) { setTimeout(r, 500); });
  harvest();

  return { text: collected.join('\\n\\n'), images: imgUrls };
}`;
