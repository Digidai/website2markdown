import type { SiteAdapter, ExtractResult } from "../../types";
import { WECHAT_UA } from "../../config";

export const wechatAdapter: SiteAdapter = {
  match(url: string): boolean {
    return url.includes("mp.weixin.qq.com");
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await page.setUserAgent(WECHAT_UA);
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });
  },

  async extract(page: any): Promise<ExtractResult | null> {
    await new Promise((r) => setTimeout(r, 2000));
    await page.evaluate(`
      (function() {
        // Extract publish time from script tags BEFORE removing them.
        // WeChat embeds create_time in JS — formats: JsDecode('ts'), 'ts', or bare digits.
        var ct = '';
        var scripts = document.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
          var s = scripts[i].textContent || '';
          var m = s.match(/create_time\\s*:\\s*JsDecode\\('(\\d+)'\\)/)
               || s.match(/create_time\\s*:\\s*'(\\d+)'/)
               || s.match(/create_time\\s*[:=]\\s*["']?(\\d+)["']?/);
          if (m) { ct = m[1]; break; }
        }
        if (ct) {
          var ts = parseInt(ct, 10);
          if (ts > 0) {
            // Format as UTC+8 date string
            var d = new Date((ts * 1000) + (8 * 3600000));
            var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
            var formatted = d.getUTCFullYear() + '-' + pad(d.getUTCMonth()+1) + '-' + pad(d.getUTCDate())
              + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
            var jsContent = document.getElementById('js_content');
            if (jsContent && jsContent.parentNode) {
              var p = document.createElement('p');
              p.setAttribute('data-wechat-meta', 'publish_time');
              p.textContent = '\\u53d1\\u5e03\\u65f6\\u95f4: ' + formatted;
              jsContent.parentNode.insertBefore(p, jsContent);
            }
          }
        }
        // Swap lazy-loaded images (data-src is WeChat's standard lazy-load attr)
        document.querySelectorAll("img[data-src]").forEach(function(img) {
          var real = img.getAttribute("data-src");
          if (real) img.setAttribute("src", real);
        });
        // Remove noise elements
        [".qr_code_pc", ".reward_area"].forEach(function(sel) {
          document.querySelectorAll(sel).forEach(function(el) { el.remove(); });
        });
      })()
    `);
    const html = await page.content();
    return { html };
  },

  postProcess(html: string): string {
    let result = html;

    // Convert WeChat code-snippet blocks to clean <pre><code> elements
    //    WeChat wraps code in .code-snippet__fix with line-number elements that
    //    Turndown can't handle properly — produces garbled output with CSS counter
    //    text leaking into code. Converting to standard <pre><code> lets Turndown
    //    produce clean fenced code blocks.
    result = result.replace(
      /<(?:section|div)[^>]*class="[^"]*code-snippet__fix[^"]*"[^>]*>([\s\S]*?)<\/(?:section|div)>/gi,
      (_match, inner: string) => {
        // Extract language from data-lang attribute
        const langMatch = inner.match(/data-lang=["']([^"']+)["']/);
        const lang = langMatch ? langMatch[1] : "";

        // Remove line-index elements (line numbers)
        let cleaned = inner.replace(/<[^>]*class="[^"]*code-snippet__line-index[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, "");

        // Extract text from <code> tags, filtering out CSS counter artifacts
        const codeTexts: string[] = [];
        const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/gi;
        let codeMatch;
        while ((codeMatch = codeRegex.exec(cleaned)) !== null) {
          const text = codeMatch[1]
            .replace(/<[^>]+>/g, "")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ");
          // Skip CSS counter leak lines
          if (/^[ce]?ounter\(line/.test(text)) continue;
          codeTexts.push(text);
        }

        const code = codeTexts.length > 0
          ? codeTexts.join("\n")
          : cleaned.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

        const escapedCode = code
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        return `<pre data-lang="${lang}"><code>${escapedCode}</code></pre>`;
      },
    );

    return result;
  },
};
