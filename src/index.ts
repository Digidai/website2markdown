import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import puppeteer from "@cloudflare/puppeteer";

interface Env {
  MYBROWSER: Fetcher;
}

// Module-level singleton — avoids re-creating on every request
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});
turndown.addRule("strikethrough", {
  filter: ["del", "s"],
  replacement: (content) => `~~${content}~~`,
});

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Sites that always need headless Chrome (JS-rendered content, cookie auth flows). */
function alwaysNeedsBrowser(url: string): boolean {
  if (url.includes("mp.weixin.qq.com")) return true;
  if (url.includes(".feishu.cn/")) return true;
  if (url.includes(".larksuite.com/")) return true;
  return false;
}

function needsBrowserRendering(html: string, url: string): boolean {
  const lower = html.toLowerCase();
  // Sites that always require browser rendering
  if (alwaysNeedsBrowser(url)) return true;
  // Common JS-challenge / CAPTCHA markers
  if (lower.includes("cf-challenge") || lower.includes("cf_chl_opt")) return true;
  if (lower.includes("captcha") && html.length < 10000) return true;
  // Very short page with JS redirect (likely anti-bot)
  if (html.length < 2000 && (lower.includes("document.location") || lower.includes("window.location"))) return true;
  return false;
}

// WeChat in-app browser UA — mp.weixin.qq.com checks for "MicroMessenger"
const WECHAT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2f) " +
  "NetType/WIFI Language/zh_CN";

// Generic mobile UA for other sites that block headless Chrome
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

