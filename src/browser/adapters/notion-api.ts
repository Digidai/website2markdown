import { DESKTOP_UA } from "../../config";
import { escapeHtml } from "../../security";

/**
 * Public Notion pages expose their block tree through the same internal API
 * the page itself uses (see breitburg/notion-site-fetch, NotionX/react-notion-x).
 * Reading it directly returns every block, including ones the browser path
 * loses to virtual scrolling, in a few small JSON calls.
 */

type Block = { id: string; type?: string; properties?: any; format?: any; content?: string[]; collection_id?: string };
type RecordMap = { block?: Record<string, any>; collection?: Record<string, any> };

const MAX_CHUNKS = 10;
const MAX_SYNC_ROUNDS = 4;
const SYNC_BATCH = 100;

function pageIdFromUrl(url: string): string | null {
  const { pathname, searchParams } = new URL(url);
  // ?p= opens a database row as a peek; otherwise the id ends the last path
  // segment. Anchor at the end: slugs like "Guide-8273…" end in hex letters.
  const segment = searchParams.get("p") || pathname.split("/").filter(Boolean).pop() || "";
  const hex = segment.replace(/-/g, "").match(/[0-9a-f]{32}$/i)?.[0];
  if (!hex) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Records come wrapped as {value} or, in newer responses, {value: {value}}. */
function unwrap(record: any): Block | undefined {
  const v = record?.value;
  return v && typeof v.value === "object" && v.value ? v.value : v;
}

async function post(origin: string, path: string, body: unknown): Promise<any> {
  const resp = await fetch(`${origin}/api/v3/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": DESKTOP_UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Notion ${path} returned ${resp.status}`);
  return resp.json();
}

function richText(title: any[] | undefined): string {
  if (!Array.isArray(title)) return "";
  return title.map((seg) => {
    if (!Array.isArray(seg)) return "";
    const [text, marks] = seg as [string, any[] | undefined];
    let out = escapeHtml(String(text ?? ""));
    for (const mark of marks || []) {
      switch (mark?.[0]) {
        case "b": out = `<strong>${out}</strong>`; break;
        case "i": out = `<em>${out}</em>`; break;
        case "s": out = `<del>${out}</del>`; break;
        case "c": out = `<code>${out}</code>`; break;
        case "e": out = `<code>${escapeHtml(String(mark[1] ?? ""))}</code>`; break;
        case "a": out = `<a href="${escapeHtml(String(mark[1] ?? ""))}">${out}</a>`; break;
      }
    }
    return out;
  }).join("");
}

function plainText(title: any[] | undefined): string {
  return Array.isArray(title) ? title.map((seg) => (Array.isArray(seg) ? String(seg[0] ?? "") : "")).join("") : "";
}

function imageSrc(origin: string, block: Block): string {
  const src: string = block.format?.display_source || block.properties?.source?.[0]?.[0] || "";
  if (!src) return "";
  // Uploaded files are signed per request; Notion's image proxy resolves them for public pages.
  if (src.startsWith("attachment:") || src.includes("amazonaws.com") || src.includes("notion-static.com")) {
    return `${origin}/image/${encodeURIComponent(src)}?table=block&id=${block.id}&cache=v2`;
  }
  return src;
}

const LIST_TAG: Record<string, string> = { bulleted_list: "ul", numbered_list: "ol", to_do: "ul" };

function render(origin: string, rm: RecordMap, ids: string[] = [], rootId: string): string {
  const blocks = rm.block || {};
  let html = "";
  let openList = "";
  const closeList = () => { if (openList) { html += `</${openList}>`; openList = ""; } };

  for (const id of ids) {
    const b = unwrap(blocks[id]);
    if (!b || !b.type) continue;
    const listTag = LIST_TAG[b.type];
    if (listTag !== openList) {
      closeList();
      if (listTag) { html += `<${listTag}>`; openList = listTag; }
    }
    const text = richText(b.properties?.title);
    const kids = b.type === "page" && b.id !== rootId ? "" : render(origin, rm, b.content, rootId);

    switch (b.type) {
      case "header": html += `<h2>${text}</h2>${kids}`; break;
      case "sub_header": html += `<h3>${text}</h3>${kids}`; break;
      case "sub_sub_header": html += `<h4>${text}</h4>${kids}`; break;
      case "bulleted_list":
      case "numbered_list": html += `<li>${text}${kids}</li>`; break;
      case "to_do": {
        const done = b.properties?.checked?.[0]?.[0] === "Yes";
        html += `<li>${done ? "[x]" : "[ ]"} ${text}${kids}</li>`;
        break;
      }
      case "quote": html += `<blockquote><p>${text}</p>${kids}</blockquote>`; break;
      case "callout": {
        const icon = typeof b.format?.page_icon === "string" && !b.format.page_icon.startsWith("http") ? `${escapeHtml(b.format.page_icon)} ` : "";
        html += `<blockquote><p>${icon}${text}</p>${kids}</blockquote>`;
        break;
      }
      case "code": {
        const lang = plainText(b.properties?.language).toLowerCase().replace(/[^a-z0-9+#-]/g, "");
        html += `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(plainText(b.properties?.title))}</code></pre>`;
        break;
      }
      case "equation": html += `<pre><code>${escapeHtml(plainText(b.properties?.title))}</code></pre>`; break;
      case "divider": html += "<hr>"; break;
      case "image": {
        const src = imageSrc(origin, b);
        const caption = plainText(b.properties?.caption);
        if (src) html += `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
        break;
      }
      case "bookmark":
      case "embed":
      case "video":
      case "file":
      case "pdf": {
        const link = b.properties?.link?.[0]?.[0] || b.properties?.source?.[0]?.[0] || b.format?.display_source;
        if (link) html += `<p><a href="${escapeHtml(link)}">${escapeHtml(plainText(b.properties?.title) || link)}</a></p>`;
        break;
      }
      case "page":
        if (b.id === rootId) { html += kids; break; }
        html += `<p><a href="${origin}/${b.id.replace(/-/g, "")}">${text || "Untitled"}</a></p>`;
        break;
      case "collection_view":
      case "collection_view_page": {
        const name = plainText((unwrap(rm.collection?.[b.collection_id || ""]) as any)?.name);
        html += `<p><a href="${origin}/${b.id.replace(/-/g, "")}">${escapeHtml(name || "Database")}</a></p>`;
        break;
      }
      case "table": {
        const order: string[] = b.format?.table_block_column_order || [];
        const rows = (b.content || []).map((rowId) => unwrap(blocks[rowId])).filter(Boolean) as Block[];
        html += "<table>" + rows.map((row, i) => {
          const cell = i === 0 && b.format?.table_block_column_header ? "th" : "td";
          return "<tr>" + order.map((col) => `<${cell}>${richText(row.properties?.[col])}</${cell}>`).join("") + "</tr>";
        }).join("") + "</table>";
        break;
      }
      case "column_list":
      case "column":
      case "toggle":
      case "transclusion_container":
      case "transclusion_reference":
        html += (b.type === "toggle" && text ? `<p><strong>${text}</strong></p>` : "") + kids;
        break;
      default:
        html += (text ? `<p>${text}</p>` : "") + kids;
    }
  }
  closeList();
  return html;
}

/** Ids reachable from the root (not descending into sub-pages) whose blocks have not been loaded. */
function missingIds(rm: RecordMap, rootId: string): string[] {
  const blocks = rm.block || {};
  const missing: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const b = unwrap(blocks[id]);
    if (!b) { missing.push(id); continue; }
    if (b.type === "page" && id !== rootId) continue;
    if (b.type === "table") continue; // rows are fetched with the table
    stack.push(...(b.content || []));
  }
  return missing;
}

export async function fetchNotionPage(url: string): Promise<string | null> {
  const pageId = pageIdFromUrl(url);
  if (!pageId) return null;
  const origin = new URL(url).origin;
  const rm: RecordMap = { block: {}, collection: {} };

  let cursor: any = { stack: [] };
  let spaceId: string | undefined;
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    const data = await post(origin, "loadCachedPageChunkV2", {
      page: { id: pageId }, limit: 100, cursor, chunkNumber: chunk, verticalColumns: false,
    });
    Object.assign(rm.block!, data?.recordMap?.block);
    Object.assign(rm.collection!, data?.recordMap?.collection);
    spaceId ||= data?.spaceId;
    const next = Array.isArray(data?.cursors) ? data.cursors[0] : undefined;
    if (!next?.stack?.length) break;
    cursor = next;
  }

  const root = unwrap(rm.block![pageId]);
  if (!root?.type) return null; // private or deleted page

  // Blocks inside columns and toggles are often left out of the chunks.
  for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
    const missing = missingIds(rm, pageId).slice(0, SYNC_BATCH);
    if (!missing.length) break;
    const data = await post(origin, "syncRecordValuesMain", {
      requests: missing.map((id) => ({ pointer: { table: "block", id, spaceId }, version: -1 })),
    });
    const got = data?.recordMap?.block || {};
    if (!Object.keys(got).length) break;
    Object.assign(rm.block!, got);
  }

  const title = plainText(root.properties?.title) || "Untitled";
  const body = render(origin, rm, root.content, pageId);
  if (!body) return null;
  return `<html><head><title>${escapeHtml(title)}</title></head><body><article data-adapter="notion">` +
    `<h1>${escapeHtml(title)}</h1>${body}</article></body></html>`;
}
