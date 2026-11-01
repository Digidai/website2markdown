import { DESKTOP_UA } from "../../config";
import { escapeHtml } from "../../security";

/**
 * Public Yuque docs: the page HTML carries `window.appData` with the book id
 * and doc slug but no body; the page's own endpoint /api/docs/<slug>?book_id=
 * returns the body as "lake" HTML (see Spritualkb/yuque-spider-plus). Lake is
 * ordinary HTML except images, code blocks and link cards, which are
 * <card name=… value="data:<url-encoded JSON>"> elements.
 */

const HEADERS = { "User-Agent": DESKTOP_UA, "Accept-Language": "zh-CN,zh;q=0.9" };

function cardToHtml(name: string, value: string): string {
  let data: any;
  try {
    data = JSON.parse(decodeURIComponent(value.replace(/^data:/, "")));
  } catch {
    return "";
  }
  switch (name) {
    case "image":
      return data?.src ? `<img src="${escapeHtml(data.src)}" alt="${escapeHtml(data.title || data.name || "")}">` : "";
    case "codeblock": {
      const lang = String(data?.mode || "").toLowerCase().replace(/[^a-z0-9+#-]/g, "");
      return `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(String(data?.code ?? ""))}</code></pre>`;
    }
    case "hr":
      return "<hr>";
    case "math":
      return data?.code ? `<code>${escapeHtml(data.code)}</code>` : "";
    default:
      // bookmarkInline, bookmarklink, file, video, …: keep the link if there is one.
      return data?.src ? `<a href="${escapeHtml(data.src)}">${escapeHtml(data.text || data.name || data.src)}</a>` : "";
  }
}

export function lakeToHtml(lake: string): string {
  return lake.replace(
    /<card\b([^>]*)>(?:<\/card>)?/g,
    (_, attrs: string) => {
      const name = attrs.match(/\bname="([^"]*)"/)?.[1] || "";
      const value = attrs.match(/\bvalue="([^"]*)"/)?.[1] || "";
      return cardToHtml(name, value);
    },
  );
}

export async function fetchYuqueDoc(url: string): Promise<string | null> {
  const page = await fetch(url, { headers: { ...HEADERS, "Accept": "text/html" }, signal: AbortSignal.timeout(10_000) });
  if (!page.ok) return null;
  const encoded = (await page.text()).match(/window\.appData\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/)?.[1];
  if (!encoded) return null;
  const appData = JSON.parse(decodeURIComponent(encoded));
  const bookId = appData?.book?.id;
  const slug = appData?.doc?.slug;
  if (!bookId || !slug) return null; // a knowledge-base index or a non-doc page

  const api = await fetch(
    `https://www.yuque.com/api/docs/${encodeURIComponent(slug)}?book_id=${bookId}&merge_dynamic_data=false`,
    { headers: { ...HEADERS, "Accept": "application/json", "Referer": url }, signal: AbortSignal.timeout(10_000) },
  );
  if (!api.ok) return null;
  const doc = (await api.json() as any)?.data;
  if (!doc?.content || typeof doc.content !== "string") return null;

  const title = doc.title || appData.doc.title || "Yuque";
  return `<html><head><title>${escapeHtml(title)}</title></head><body><article data-adapter="yuque">` +
    `<h1>${escapeHtml(title)}</h1>${lakeToHtml(doc.content)}</article></body></html>`;
}
