/**
 * Medium answers every page, its GraphQL API and /p/<id> with a Cloudflare
 * challenge. Its RSS feeds still carry the full HTML of an author's or a
 * publication's recent free posts, so a blocked article is read from there.
 * Member-only posts appear in the feed with a snippet only and are skipped.
 */

const POST_ID = /-([0-9a-f]{8,12})$/;

/** The feed that lists a Medium post, and the post id to find in it. */
export function mediumFeedFor(url: string): { feedUrl: string; postId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  if (host === "medium.com" || host === "www.medium.com") {
    if (segments[0] === "p" && /^[0-9a-f]{8,12}$/.test(segments[1] || "")) return null; // no owner to find a feed for
    const postId = POST_ID.exec(last)?.[1];
    if (!postId || segments.length < 2) return null;
    return { feedUrl: `https://medium.com/feed/${segments[0]}`, postId };
  }
  // A subdomain is either an author or a publication (onezero.medium.com);
  // its own /feed serves both.
  const sub = /^([a-z0-9-]+)\.medium\.com$/.exec(host)?.[1];
  const postId = POST_ID.exec(last)?.[1];
  if (!sub || sub === "www" || !postId) return null;
  return { feedUrl: `https://${sub}.medium.com/feed`, postId };
}

function cdata(block: string, tag: string): string {
  const match = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(block);
  return match?.[1]?.trim() ?? "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

/** An article document for the post, or null when the feed has no full text for it. */
export function mediumArticleFromFeed(xml: string, postId: string): string | null {
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const guid = cdata(item, "guid") || /<guid[^>]*>([^<]*)<\/guid>/.exec(item)?.[1] || "";
    if (!guid.endsWith(`/p/${postId}`)) continue;
    const body = cdata(item, "content:encoded");
    if (!body) return null;
    const title = escapeHtml(cdata(item, "title"));
    const author = cdata(item, "dc:creator");
    return `<!doctype html><html><head><title>${title}</title>` +
      (author ? `<meta name="author" content="${escapeHtml(author)}">` : "") +
      `</head><body><article><h1>${title}</h1>${body}</article></body></html>`;
  }
  return null;
}
