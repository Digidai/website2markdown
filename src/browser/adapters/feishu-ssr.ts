import { escapeHtml } from "../../security";

/**
 * Public Feishu/Lark docs embed their block tree (`clientVars.data.block_map`)
 * in the HTML served to search crawlers (see sheldum03/feishu-to-markdown).
 * It holds the text of the first chunk only: `has_more` marks longer docs,
 * whose remaining blocks and all images need a signed-in session. So this is
 * a text fallback for requests that cannot use the browser path.
 */

const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

type FeishuText = { apool?: { numToAttrib?: Record<string, [string, string]> | null }; initialAttributedTexts?: { attribs?: Record<string, string> | null; text?: Record<string, string> | null } };
type FeishuBlock = { id: string; data: { type: string; children?: string[]; text?: FeishuText; language?: string; image?: unknown; iframe?: { component?: { url?: string; original_text?: string } } } };

export interface FeishuSsrResult {
  html: string;
  /** False when the doc continues past what the page embeds. */
  complete: boolean;
}

/** Apply Etherpad-style attribute runs ("*0*1+9" = attribs 0 and 1 on the next 9 chars). */
function richText(t: FeishuText | undefined): string {
  const texts = t?.initialAttributedTexts?.text || {};
  const attribs = t?.initialAttributedTexts?.attribs || {};
  const pool = t?.apool?.numToAttrib || {};
  let out = "";
  for (const key of Object.keys(texts)) {
    const text = texts[key] || "";
    let pos = 0;
    for (const op of (attribs[key] || "").matchAll(/((?:\*[0-9a-z]+)*)(?:\|[0-9a-z]+)?\+([0-9a-z]+)/g)) {
      const len = parseInt(op[2], 36);
      const run = text.slice(pos, pos + len);
      pos += len;
      // attribute name → value, e.g. "bold" → "true", "link" → URL-encoded href
      const attrs = new Map((op[1].match(/[0-9a-z]+/g) || []).map((n) => pool[n] || ["", ""]));
      let piece = escapeHtml(run);
      if (attrs.has("inlineCode")) piece = `<code>${piece}</code>`;
      if (attrs.has("bold")) piece = `<strong>${piece}</strong>`;
      if (attrs.has("italic")) piece = `<em>${piece}</em>`;
      if (attrs.has("strikethrough")) piece = `<del>${piece}</del>`;
      const link = attrs.get("link");
      if (link) {
        let href = link;
        try { href = decodeURIComponent(link); } catch { /* keep raw */ }
        piece = `<a href="${escapeHtml(href)}">${piece}</a>`;
      }
      out += piece;
    }
    out += escapeHtml(text.slice(pos));
  }
  return out;
}

function plain(t: FeishuText | undefined): string {
  return Object.values(t?.initialAttributedTexts?.text || {}).join("");
}

const LIST_TAG: Record<string, string> = { bullet: "ul", ordered: "ol", todo: "ul" };

function render(map: Record<string, FeishuBlock>, ids: string[] = []): string {
  let html = "";
  let openList = "";
  const closeList = () => { if (openList) { html += `</${openList}>`; openList = ""; } };

  for (const id of ids) {
    const block = map[id];
    if (!block) continue;
    const { type, children } = block.data;
    const listTag = LIST_TAG[type];
    if (listTag !== openList) {
      closeList();
      if (listTag) { html += `<${listTag}>`; openList = listTag; }
    }
    const text = richText(block.data.text);
    const kids = render(map, children);
    const heading = type.match(/^heading([1-9])$/);

    if (heading) {
      const level = Math.min(Number(heading[1]) + 1, 6); // h1 is the document title
      html += `<h${level}>${text}</h${level}>${kids}`;
    } else if (listTag) {
      html += `<li>${text}${kids}</li>`;
    } else if (type === "code") {
      const lang = (block.data.language || "").toLowerCase().replace(/[^a-z0-9+#-]/g, "");
      html += `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(plain(block.data.text))}</code></pre>`;
    } else if (type === "quote_container" || type === "quote" || type === "callout") {
      html += `<blockquote>${text ? `<p>${text}</p>` : ""}${kids}</blockquote>`;
    } else if (type === "divider") {
      html += "<hr>";
    } else if (type === "image") {
      html += "<p>【图片】</p>"; // image files need a signed-in session
    } else if (type === "iframe") {
      const component = block.data.iframe?.component;
      let link = component?.url || "";
      try { if (component?.original_text) link = decodeURIComponent(component.original_text); } catch { /* keep url */ }
      if (link) html += `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`;
    } else {
      // text, grid, grid_column, synced_source, and anything unknown: keep text and children.
      html += (text ? `<p>${text}</p>` : "") + kids;
    }
  }
  closeList();
  return html;
}

export async function fetchFeishuSsr(url: string): Promise<FeishuSsrResult | null> {
  const resp = await fetch(url, {
    headers: { "User-Agent": CRAWLER_UA, "Accept": "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  const page = await resp.text();

  const marker = page.indexOf("clientVars: Object(");
  if (marker < 0) return null;
  // Parse the JSON object literal that starts right after the marker.
  const start = marker + "clientVars: Object(".length;
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = start; i < page.length; i++) {
    const ch = page[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === "\"") inString = false;
    } else if (ch === "\"") inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) return null;

  const data = (JSON.parse(page.slice(start, end)) as any)?.data;
  const map: Record<string, FeishuBlock> = data?.block_map || {};
  const root = Object.values(map).find((b) => b?.data?.type === "page");
  if (!root) return null;

  const title = plain(root.data.text) || "Feishu Doc";
  const body = render(map, root.data.children);
  if (!body) return null;

  const complete = !data.has_more && (root.data.children || []).every((id) => map[id]);
  const note = complete
    ? ""
    : "<p><em>【文档较长，这里只包含公开页面预载的前半部分。使用 API key 可获取完整内容和图片。】</em></p>";
  return {
    html: `<html><head><title>${escapeHtml(title)}</title></head><body><article data-adapter="feishu">` +
      `<h1>${escapeHtml(title)}</h1>${body}${note}</article></body></html>`,
    complete,
  };
}
