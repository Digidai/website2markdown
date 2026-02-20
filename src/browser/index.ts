import puppeteer from "@cloudflare/puppeteer";
import type { Env, SiteAdapter } from "../types";
import {
  BROWSER_CONCURRENCY,
  BROWSER_TIMEOUT,
  FEISHU_BROWSER_TIMEOUT,
  FEISHU_SCROLL_BUDGET,
  FEISHU_SETTLE_WAIT,
  FEISHU_SCROLL_STEP,
  FEISHU_SCROLL_DELAY,
  FEISHU_STALE_LIMIT,
  FEISHU_MAX_CAPTURED_IMAGES,
  IMAGE_MIN_BYTES,
  IMAGE_MAX_BYTES,
} from "../config";
import { isSafeUrl, escapeHtml } from "../security";
import { storeImage } from "../cache";

// Adapter registry for non-Feishu sites
import { wechatAdapter } from "./adapters/wechat";
import { zhihuAdapter } from "./adapters/zhihu";
import { yuqueAdapter } from "./adapters/yuque";
import { notionAdapter } from "./adapters/notion";
import { juejinAdapter } from "./adapters/juejin";
import { genericAdapter } from "./adapters/generic";
// Feishu has its own dedicated function (not adapter-based)
import { feishuAdapter } from "./adapters/feishu";

const BROWSER_QUEUE_TIMEOUT_MS = 10_000;
const BROWSER_CLOSE_TIMEOUT_MS = 5000;
const LOW_VALUE_RESOURCE_TYPES = new Set([
  "font",
  "manifest",
  "media",
  "texttrack",
]);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Browser rendering aborted by client disconnect.");
  }
}

async function withTimeoutAndAbort<T>(
  task: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  abortSignal?: AbortSignal,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    if (abortSignal) {
      abortListener = () =>
        reject(new Error("Browser rendering aborted by client disconnect."));
      if (abortSignal.aborted) {
        abortListener();
        return;
      }
      abortSignal.addEventListener("abort", abortListener, { once: true });
    }
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (abortSignal && abortListener) {
      abortSignal.removeEventListener("abort", abortListener);
    }
  }
}

async function launchBrowser(env: Env): Promise<any> {
  try {
    return await puppeteer.launch(env.MYBROWSER);
  } catch (error) {
    throw new Error(`Browser launch failed: ${errorMessage(error)}`);
  }
}

async function closeBrowserSafely(browser: any | null): Promise<void> {
  if (!browser) return;
  try {
    await withTimeoutAndAbort(
      browser.close(),
      BROWSER_CLOSE_TIMEOUT_MS,
      "Browser close timed out.",
    );
  } catch (error) {
    console.error("Browser close error:", errorMessage(error));
  }
}

type PermitRelease = () => void;

interface QueueEntry {
  timer: ReturnType<typeof setTimeout>;
  resolve: (release: PermitRelease) => void;
}

/**
 * Global in-memory concurrency gate for browser rendering.
 * Shared across requests within the same worker isolate.
 */
export class BrowserCapacityGate {
  private readonly maxConcurrent: number;
  private readonly queueTimeoutMs: number;
  private readonly now: () => number;
  private active = 0;
  private readonly queue: QueueEntry[] = [];

  constructor(
    maxConcurrent: number,
    queueTimeoutMs: number,
    now: () => number = () => Date.now(),
  ) {
    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
      throw new Error("BrowserCapacityGate maxConcurrent must be >= 1");
    }
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 1) {
      throw new Error("BrowserCapacityGate queueTimeoutMs must be >= 1");
    }
    this.maxConcurrent = Math.floor(maxConcurrent);
    this.queueTimeoutMs = Math.floor(queueTimeoutMs);
    this.now = now;
  }

  getActiveCount(): number {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  async acquire(label: string = "unknown"): Promise<PermitRelease> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return this.createRelease();
    }

    return new Promise<PermitRelease>((resolve, reject) => {
      const enqueuedAt = this.now();
      const entry = {} as QueueEntry;
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx >= 0) this.queue.splice(idx, 1);
        const waitedMs = this.now() - enqueuedAt;
        reject(
          new Error(
            `Browser rendering queue timeout after ${waitedMs}ms (limit=${this.maxConcurrent}, queued_url=${label})`,
          ),
        );
      }, this.queueTimeoutMs);

      entry.timer = timer;
      entry.resolve = resolve;
      this.queue.push(entry);
    });
  }

  async run<T>(task: () => Promise<T>, label: string = "unknown"): Promise<T> {
    const release = await this.acquire(label);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private createRelease(): PermitRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.drainQueue();
    };
  }

  private drainQueue(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) return;
      clearTimeout(entry.timer);
      this.active++;
      entry.resolve(this.createRelease());
    }
  }
}

