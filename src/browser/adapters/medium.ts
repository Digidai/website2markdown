import type { SiteAdapter } from "../../types";
import { DESKTOP_UA } from "../../config";
import { escapeHtml } from "../../security";
import { genericAdapter } from "./generic";

// Hosts known to be Medium. Custom publication domains are not detectable from
// the URL alone and keep the generic path.
const MEDIUM_HOSTS = ["medium.com", "levelup.gitconnected.com", "betterprogramming.pub"];

// Post ids are the hex suffix of the slug (…-841d63574825) or /p/<id>.
const POST_ID = /(?:-|\/p\/)([0-9a-f]{8,12})\/?$/;

const QUERY = `query FullPostQuery($postId: ID!) { post(id: $postId) {
  title isLocked firstPublishedAt creator { name } previewContent { subtitle }
  content { bodyModel { paragraphs {
    type text href
    markups { type start end href }
    metadata { id alt }
    codeBlockMetadata { lang }
    mixtapeMetadata { href }
    iframe { mediaResource { iframeSrc title } }
  } } }
} }`;

interface Markup { type: string; start: number; end: number; href?: string | null }
interface Paragraph {
  type: string;
  text?: string | null;
  href?: string | null;
  markups?: Markup[] | null;
  metadata?: { id?: string | null; alt?: string | null } | null;
  codeBlockMetadata?: { lang?: string | null } | null;
  mixtapeMetadata?: { href?: string | null } | null;
  iframe?: { mediaResource?: { iframeSrc?: string | null; title?: string | null } | null } | null;
}

const TAGS: Record<string, string> = { STRONG: "strong", EM: "em", CODE: "code" };

/** Applies Medium's offset-based markups by splitting the text at every boundary. */
function renderInline(text: string, markups: Markup[]): string {
  const cuts = [...new Set([0, text.length, ...markups.flatMap((m) => [m.start, m.end])])]
    .filter((n) => n >= 0 && n <= text.length)
    .sort((a, b) => a - b);
  let out = "";
  for (let k = 0; k < cuts.length - 1; k++) {
    const [start, end] = [cuts[k], cuts[k + 1]];
    let seg = escapeHtml(text.slice(start, end)).replace(/\n/g, "<br>");
    for (const m of markups) {
      if (m.start > start || m.end < end) continue;
      if (m.type === "A" && m.href) seg = `<a href="${escapeHtml(m.href)}">${seg}</a>`;
      else if (TAGS[m.type]) seg = `<${TAGS[m.type]}>${seg}</${TAGS[m.type]}>`;
    }
    out += seg;
  }
  return out;
}

export function renderMediumParagraphs(paragraphs: Paragraph[], title: string): string {
  let html = "";
  let list: "ul" | "ol" | null = null;
  paragraphs.forEach((p, i) => {
    // The body repeats the title as its first heading.
    if (i === 0 && p.text === title && /^H\d$/.test(p.type)) return;
    const wanted = p.type === "ULI" ? "ul" : p.type === "OLI" ? "ol" : null;
    if (list !== wanted) {
      if (list) html += `</${list}>`;
      if (wanted) html += `<${wanted}>`;
      list = wanted;
    }
    const text = renderInline(p.text ?? "", p.markups ?? []);
    switch (p.type) {
      case "H2": case "H3": case "H4":
        html += `<${p.type.toLowerCase()}>${text}</${p.type.toLowerCase()}>`;
        break;
      case "ULI": case "OLI":
        html += `<li>${text}</li>`;
        break;
      case "BQ": case "PQ":
        html += `<blockquote><p>${text}</p></blockquote>`;
        break;
      case "PRE": {
        const lang = p.codeBlockMetadata?.lang;
        html += `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(p.text ?? "")}</code></pre>`;
        break;
      }
      case "IMG":
        if (p.metadata?.id) {
          html += `<figure><img src="https://miro.medium.com/v2/resize:fit:1400/${escapeHtml(p.metadata.id)}"` +
            ` alt="${escapeHtml(p.metadata.alt ?? "")}">${text ? `<figcaption>${text}</figcaption>` : ""}</figure>`;
        }
        break;
      case "IFRAME": {
        const src = p.iframe?.mediaResource?.iframeSrc;
        if (src) html += `<p><a href="${escapeHtml(src)}">${escapeHtml(p.iframe?.mediaResource?.title || src)}</a></p>`;
        break;
      }
      case "MIXTAPE_EMBED": {
        const href = p.mixtapeMetadata?.href || p.href;
        html += href ? `<p><a href="${escapeHtml(href)}">${escapeHtml(p.text || href)}</a></p>` : `<p>${text}</p>`;
        break;
      }
      default:
        if (text) html += `<p>${text}</p>`;
    }
  });
  if (list) html += `</${list}>`;
  return html;
}

/**
 * Medium answers bare article requests from Workers with 403, but its own
 * GraphQL endpoint returns the post body as structured paragraphs. Works for
 * any post age; member-only posts return the free preview only.
 */
export const mediumAdapter: SiteAdapter = {
  ...genericAdapter,

  match(url: string): boolean {
    try {
      const { hostname, pathname } = new URL(url);
      const isMedium = MEDIUM_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
      return isMedium && POST_ID.test(pathname);
    } catch {
      return false;
    }
  },

  async fetchDirect(url: string): Promise<string | null> {
    const postId = new URL(url).pathname.match(POST_ID)?.[1];
    if (!postId) return null;
    try {
      const resp = await fetch("https://medium.com/_/graphql", {
        method: "POST",
        headers: {
          "User-Agent": DESKTOP_UA,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Xsrf-Token": "1",
          "X-Obvious-CID": "android",
        },
        body: JSON.stringify({ operationName: "FullPostQuery", variables: { postId }, query: QUERY }),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return null;
      const post = ((await resp.json()) as any)?.data?.post;
      const paragraphs: Paragraph[] | undefined = post?.content?.bodyModel?.paragraphs;
      if (!Array.isArray(paragraphs) || paragraphs.length === 0) return null;

      const title = String(post.title || postId);
      const date = post.firstPublishedAt ? new Date(post.firstPublishedAt).toISOString().slice(0, 10) : "";
      const byline = [post.creator?.name, date].filter(Boolean).join(" · ");
      return `<html><head><title>${escapeHtml(title)}</title></head><body><article data-adapter="medium">` +
        `<h1>${escapeHtml(title)}</h1>` +
        (byline ? `<p>${escapeHtml(byline)}</p>` : "") +
        (post.isLocked ? `<p><em>Member-only story: only the free preview is included.</em></p>` : "") +
        renderMediumParagraphs(paragraphs, title) +
        `</article></body></html>`;
    } catch {
      return null;
    }
  },
};