async function fetchWithBrowser(url: string, env: Env, debug = false): Promise<string> {
  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    const isFeishu = url.includes(".feishu.cn/") || url.includes(".larksuite.com/");
    const isWechat = url.includes("mp.weixin.qq.com");

    // Feishu is a heavy SPA — use desktop viewport for full rendering.
    // WeChat needs mobile UA with MicroMessenger identifier.
    if (isWechat) {
      await page.setUserAgent(WECHAT_UA);
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    } else if (isFeishu) {
      await page.setViewport({ width: 1280, height: 900 });
    } else {
      await page.setUserAgent(MOBILE_UA);
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    }

    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });

    // P1 fix: intercept every request so redirects to private/internal
    // addresses are blocked, matching the SSRF protection on the static path.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const reqUrl = req.url();
      if (!isSafeUrl(reqUrl)) {
        req.abort("accessdenied");
      } else {
        req.continue();
      }
    });

    // Capture image responses during page load (Feishu tokens are single-use,
    // so a second fetch() for the same URL will fail).
    // Store by both full URL and pathname for fuzzy matching.
    const capturedImages = new Map<string, string>();
    if (isFeishu) {
      page.on("response", async (resp: any) => {
        try {
          if (resp.status() !== 200) return;
          const rUrl: string = resp.url();
          const ct: string = resp.headers()["content-type"] || "";
          // Skip non-image responses and SVGs (icons)
          if (ct.includes("svg")) return;
          if (!ct.includes("image") && !ct.includes("octet-stream")) return;
          const buf = await resp.buffer();
          // Skip tiny images (< 5KB = likely emoji/icon) and huge ones
          if (buf.length < 5000 || buf.length > 4 * 1024 * 1024) return;
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const mime = ct.split(";")[0].trim() || "image/png";
          const dataUrl = `data:${mime};base64,${btoa(binary)}`;
          capturedImages.set(rUrl, dataUrl);
          // Also store by pathname for fuzzy matching (evaluate may see different query params)
          try { capturedImages.set(new URL(rUrl).pathname, dataUrl); } catch {}
          // Store under all URLs in the redirect chain — the evaluate sees the
          // original pre-redirect URL while resp.url() is the final URL.
          try {
            const chain = resp.request().redirectChain();
            for (const req of chain) {
              const origUrl: string = req.url();
              capturedImages.set(origUrl, dataUrl);
              try { capturedImages.set(new URL(origUrl).pathname, dataUrl); } catch {}
            }
          } catch {}
          // Also store under the request URL (before redirect) if different from response URL
          try {
            const reqUrl: string = resp.request().url();
            if (reqUrl !== rUrl) {
              capturedImages.set(reqUrl, dataUrl);
              try { capturedImages.set(new URL(reqUrl).pathname, dataUrl); } catch {}
            }
          } catch {}
        } catch {}
      });
    }

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Feishu uses virtual scrolling — only visible content is in the DOM.
    // Scroll through the entire page and collect text at each position.
    if (isFeishu) {
      await new Promise((r) => setTimeout(r, 3000));

      const content = await page.evaluate(`
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
            // Skip date-only strings like "Feb 17", "2024-01-01"
            if (text.length < 20 && text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d/)) return true;
            return false;
          }

          function isContentImage(img) {
            var w = img.naturalWidth || parseInt(img.getAttribute('width')) || 0;
            var h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
            // Skip tiny images: emoji, stickers, icons (< 80px either dimension)
            if (w > 0 && w < 80) return false;
            if (h > 0 && h < 80) return false;
            // Skip by class name
            var cls = (img.className || '').toLowerCase();
            if (cls.indexOf('emoji') !== -1 || cls.indexOf('reaction') !== -1 ||
                cls.indexOf('sticker') !== -1 || cls.indexOf('icon') !== -1 ||
                cls.indexOf('avatar') !== -1) return false;
            // Skip SVG data URIs (icons)
            var src = img.getAttribute('src') || '';
            if (src.indexOf('data:image/svg') === 0) return false;
            return true;
          }

          var collected = [];
          var seenText = new Set();
          var imgUrls = [];
          var debugImgs = [];

          function harvest() {
            var scope = contentRoot || document;

            // Swap lazy-loaded images
            scope.querySelectorAll('img').forEach(function(img) {
              var real = img.getAttribute('data-src') || img.getAttribute('data-origin-src') || img.getAttribute('data-original');
              if (real && (!img.getAttribute('src') || img.getAttribute('src').indexOf('data:') === 0)) {
                img.setAttribute('src', real);
              }
            });

            // Debug: collect info about ALL images in DOM
            if (debugImgs.length === 0) {
              document.querySelectorAll('img').forEach(function(img) {
                var src = img.getAttribute('src') || '';
                var dataSrc = img.getAttribute('data-src') || '';
                var cls = img.className || '';
                var w = img.naturalWidth || parseInt(img.getAttribute('width')) || 0;
                var h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
                var inScope = scope.contains(img);
                var isContent = isContentImage(img);
                var parentTag = img.parentElement ? img.parentElement.tagName : 'none';
                var parentCls = img.parentElement ? (img.parentElement.className || '').substring(0, 80) : '';
                debugImgs.push({
                  src: src.substring(0, 150),
                  dataSrc: dataSrc.substring(0, 150),
                  cls: cls.substring(0, 80),
                  w: w, h: h,
                  inScope: inScope,
                  isContent: isContent,
                  parentTag: parentTag,
                  parentCls: parentCls
                });
              });
            }

            // Collect text and images in DOM order
            var blocks = scope.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, img, figure, [class*="image-block"]');
            blocks.forEach(function(b) {
              var tag = b.tagName.toLowerCase();

              // Handle images
              if (tag === 'img') {
                if (!isContentImage(b)) return;
                var src = b.getAttribute('src') || b.getAttribute('data-src') || '';
                if (!src || src.indexOf('data:') === 0) return;
                // Store both full URL and pathname for matching
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

              // Handle figure / image-block containers
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

              // Handle text
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
                collected.push('\\n\`\`\`\\n' + text + '\\n\`\`\`\\n');
              } else {
                collected.push(text);
              }
            });
          }

          // 6. Scroll and harvest
          var totalH = Math.max(scrollEl.scrollHeight, document.body.scrollHeight, 8000);
          for (var y = 0; y < totalH; y += 300) {
            scrollEl.scrollTop = y;
            window.scrollTo(0, y);
            await new Promise(function(r) { setTimeout(r, 350); });
            harvest();
          }
          scrollEl.scrollTop = 999999;
          window.scrollTo(0, 999999);
          await new Promise(function(r) { setTimeout(r, 500); });
          harvest();

          return { text: collected.join('\\n\\n'), images: imgUrls, debugImgs: debugImgs };
        })()
      `);

      // Wait for pending response handlers to finish
      await new Promise((r) => setTimeout(r, 1000));

      const feishuResult = content as { text?: string; images?: string[]; debugImgs?: any[] } | null;
      if (feishuResult && feishuResult.text && feishuResult.text.length > 100) {
        const title = await page.title();

        // Collect captured image keys for debug (truncated URLs, no base64)
        const capturedKeys = Array.from(capturedImages.keys()).map(k => k.substring(0, 200));

        // Resolve image URL to captured base64. Try exact match, then pathname match.
        const resolveLog: { rawUrl: string; method: string; matched: boolean }[] = [];
        function resolveImage(rawUrl: string): string {
          const exact = capturedImages.get(rawUrl);
          if (exact) { resolveLog.push({ rawUrl: rawUrl.substring(0, 150), method: 'exact', matched: true }); return exact; }
          try {
            const pathMatch = capturedImages.get(new URL(rawUrl).pathname);
            if (pathMatch) { resolveLog.push({ rawUrl: rawUrl.substring(0, 150), method: 'pathname', matched: true }); return pathMatch; }
          } catch {}
          // Last resort: find any captured URL containing the same path segment
          try {
            const path = new URL(rawUrl).pathname;
            for (const [key, val] of capturedImages) {
              if (key.includes(path) || path.includes(key)) { resolveLog.push({ rawUrl: rawUrl.substring(0, 150), method: 'fuzzy', matched: true }); return val; }
            }
          } catch {}
          resolveLog.push({ rawUrl: rawUrl.substring(0, 150), method: 'none', matched: false });
          return rawUrl; // Return raw URL if no match found
        }

        // Debug mode: return diagnostic JSON instead of HTML
        if (debug) {
          let html = `<html><head><title>${title}</title></head><body>`;
          html += `<h1>${title}</h1>`;
          const imgMarkerRe = /^\{\{IMG:(.+)\}\}$/;
          html += feishuResult.text.split('\n\n').map((block: string) => {
            const imgMatch = block.match(imgMarkerRe);
            if (imgMatch) {
              const src = resolveImage(imgMatch[1]);
              return `<figure><img src="${src}" /></figure>`;
            }
            return `<p>${block}</p>`;
          }).join('\n');
          html += `</body></html>`;

          const debugData = {
            title,
            totalCapturedImages: capturedImages.size,
            capturedKeys,
            imgMarkersInText: (feishuResult.text.match(/\{\{IMG:[^}]+\}\}/g) || []).map((m: string) => m.substring(0, 200)),
            resolveLog,
            allDomImages: feishuResult.debugImgs,
            collectedImgUrls: feishuResult.images,
          };
          return `__FEISHU_DEBUG__${JSON.stringify(debugData)}`;
        }

        let html = `<html><head><title>${title}</title></head><body>`;
        html += `<h1>${title}</h1>`;
        const imgMarkerRe = /^\{\{IMG:(.+)\}\}$/;
        html += feishuResult.text.split('\n\n').map((block: string) => {
          const imgMatch = block.match(imgMarkerRe);
          if (imgMatch) {
            const src = resolveImage(imgMatch[1]);
            return `<figure><img src="${src}" /></figure>`;
          }
          if (block.startsWith('#')) return `<p>${block}</p>`;
          return `<p>${block}</p>`;
        }).join('\n');
        html += `</body></html>`;
        return html;
      }
    }

    // Non-Feishu: standard wait
    if (!isFeishu) {
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Swap lazy-loaded images: many sites (especially WeChat) store the
    // real URL in data-src while src holds a tiny SVG placeholder.
    await page.evaluate(`
      document.querySelectorAll("img[data-src]").forEach(function(img) {
        var real = img.getAttribute("data-src");
        if (real) img.setAttribute("src", real);
      });
    `);

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

function htmlToMarkdown(html: string, url: string): { markdown: string; title: string } {
  // Wrap in <html><head></head><body>...</body></html> to guarantee
  // linkedom always has a documentElement, head, and body — prevents
  // crashes on plain-text or fragment responses.
  const wrappedHtml = html.includes("<html") ? html : `<html><head></head><body>${html}</body></html>`;
  const { document } = parseHTML(wrappedHtml);

  // Set <base> for Readability to resolve relative links
  try {
    const existingBase = document.querySelector("base");
    if (existingBase) {
      existingBase.href = url;
    } else if (document.head) {
      const base = document.createElement("base");
      base.href = url;
      document.head.appendChild(base);
    }
  } catch {
    // Ignore if head is not available
  }

  // Try Readability to extract main content
  let contentHtml = html;
  let title = "";
  try { title = document.title || ""; } catch { /* no title */ }
  try {
    const reader = new Readability(document.cloneNode(true) as any);
    const article = reader.parse();
    if (article && article.content) {
      contentHtml = article.content;
      title = article.title || title;
    }
  } catch {
    // Readability failed, fall through to convert full HTML
  }

  // Parse content into DOM so Turndown receives a node (not a string).
  // This avoids Turndown calling global `document.implementation` which
  // doesn't exist in Workers.
  const { document: contentDoc } = parseHTML(
    `<html><body>${contentHtml}</body></html>`
  );
  let markdown = turndown.turndown(contentDoc.body as unknown as HTMLElement);

  // Prepend title as H1 if available and not already present
  if (title && !markdown.includes(`# ${title}`)) {
    markdown = `# ${title}\n\n${markdown}`;
  }

  return { markdown, title };
}

/** Rewrite hotlink-protected image URLs to go through our /img/ proxy. */
function proxyImageUrls(markdown: string, proxyHost: string): string {
  // Match markdown image syntax ![alt](url)
  return markdown.replace(
    /!\[([^\]]*)\]\((https?:\/\/mmbiz\.qpic\.cn\/[^)]+)\)/g,
    (_match, alt, imgUrl) =>
      `![${alt}](https://${proxyHost}/img/${encodeURIComponent(imgUrl)})`
  );
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1") return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) return false;
    if (hostname === "169.254.169.254") return false;
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    return true;
  } catch {
    return false;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.host;
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Only allow GET and HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Handle favicon
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Handle API health check
    if (path === "/api/health") {
      return Response.json({ status: "ok", service: host });
    }

    // Image proxy — rewrites Referer so hotlink-protected images load
    if (path.startsWith("/img/")) {
      const imgUrl = decodeURIComponent(path.slice(5));
      if (!isValidUrl(imgUrl) || !isSafeUrl(imgUrl)) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const imgResp = await fetch(imgUrl, {
          headers: {
            "Referer": new URL(imgUrl).origin + "/",
            "User-Agent": WECHAT_UA,
          },
        });
        const headers = new Headers(imgResp.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "public, max-age=86400");
        return new Response(imgResp.body, { status: imgResp.status, headers });
      } catch {
        return new Response("Image fetch failed", { status: 502 });
      }
    }

    // Extract target URL from path
    const targetUrl = extractTargetUrl(path, url.search);

    // If no target URL, show landing page
    if (!targetUrl) {
      return new Response(landingPageHTML(host), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Validate target URL
    if (!isValidUrl(targetUrl)) {
      return new Response(errorPageHTML("Invalid URL", `The URL "${targetUrl}" is not valid. Please provide a valid HTTP(S) URL.`), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // SSRF protection — block internal/private addresses
    if (!isSafeUrl(targetUrl)) {
      return new Response(errorPageHTML("Blocked", "Requests to internal or private addresses are not allowed."), {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    try {
      // Determine if caller wants raw markdown
      const acceptHeader = request.headers.get("Accept") || "";
      const wantsRaw =
        url.searchParams.get("raw") === "true" ||
        acceptHeader.split(",").some(part => part.trim().split(";")[0] === "text/markdown");

      // Fetch with manual redirect to validate each hop against SSRF
      // Use WeChat in-app UA for mp.weixin.qq.com so static fetch has the
      // best chance of getting real content without needing browser rendering.
      const isWechat = targetUrl.includes("mp.weixin.qq.com");
      const fetchHeaders: Record<string, string> = {
        "Accept": "text/markdown, text/html;q=0.9, */*;q=0.8",
        "User-Agent": isWechat ? WECHAT_UA : `${host}/1.0 (Markdown Converter)`,
      };
      if (isWechat) {
        fetchHeaders["Accept-Language"] = "zh-CN,zh;q=0.9,en;q=0.8";
        fetchHeaders["Referer"] = "https://mp.weixin.qq.com/";
      }
      let response = await fetch(targetUrl, { headers: fetchHeaders, redirect: "manual" });

      // Follow up to 5 redirects, validating each destination
      let redirects = 0;
      while (redirects < 5 && [301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        if (!location) break;
        const redirectUrl = new URL(location, targetUrl).href;
        if (!isSafeUrl(redirectUrl)) {
          return new Response(
            errorPageHTML("Blocked", "Redirect target points to an internal or private address."),
            { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        response = await fetch(redirectUrl, { headers: fetchHeaders, redirect: "manual" });
        redirects++;
      }

      const forceBrowser = url.searchParams.get("force_browser") === "true";
      const debugMode = url.searchParams.get("debug") === "true";
      const staticFailed = !response.ok;

      // If static fetch failed and this is NOT a browser-required site, return error
      if (staticFailed && !forceBrowser && !alwaysNeedsBrowser(targetUrl)) {
        return new Response(
          errorPageHTML(
            "Fetch Failed",
            `Could not fetch the target URL. Status: ${response.status} ${response.statusText}`
          ),
          {
            status: 502,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        );
      }

      let finalHtml = "";
      let method = "readability+turndown";

      if (staticFailed) {
        // Static fetch failed (e.g. Feishu 302 login redirect) — go straight to browser
        try {
          finalHtml = await fetchWithBrowser(targetUrl, env, debugMode);
          method = "browser+readability+turndown";
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(
            errorPageHTML("Fetch Failed", `Static fetch returned ${response.status} and browser rendering also failed: ${msg}`),
            { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      } else {
        // Static fetch succeeded — validate content type and size
        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/") && !contentType.includes("application/xhtml")) {
          return new Response(
            errorPageHTML("Unsupported Content", `This URL returned non-text content (${contentType}). Only HTML and text pages can be converted to Markdown.`),
            { status: 415, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }

        const contentLength = parseInt(response.headers.get("Content-Length") || "0", 10);
        if (contentLength > MAX_RESPONSE_BYTES) {
          return new Response(
            errorPageHTML("Content Too Large", "The target page exceeds the 5 MB size limit."),
            { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }

        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
          return new Response(
            errorPageHTML("Content Too Large", "The target page exceeds the 5 MB size limit."),
            { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }

        const tokenCount = response.headers.get("x-markdown-tokens") || "";
        const isMarkdown = contentType.includes("text/markdown");

        // If the site returned markdown directly (supports Markdown for Agents)
        if (isMarkdown) {
          if (wantsRaw) {
            return new Response(body, {
              headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                "X-Source-URL": targetUrl,
                "X-Markdown-Tokens": tokenCount,
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          return new Response(renderedPageHTML(host, body, targetUrl, tokenCount, "native"), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        // Check if the static HTML needs browser rendering
        finalHtml = body;
        if (forceBrowser || needsBrowserRendering(body, targetUrl)) {
          try {
            finalHtml = await fetchWithBrowser(targetUrl, env, debugMode);
            method = "browser+readability+turndown";
          } catch {
            // Browser rendering failed — fall back to static HTML
          }
        }
      }

      // Debug mode: return diagnostic JSON for Feishu image troubleshooting
      if (finalHtml.startsWith("__FEISHU_DEBUG__")) {
        const debugJson = finalHtml.substring("__FEISHU_DEBUG__".length);
        return new Response(debugJson, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // P2 fix: enforce the same 5 MB size limit on browser-rendered content
      if (new TextEncoder().encode(finalHtml).byteLength > MAX_RESPONSE_BYTES) {
        return new Response(
          errorPageHTML("Content Too Large", "The rendered page exceeds the 5 MB size limit."),
          { status: 413, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      let { markdown } = htmlToMarkdown(finalHtml, targetUrl);

      // Rewrite hotlink-protected WeChat images to go through our proxy
      if (targetUrl.includes("mmbiz.qpic.cn") || targetUrl.includes("mp.weixin.qq.com")) {
        markdown = proxyImageUrls(markdown, host);
      }

      if (wantsRaw) {
        return new Response(markdown, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "X-Source-URL": targetUrl,
            "X-Markdown-Native": "false",
            "X-Markdown-Method": method,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      return new Response(
        renderedPageHTML(host, markdown, targetUrl, "", method === "browser+readability+turndown" ? "browser" : "fallback"),
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        errorPageHTML("Error", `Failed to process the URL: ${message}`),
        {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }
      );
    }
  },
};

function extractTargetUrl(path: string, search: string): string | null {
  // Remove leading slash
  let raw = path.slice(1);
  if (!raw) return null;

  // The target URL might not have a protocol prefix
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    // Check if it looks like a domain
    if (raw.includes(".") && !raw.startsWith(".")) {
      raw = "https://" + raw;
    } else {
      return null;
    }
  }

  // Re-attach the original query string if the target URL doesn't have one
  // but exclude our own parameters (raw, force_browser)
  const targetSearchParams = new URLSearchParams(search);
  targetSearchParams.delete("raw");
  targetSearchParams.delete("force_browser");
  targetSearchParams.delete("debug");
  const remainingSearch = targetSearchParams.toString();

  if (remainingSearch && !raw.includes("?")) {
    raw += "?" + remainingSearch;
  }

  return raw;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function landingPageHTML(host: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(host)} - Convert Any URL to Markdown</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-deep: #07080c;
      --bg-surface: #111318;
      --bg-elevated: #191b22;
      --border: #23252f;
      --border-subtle: #1a1c26;
      --text-primary: #eeeef2;
      --text-secondary: #8b8da3;
      --text-muted: #555770;
      --accent: #22d3ee;
      --accent-hover: #06b6d4;
      --font-display: 'Instrument Serif', Georgia, serif;
      --font-body: 'DM Sans', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-body);
      background: var(--bg-deep);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    /* Grain texture overlay */
    body::after {
      content: '';
      position: fixed;
      inset: 0;
      opacity: 0.025;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      pointer-events: none;
      z-index: 9999;
    }

    /* Floating gradient orbs */
    .bg-glow {
      position: fixed;
      inset: 0;
      overflow: hidden;
      z-index: 0;
      pointer-events: none;
    }

    .bg-glow::before {
      content: '';
      position: absolute;
      width: 700px;
      height: 700px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(34, 211, 238, 0.07) 0%, transparent 70%);
      top: -250px;
      right: -150px;
      animation: drift 22s ease-in-out infinite;
    }

    .bg-glow::after {
      content: '';
      position: absolute;
      width: 500px;
      height: 500px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(34, 211, 238, 0.04) 0%, transparent 70%);
      bottom: -150px;
      left: -100px;
      animation: drift 28s ease-in-out infinite reverse;
    }

    @keyframes drift {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(40px, -30px) scale(1.05); }
      66% { transform: translate(-25px, 20px) scale(0.95); }
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(28px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .hero {
      position: relative;
      z-index: 1;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem 2rem;
      text-align: center;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 1rem;
      background: rgba(34, 211, 238, 0.06);
      border: 1px solid rgba(34, 211, 238, 0.12);
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--accent);
      letter-spacing: 0.03em;
      margin-bottom: 2.5rem;
      animation: fadeUp 0.6s ease both;
    }

    h1 {
      font-family: var(--font-display);
      font-size: clamp(3rem, 7vw, 5.5rem);
      font-weight: 400;
      font-style: italic;
      letter-spacing: -0.02em;
      line-height: 1.05;
      margin-bottom: 1.5rem;
      color: var(--text-primary);
      animation: fadeUp 0.6s ease 0.08s both;
    }

    h1 em {
      font-style: normal;
      background: linear-gradient(135deg, var(--accent) 0%, #67e8f9 50%, var(--accent-hover) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .subtitle {
      font-size: 1.1rem;
      color: var(--text-secondary);
      max-width: 520px;
      line-height: 1.7;
      margin-bottom: 3rem;
      font-weight: 300;
      animation: fadeUp 0.6s ease 0.16s both;
    }

    .subtitle strong {
      color: var(--text-primary);
      font-weight: 500;
    }

    /* Animated gradient border on focus */
    .input-wrapper {
      position: relative;
      width: 100%;
      max-width: 680px;
      border-radius: 14px;
      padding: 1px;
      background: var(--border);
      transition: box-shadow 0.4s ease;
      animation: fadeUp 0.6s ease 0.24s both;
    }

    .input-wrapper:focus-within {
      background: linear-gradient(135deg, var(--accent), var(--accent-hover), #67e8f9, var(--accent));
      background-size: 300% 300%;
      animation: fadeUp 0.6s ease 0.24s both, shimmer 4s ease infinite;
      box-shadow: 0 0 40px rgba(34, 211, 238, 0.1), 0 0 80px rgba(34, 211, 238, 0.04);
    }

    @keyframes shimmer {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }

    .input-group {
      display: flex;
      width: 100%;
      background: var(--bg-surface);
      border-radius: 13px;
      overflow: hidden;
    }

    .input-prefix {
      display: flex;
      align-items: center;
      padding: 0 0 0 1.25rem;
      color: var(--accent);
      font-family: var(--font-mono);
      font-size: 0.82rem;
      font-weight: 500;
      white-space: nowrap;
      user-select: none;
      opacity: 0.7;
    }

    .input-group input {
      flex: 1;
      padding: 1.1rem 1rem;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text-primary);
      font-size: 0.9rem;
      font-family: var(--font-mono);
      font-weight: 400;
    }

    .input-group input::placeholder {
      color: var(--text-muted);
      font-weight: 400;
    }

    .input-group button {
      padding: 0 1.75rem;
      background: var(--accent);
      border: none;
      color: var(--bg-deep);
      font-weight: 600;
      font-size: 0.85rem;
      font-family: var(--font-body);
      cursor: pointer;
      transition: background 0.2s ease;
      letter-spacing: 0.01em;
    }

    .input-group button:hover {
      background: var(--accent-hover);
    }

    .input-hint {
      margin-top: 0.75rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      letter-spacing: 0.01em;
      animation: fadeUp 0.6s ease 0.28s both;
    }

    /* Feature cards */
    .features {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      width: 100%;
      max-width: 840px;
      margin-top: 5rem;
      background: var(--border-subtle);
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid var(--border-subtle);
      animation: fadeUp 0.6s ease 0.36s both;
    }

    .feature {
      padding: 2rem 1.75rem;
      background: var(--bg-surface);
      transition: background 0.3s ease;
    }

    .feature:hover {
      background: var(--bg-elevated);
    }

    .feature-label {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      font-weight: 500;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 0.85rem;
      opacity: 0.7;
    }

    .feature h3 {
      font-family: var(--font-display);
      font-size: 1.2rem;
      font-weight: 400;
      color: var(--text-primary);
      margin-bottom: 0.5rem;
    }

    .feature p {
      font-size: 0.82rem;
      color: var(--text-secondary);
      line-height: 1.6;
      font-weight: 300;
    }

    .feature code {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      background: rgba(34, 211, 238, 0.08);
      padding: 0.12rem 0.35rem;
      border-radius: 4px;
      color: var(--accent);
    }

    /* How it works */
    .how-section {
      width: 100%;
      max-width: 840px;
      margin-top: 5rem;
      animation: fadeUp 0.6s ease 0.44s both;
    }

    .how-section h2 {
      font-family: var(--font-display);
      font-size: 2rem;
      font-weight: 400;
      font-style: italic;
      text-align: center;
      margin-bottom: 2.5rem;
      color: var(--text-primary);
    }

    .steps {
      display: flex;
      gap: 1px;
      background: var(--border-subtle);
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid var(--border-subtle);
    }

    .step {
      flex: 1;
      padding: 2rem 1.5rem;
      background: var(--bg-surface);
      text-align: center;
    }

    .step-num {
      font-family: var(--font-display);
      font-size: 2rem;
      font-style: italic;
      color: var(--accent);
      opacity: 0.5;
      margin-bottom: 0.75rem;
      line-height: 1;
    }

    .step h3 {
      font-size: 0.9rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: var(--text-primary);
    }

    .step p {
      font-size: 0.8rem;
      color: var(--text-secondary);
      line-height: 1.6;
      font-weight: 300;
    }

    .step code {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      background: rgba(34, 211, 238, 0.08);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      color: var(--accent);
    }

    /* Example */
    .example-box {
      margin-top: 3.5rem;
      width: 100%;
      max-width: 840px;
      animation: fadeUp 0.6s ease 0.5s both;
    }

    .example-label {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text-muted);
      margin-bottom: 0.6rem;
    }

    .example-url {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--text-secondary);
      padding: 1rem 1.25rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      overflow-x: auto;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .example-url:hover {
      background: var(--bg-elevated);
      border-color: var(--border);
      color: var(--text-primary);
    }

    .example-url .hl {
      color: var(--accent);
    }

    footer {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 3rem 2rem;
      color: var(--text-muted);
      font-size: 0.75rem;
      letter-spacing: 0.01em;
    }

    footer a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.2s;
    }

    footer a:hover {
      color: var(--accent);
    }

    @media (max-width: 768px) {
      .features { grid-template-columns: 1fr; }
      .steps { flex-direction: column; }
      .input-prefix { display: none; }
      .input-group input { padding: 1rem; }
      .hero { padding: 2rem 1.25rem 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="bg-glow"></div>

  <div class="hero">
    <div class="badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      Cloudflare Markdown for Agents
    </div>

    <h1>Any URL to <em>Markdown</em>,<br>instantly</h1>

    <p class="subtitle">
      Prepend <strong>${escapeHtml(host)}/</strong> before any URL.<br>
      Clean, readable Markdown for AI agents, LLMs, and developers.
    </p>

    <div class="input-wrapper">
      <form class="input-group" id="urlForm" onsubmit="return handleSubmit(event)">
        <div class="input-prefix">${escapeHtml(host)}/</div>
        <input
          type="text"
          id="urlInput"
          placeholder="paste any url..."
          autocomplete="off"
          autofocus
        />
        <button type="submit">Convert</button>
      </form>
    </div>
    <p class="input-hint">Bare domains, http:// and https:// all work</p>

    <div class="features">
      <div class="feature">
        <div class="feature-label">01 &mdash; Universal</div>
        <h3>Any Website</h3>
        <p>Three conversion paths: native edge Markdown, Readability extraction, or headless browser rendering.</p>
      </div>
      <div class="feature">
        <div class="feature-label">02 &mdash; API-first</div>
        <h3>Raw Output</h3>
        <p>Append <code>?raw=true</code> or send <code>Accept: text/markdown</code> for plain Markdown text.</p>
      </div>
      <div class="feature">
        <div class="feature-label">03 &mdash; Zero Config</div>
        <h3>No Keys Needed</h3>
        <p>No signup, no API keys, no rate limits. Just prepend the domain and go.</p>
      </div>
    </div>

    <div class="how-section">
      <h2>How it works</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">i</div>
          <h3>Prepend URL</h3>
          <p>Add <strong>${escapeHtml(host)}/</strong> before any web address.</p>
        </div>
        <div class="step">
          <div class="step-num">ii</div>
          <h3>Edge Fetch</h3>
          <p>Request sent with <code>Accept: text/markdown</code> via Cloudflare edge network.</p>
        </div>
        <div class="step">
          <div class="step-num">iii</div>
          <h3>Clean Output</h3>
          <p>Receive formatted Markdown &mdash; rendered preview or raw text via API.</p>
        </div>
      </div>
    </div>

    <div class="example-box">
      <div class="example-label">Try an example</div>
      <div class="example-url" onclick="window.location.href='/https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/'">
        <span class="hl">${escapeHtml(host)}/</span>https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
      </div>
    </div>
  </div>

  <footer>
    Built on Cloudflare Workers &mdash; <a href="https://blog.cloudflare.com/markdown-for-agents/" target="_blank">Markdown for Agents</a>
  </footer>

  <script>
    function handleSubmit(e) {
      e.preventDefault();
      const input = document.getElementById('urlInput').value.trim();
      if (!input) return false;
      window.location.href = '/' + input;
      return false;
    }
  </script>
</body>
</html>`;
}

function renderedPageHTML(host: string, content: string, sourceUrl: string, tokenCount: string, method: "native" | "fallback" | "browser"): string {
  const escapedContent = escapeHtml(content);
  const statusConfig: Record<string, { label: string; cls: string }> = {
    native: { label: 'Native Markdown', cls: 'st-native' },
    fallback: { label: 'Readability + Turndown', cls: 'st-fallback' },
    browser: { label: 'Browser Rendered', cls: 'st-browser' },
  };
  const status = statusConfig[method];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MD &mdash; ${escapeHtml(sourceUrl)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.8.1/github-markdown-dark.min.css">
  <style>
    :root {
      --bg-deep: #07080c;
      --bg-base: #0c0d12;
      --bg-surface: #111318;
      --bg-elevated: #191b22;
      --border: #23252f;
      --border-subtle: #1a1c26;
      --text-primary: #eeeef2;
      --text-secondary: #8b8da3;
      --text-muted: #555770;
      --accent: #22d3ee;
      --accent-hover: #06b6d4;
      --green: #34d399;
      --amber: #fbbf24;
      --violet: #a78bfa;
      --font-body: 'DM Sans', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-body);
      background: var(--bg-deep);
      color: var(--text-primary);
      min-height: 100vh;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0 1.5rem;
      height: 52px;
      background: rgba(7, 8, 12, 0.82);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border-bottom: 1px solid var(--border-subtle);
    }

    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }

    .logo {
      font-weight: 600;
      font-size: 0.88rem;
      color: var(--accent);
      text-decoration: none;
      white-space: nowrap;
      letter-spacing: -0.01em;
    }

    .sep {
      width: 1px;
      height: 16px;
      background: var(--border);
      flex-shrink: 0;
    }

    .source-url {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--text-muted);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: color 0.2s;
    }

    .source-url:hover {
      color: var(--text-secondary);
    }

    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .status-pill {
      padding: 0.2rem 0.65rem;
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 0.65rem;
      font-weight: 500;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }

    .st-native {
      background: rgba(52, 211, 153, 0.08);
      color: var(--green);
      border: 1px solid rgba(52, 211, 153, 0.18);
    }

    .st-fallback {
      background: rgba(251, 191, 36, 0.08);
      color: var(--amber);
      border: 1px solid rgba(251, 191, 36, 0.18);
    }

    .st-browser {
      background: rgba(167, 139, 250, 0.08);
      color: var(--violet);
      border: 1px solid rgba(167, 139, 250, 0.18);
    }

    .tokens {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .btn {
      padding: 0.3rem 0.8rem;
      border-radius: 7px;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: 0.75rem;
      font-family: var(--font-body);
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .btn:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }

    .btn-accent {
      background: var(--accent);
      border-color: transparent;
      color: var(--bg-deep);
      font-weight: 600;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }

    .btn-accent:hover {
      background: var(--accent-hover);
    }

    .tab-bar {
      display: flex;
      gap: 0;
      padding: 0 2rem;
      background: var(--bg-base);
      border-bottom: 1px solid var(--border-subtle);
    }

    .tab {
      padding: 0.7rem 1.15rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.15s ease;
      margin-bottom: -1px;
    }

    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .tab:hover:not(.active) {
      color: var(--text-secondary);
    }

    .panel {
      display: none;
      padding: 2.5rem 2rem;
      max-width: 860px;
      margin: 0 auto;
      width: 100%;
    }

    .panel.active {
      display: block;
      animation: panelIn 0.2s ease;
    }

    @keyframes panelIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .markdown-body {
      background: transparent !important;
      font-size: 15px;
    }

    .raw-content {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      line-height: 1.8;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text-secondary);
      background: var(--bg-surface);
      padding: 1.5rem;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
    }

    @media (max-width: 768px) {
      .toolbar { padding: 0 1rem; }
      .source-url, .sep { display: none; }
      .panel { padding: 1.25rem 1rem; }
      .tab-bar { padding: 0 1rem; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <a href="/" class="logo">${escapeHtml(host)}</a>
      <div class="sep"></div>
      <a href="${escapeHtml(sourceUrl)}" class="source-url" target="_blank" title="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a>
    </div>
    <div class="toolbar-right">
      <span class="status-pill ${status.cls}">${status.label}</span>
      ${tokenCount ? '<span class="tokens">' + escapeHtml(tokenCount) + ' tokens</span>' : ''}
      <button class="btn" onclick="copyRaw()">Copy</button>
      <a href="/${escapeHtml(sourceUrl)}${sourceUrl.includes('?') ? '&' : '?'}raw=true" class="btn btn-accent" target="_blank">Raw</a>
    </div>
  </div>

  <div class="tab-bar">
    <div class="tab active" onclick="switchTab('rendered')">Rendered</div>
    <div class="tab" onclick="switchTab('source')">Source</div>
  </div>

  <div class="panel active" id="rendered-panel">
    <div class="markdown-body" id="markdown-rendered"></div>
  </div>

  <div class="panel" id="source-panel">
    <div class="raw-content" id="raw-content">${escapedContent}</div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js"></script>
  <script>
    const rawContent = document.getElementById('raw-content').textContent;
    document.getElementById('markdown-rendered').innerHTML = DOMPurify.sanitize(marked.parse(rawContent));

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      if (tab === 'rendered') {
        document.querySelectorAll('.tab')[0].classList.add('active');
        document.getElementById('rendered-panel').classList.add('active');
      } else {
        document.querySelectorAll('.tab')[1].classList.add('active');
        document.getElementById('source-panel').classList.add('active');
      }
    }

    function copyRaw() {
      navigator.clipboard.writeText(rawContent).then(() => {
        const btn = document.querySelector('.btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 2000);
      });
    }
  </script>
</body>
</html>`;
}

function errorPageHTML(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error &mdash; ${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-deep: #07080c;
      --bg-surface: #111318;
      --border: #23252f;
      --text-primary: #eeeef2;
      --text-secondary: #8b8da3;
      --red: #f87171;
      --accent: #22d3ee;
      --accent-hover: #06b6d4;
      --font-display: 'Instrument Serif', Georgia, serif;
      --font-body: 'DM Sans', system-ui, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-body);
      background: var(--bg-deep);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .error-card {
      max-width: 440px;
      width: 100%;
      padding: 3rem 2.5rem;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      text-align: center;
      animation: fadeUp 0.5s ease both;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .error-glyph {
      font-family: var(--font-display);
      font-style: italic;
      font-size: 3.5rem;
      color: var(--red);
      opacity: 0.35;
      line-height: 1;
      margin-bottom: 1.25rem;
    }

    h1 {
      font-family: var(--font-display);
      font-style: italic;
      font-size: 1.4rem;
      font-weight: 400;
      margin-bottom: 0.75rem;
      color: var(--text-primary);
    }

    p {
      color: var(--text-secondary);
      line-height: 1.7;
      margin-bottom: 2rem;
      font-size: 0.88rem;
      font-weight: 300;
    }

    a {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.55rem 1.4rem;
      background: var(--accent);
      color: var(--bg-deep);
      text-decoration: none;
      border-radius: 9px;
      font-weight: 600;
      font-size: 0.82rem;
      transition: background 0.2s ease;
    }

    a:hover {
      background: var(--accent-hover);
    }
  </style>
</head>
<body>
  <div class="error-card">
    <div class="error-glyph">!</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      Back to Home
    </a>
  </div>
</body>
</html>`;
}

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
};
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
}