const browserCapacityGate = new BrowserCapacityGate(
  BROWSER_CONCURRENCY,
  BROWSER_QUEUE_TIMEOUT_MS,
);

function handleInterceptedRequest(req: any): void {
  const reqUrl = req.url();
  if (!isSafeUrl(reqUrl)) {
    req.abort("accessdenied");
    return;
  }
  const resourceType = typeof req.resourceType === "function" ? req.resourceType() : "";
  if (LOW_VALUE_RESOURCE_TYPES.has(resourceType)) {
    req.abort("blockedbyclient");
    return;
  }
  req.continue();
}

const adapters: SiteAdapter[] = [
  feishuAdapter,
  wechatAdapter,
  zhihuAdapter,
  yuqueAdapter,
  notionAdapter,
  juejinAdapter,
  genericAdapter, // Must be last
];

/** Find the matching adapter for a URL. */
export function getAdapter(url: string): SiteAdapter {
  for (const adapter of adapters) {
    if (adapter.match(url)) return adapter;
  }
  return genericAdapter;
}

/** Check if a URL always needs browser rendering. */
export function alwaysNeedsBrowser(url: string): boolean {
  const adapter = getAdapter(url);
  return adapter.alwaysBrowser;
}

/**
 * Fetch a URL using headless Chrome via Cloudflare Browser Rendering.
 * Uses dedicated logic for Feishu (virtual scroll + image capture),
 * and the adapter pattern for all other sites.
 */
export async function fetchWithBrowser(
  url: string,
  env: Env,
  host: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  return browserCapacityGate.run(async () => {
    throwIfAborted(abortSignal);
    if (feishuAdapter.match(url)) {
      return fetchWithBrowserFeishu(url, env, host, abortSignal);
    }
    return fetchWithBrowserAdapter(url, env, abortSignal);
  }, url);
}

/**
 * Feishu-specific browser rendering.
 * Uses the proven original approach: inline evaluate template literal
 * for virtual scroll content extraction + response-level image capture.
 * Images are stored in R2 and referenced via /r2img/ URLs.
 */
async function fetchWithBrowserFeishu(
  url: string,
  env: Env,
  host: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  let browser: any | null = null;
  try {
    browser = await launchBrowser(env);
    throwIfAborted(abortSignal);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });

    // SSRF protection — set up handler before enabling interception
    page.on("request", handleInterceptedRequest);
    await page.setRequestInterception(true);

    // Capture image responses during page load (Feishu tokens are single-use,
    // so a second fetch() for the same URL will fail).
    const capturedImages = new Map<string, string>();
    let capturedImageCount = 0;
    const pendingCaptures: Promise<void>[] = [];
    page.on("response", (resp: any) => {
      const p = (async () => {
        let reservedSlot = false;
        let stored = false;
        try {
          if (resp.status() !== 200) return;
          const rUrl: string = resp.url();
          const ct: string = resp.headers()["content-type"] || "";
          if (ct.includes("svg")) return;
          if (!ct.includes("image")) {
            // Only accept octet-stream from Feishu download endpoints
            if (!ct.includes("octet-stream") || !rUrl.includes("/space/api/box/stream/download/")) return;
          }
          if (capturedImages.has(rUrl)) return;
          if (capturedImageCount >= FEISHU_MAX_CAPTURED_IMAGES) return;
          capturedImageCount++;
          reservedSlot = true;
          const buf = await resp.buffer();
          if (buf.length < IMAGE_MIN_BYTES || buf.length > IMAGE_MAX_BYTES) return;
          // Store in R2 instead of base64 data URI
          try {
            const key = await storeImage(env, rUrl, new Uint8Array(buf), ct.split(";")[0].trim() || "image/png");
            const r2Url = `https://${host}/r2img/${key}`;
            capturedImages.set(rUrl, r2Url);
            try {
              capturedImages.set(new URL(rUrl).pathname, r2Url);
            } catch {}
            stored = true;
          } catch {
            // R2 store failed — fall back to data URI
            // Use chunked conversion to avoid O(n²) string concatenation
            const bytes = new Uint8Array(buf);
            const CHUNK = 8192;
            const chunks: string[] = [];
            for (let i = 0; i < bytes.length; i += CHUNK) {
              chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
            }
            const mime = ct.split(";")[0].trim() || "image/png";
            const dataUrl = `data:${mime};base64,${btoa(chunks.join(""))}`;
            capturedImages.set(rUrl, dataUrl);
            try {
              capturedImages.set(new URL(rUrl).pathname, dataUrl);
            } catch {}
            stored = true;
          }
        } catch {
        } finally {
          if (reservedSlot && !stored) capturedImageCount--;
        }
      })();
      pendingCaptures.push(p);
    });

    await withTimeoutAndAbort(
      page.goto(url, { waitUntil: "networkidle2", timeout: FEISHU_BROWSER_TIMEOUT }),
      FEISHU_BROWSER_TIMEOUT + 2000,
      "Browser navigation timed out.",
      abortSignal,
    );
    await new Promise((r) => setTimeout(r, FEISHU_SETTLE_WAIT));

    // Pre-scroll using Puppeteer keyboard to trigger Feishu's virtual scroll.
    // This is more reliable than scrollTo() inside evaluate because it triggers
    // the browser's native scrolling which Feishu's IntersectionObserver detects.
    try {
      // Click on the page to ensure it has focus
      await page.click("body").catch(() => {});
      // Use keyboard Page Down to scroll through the entire document
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("PageDown");
        await new Promise((r) => setTimeout(r, 500));
      }
      // Scroll back to top
      await page.keyboard.press("Home");
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      // Scroll failed, continue with what we have
    }

    // CRITICAL: The evaluate script MUST be a single inline template literal
    // passed directly to page.evaluate(). Storing it in a variable and
    // interpolating it causes double-escaping issues that silently break
    // text collection.
    throwIfAborted(abortSignal);
    const content = await withTimeoutAndAbort(page.evaluate(`
      (async function() {
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

        // 4. DON'T disable virtual scroll yet — let it work during scrolling
        // so that new content is rendered as we scroll through the page.
        // We'll disable it AFTER the scroll pass for a final harvest.
        await new Promise(function(r) { setTimeout(r, 1000); });

        // 5. Filters
        var uiStrings = [
          'Help Center', 'Keyboard Shortcuts', 'Shared With Me',
          'Last updated', 'Modified', 'Last modified', 'Share', 'Copy Link',
          'More', 'Comments', 'Table of Contents', 'Getting Started',
          'Created by', 'Feishu Docs', 'Wiki', 'Lark Docs',
          'Open in App', 'Download App'
        ];

        function isUiText(text) {
          for (var i = 0; i < uiStrings.length; i++) {
            if (text === uiStrings[i]) return true;
            if (text.length < 30 && text.indexOf(uiStrings[i]) !== -1) return true;
          }
          // Skip date-only strings
          if (text.length < 20 && text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d/)) return true;
          if (text.length < 30 && text.match(/^Modified\\s/)) return true;
          if (text.length < 30 && text.match(/^\\d{4}[-/]\\d{2}[-/]\\d{2}/)) return true;
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

        // Block-level tag names for tree-walking
        var BLOCK_TAGS = {div:1, p:1, h1:1, h2:1, h3:1, h4:1, h5:1, h6:1,
          li:1, blockquote:1, pre:1, figure:1, section:1, article:1, ul:1, ol:1};

        function processImage(imgEl) {
          if (!isContentImage(imgEl)) return;
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

        // Recursively walk the DOM tree collecting text from leaf blocks
        function harvestNode(el) {
          if (!el || !el.tagName) return;
          var tag = el.tagName.toLowerCase();

          // Handle images
          if (tag === 'img') {
            processImage(el);
            return;
          }

          // Handle figure / image containers
          if (tag === 'figure' || (el.className && el.className.indexOf('image') !== -1)) {
            var imgEl = el.querySelector('img');
            if (imgEl) processImage(imgEl);
            // Also check for caption text
            var caption = el.querySelector('figcaption');
            if (caption) {
              var capText = caption.textContent.trim();
              if (capText.length >= 2 && !seenText.has(capText)) {
                seenText.add(capText);
                collected.push(capText);
              }
            }
            return;
          }

          // Check if this element has child block-level elements
          var hasChildBlocks = false;
          for (var i = 0; i < el.children.length; i++) {
            var childTag = el.children[i].tagName.toLowerCase();
            if (BLOCK_TAGS[childTag]) {
              hasChildBlocks = true;
              break;
            }
          }

          if (hasChildBlocks) {
            // Container — recurse into children
            for (var i = 0; i < el.children.length; i++) {
              harvestNode(el.children[i]);
            }
          } else {
            // Leaf block — collect text and images
            // First handle any images
            el.querySelectorAll('img').forEach(function(img) { processImage(img); });

            var text = el.textContent.trim();
            if (text.length < 2 || seenText.has(text)) return;
            if (isUiText(text)) return;
            seenText.add(text);

            // Detect heading (element itself or child heading)
            var headingEl = tag.match(/^h[1-6]$/) ? el : el.querySelector('h1, h2, h3, h4, h5, h6');
            if (headingEl) {
              var hTag = (headingEl.tagName || tag).toLowerCase();
              var level = hTag.charAt(1);
              var prefix = '';
              for (var j = 0; j < parseInt(level); j++) prefix += '#';
              collected.push(prefix + ' ' + text);
            } else if (tag === 'li') {
              collected.push('- ' + text);
            } else if (tag === 'blockquote' || (el.className && el.className.indexOf('quote') !== -1)) {
              collected.push('> ' + text);
            } else if (tag === 'pre' || (el.className && el.className.indexOf('code') !== -1)) {
              collected.push('\\n\`\`\`\\n' + text + '\\n\`\`\`\\n');
            } else {
              collected.push(text);
            }
          }
        }

        function harvest() {
          var scope = contentRoot || document;

          // Swap lazy-loaded images
          scope.querySelectorAll('img').forEach(function(img) {
            var real = img.getAttribute('data-src') || img.getAttribute('data-origin-src') || img.getAttribute('data-original');
            if (real && (!img.getAttribute('src') || img.getAttribute('src').indexOf('data:') === 0)) {
              img.setAttribute('src', real);
            }
          });

          // Walk the content tree recursively to collect text from leaf blocks
          harvestNode(scope);
        }

        // 6. Scroll through page to trigger virtual scroll rendering
        var scrollStartTime = Date.now();
        var scrollBudget = ${FEISHU_SCROLL_BUDGET};
        var y = 0;
        var prevCollected = 0;
        var staleCount = 0;

        while (y < 999999 && Date.now() - scrollStartTime < scrollBudget) {
          // Re-check scroll height each iteration (it may grow as content loads)
          var curH = Math.max(scrollEl.scrollHeight, document.body.scrollHeight, 8000);
          if (y >= curH + 500) break;

          scrollEl.scrollTop = y;
          window.scrollTo(0, y);
          // Dispatch scroll events to trigger various rendering mechanisms
          try {
            scrollEl.dispatchEvent(new Event('scroll', {bubbles: true}));
            window.dispatchEvent(new Event('scroll'));
          } catch(e) {}
          await new Promise(function(r) { setTimeout(r, ${FEISHU_SCROLL_DELAY}); });
          harvest();

          // Check if we found new content
          if (collected.length === prevCollected) {
            staleCount++;
            if (staleCount > ${FEISHU_STALE_LIMIT}) break;
          } else {
            staleCount = 0;
            prevCollected = collected.length;
          }

          y += ${FEISHU_SCROLL_STEP};
        }

        // Final scroll to bottom
        scrollEl.scrollTop = 999999;
        window.scrollTo(0, 999999);
        try { scrollEl.dispatchEvent(new Event('scroll', {bubbles: true})); } catch(e) {}
        await new Promise(function(r) { setTimeout(r, 800); });
        harvest();

        // 7. NOW disable virtual scroll for a final complete harvest
        document.querySelectorAll('[style*="overflow"]').forEach(function(c) {
          if (c.scrollHeight > c.clientHeight) {
            c.style.overflow = 'visible';
            c.style.maxHeight = 'none';
            c.style.height = 'auto';
          }
        });
        await new Promise(function(r) { setTimeout(r, 1500); });
        // Scroll back to top and harvest everything that's now visible
        scrollEl.scrollTop = 0;
        window.scrollTo(0, 0);
        await new Promise(function(r) { setTimeout(r, 500); });
        harvest();

        return { text: collected.join('\\n\\n'), images: imgUrls };
      })()
    `), FEISHU_BROWSER_TIMEOUT + 3000, "Browser content extraction timed out.", abortSignal);

    // Wait for all pending image capture handlers to complete
    await Promise.allSettled(pendingCaptures);

    const feishuResult = content as { text?: string; images?: string[] } | null;
    if (feishuResult && feishuResult.text && feishuResult.text.length > 100) {
      const titleRaw = await withTimeoutAndAbort<string>(
        page.title() as Promise<string>,
        5000,
        "Browser title extraction timed out.",
        abortSignal,
      );
      const title = typeof titleRaw === "string" ? titleRaw : "";

      // Resolve image URL to captured R2 URL (or fallback to original)
      function resolveImage(rawUrl: string): string {
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

      // Find captured content images that the evaluate missed (e.g. the
      // first image is inside a <header> that noise-removal deletes).
      const usedPathnames = new Set<string>();
      for (const imgUrl of feishuResult.images || []) {
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

      let html = `<html><head><title>${escapeHtml(title)}</title></head><body>`;
      html += `<h1>${escapeHtml(title)}</h1>`;

      // Prepend missing images before the main content
      for (const missUrl of missingImages) {
        const src = resolveImage(missUrl);
        html += `<figure><img src="${escapeHtml(src)}" /></figure>\n`;
      }

      const imgMarkerRe = /^\{\{IMG:(.+)\}\}$/;
      html += feishuResult.text
        .split("\n\n")
        .map((block: string) => {
          const imgMatch = block.match(imgMarkerRe);
          if (imgMatch) {
            const src = resolveImage(imgMatch[1]);
            return `<figure><img src="${escapeHtml(src)}" /></figure>`;
          }
          // Parse heading markers into proper HTML heading tags
          const headingMatch = block.match(/^(#{1,6})\s+(.+)$/);
          if (headingMatch) {
            const level = headingMatch[1].length;
            return `<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`;
          }
          return `<p>${escapeHtml(block)}</p>`;
        })
        .join("\n");
      html += `</body></html>`;
      return html;
    }

    // Fallback: return raw page content
    const html = await withTimeoutAndAbort<string>(
      page.content() as Promise<string>,
      BROWSER_TIMEOUT,
      "Browser page content read timed out.",
      abortSignal,
    );
    return html;
  } catch (error) {
    throw new Error(`Browser rendering failed: ${errorMessage(error)}`);
  } finally {
    await closeBrowserSafely(browser);
  }
}

/**
 * Adapter-based browser rendering for non-Feishu sites.
 */
async function fetchWithBrowserAdapter(
  url: string,
  env: Env,
  abortSignal?: AbortSignal,
): Promise<string> {
  const adapter = getAdapter(url);
  const capturedImages = new Map<string, string>();
  // Pass the original URL so adapters can use it for retries/warm-up.
  capturedImages.set("__targetUrl__", url);

  let browser: any | null = null;
  try {
    browser = await launchBrowser(env);
    throwIfAborted(abortSignal);

    const page = await browser.newPage();

    // Configure page for this site
    await adapter.configurePage(page, capturedImages);

    // SSRF protection — set up handler before enabling interception
    page.on("request", handleInterceptedRequest);
    await page.setRequestInterception(true);

    // Navigate — use "load" instead of "networkidle2" because some sites
    // (e.g. Zhihu) serve a JS challenge that triggers a client-side redirect.
    // With "networkidle2", goto resolves on the challenge page, then the
    // redirect destroys the execution context. Using "load" + letting the
    // adapter handle waiting for final content is more resilient.
    try {
      await withTimeoutAndAbort(
        page.goto(url, {
          waitUntil: "load",
          timeout: BROWSER_TIMEOUT,
        }),
        BROWSER_TIMEOUT + 2000,
        "Browser navigation timed out.",
        abortSignal,
      );
    } catch (error) {
      // "Execution context was destroyed" means a navigation (e.g. challenge
      // redirect) happened during goto — this is expected for some sites.
      const msg = errorMessage(error);
      if (!msg.includes("xecution context") && !msg.includes("navigat")) {
        throw error;
      }
      // Wait briefly for the new page to settle after redirect
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Let adapter extract content
    const result = await withTimeoutAndAbort(
      adapter.extract(page, capturedImages),
      BROWSER_TIMEOUT + 3000,
      "Browser content extraction timed out.",
      abortSignal,
    );
    if (result?.html) {
      return result.html;
    }

    // Fallback: return raw page content
    const html = await withTimeoutAndAbort<string>(
      page.content() as Promise<string>,
      BROWSER_TIMEOUT,
      "Browser page content read timed out.",
      abortSignal,
    );
    return html;
  } catch (error) {
    throw new Error(`Browser rendering failed: ${errorMessage(error)}`);
  } finally {
    await closeBrowserSafely(browser);
  }
}
