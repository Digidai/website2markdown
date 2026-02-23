import type { SiteAdapter, ExtractResult } from "../../types";
import { escapeHtml } from "../../security";

const FETCH_OPTS = {
  headers: { "User-Agent": "website2markdown/1.0" },
  signal: undefined as AbortSignal | undefined,
};

/** Minimal tweet shape from fxtwitter. */
interface FxRichText {
  text?: string;
}

interface FxArticleBlock {
  type?: string;
  text?: string;
}

interface FxArticle {
  id?: string;
  title?: string;
  preview_text?: string;
  cover_media?: {
    media_info?: {
      original_img_url?: string;
    };
  };
  content?: {
    blocks?: FxArticleBlock[];
  };
}

interface FxTweet {
  id: string;
  text: string;
  raw_text?: FxRichText;
  author?: { name?: string; screen_name?: string };
  created_at?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  replying_to?: string | null;
  replying_to_status?: string | null;
  media?: {
    photos?: { url?: string }[];
    videos?: { thumbnail_url?: string; url?: string }[];
  };
  quote?: {
    author?: { name?: string; screen_name?: string };
    text?: string;
  };
  article?: FxArticle;
}

/** Fetch a single tweet from fxtwitter. Returns null on failure. */
async function fetchTweet(user: string, id: string): Promise<FxTweet | null> {
  try {
    const resp = await fetch(`https://api.fxtwitter.com/${user}/status/${id}`, {
      headers: FETCH_OPTS.headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    return data?.tweet ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the full thread via fxtwitter.
 *
 * 1. Walk UP from the target tweet following `replying_to_status` (same-author self-replies).
 * 2. Walk DOWN from the target tweet: use the syndication timeline to discover
 *    continuation tweets sharing the same `conversation_id`.
 *
 * Returns tweets sorted chronologically, or just the single target tweet on failure.
 */
async function fetchThread(user: string, id: string): Promise<FxTweet[]> {
  const target = await fetchTweet(user, id);
  if (!target) return [];

  const screenName = target.author?.screen_name || user;

  // ── Walk UP ──
  const ancestors: FxTweet[] = [];
  let current = target;
  const seen = new Set<string>([target.id]);
  while (
    current.replying_to_status &&
    current.replying_to?.toLowerCase() === screenName.toLowerCase() &&
    ancestors.length < 50
  ) {
    const parent = await fetchTweet(screenName, current.replying_to_status);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    ancestors.unshift(parent); // prepend — oldest first
    current = parent;
  }

  // Root tweet is ancestors[0] if we walked up, otherwise it's the target itself
  const rootId = ancestors.length > 0 ? ancestors[0].id : target.id;

  // ── Walk DOWN via syndication timeline ──
  const descendants: FxTweet[] = [];
  try {
    const timelineUrl =
      `https://syndication.twitter.com/srv/timeline-profile/screen-name/${screenName}` +
      `?reply_filter=self_threads`;
    const resp = await fetch(timelineUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; website2markdown/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      const html = await resp.text();
      // Extract __NEXT_DATA__ JSON
      const jsonMatch = html.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        const entries: any[] =
          data?.props?.pageProps?.timeline?.entries ?? [];
        // Collect all tweets from the same conversation
        for (const entry of entries) {
          const tweet = entry?.content?.tweet;
          if (!tweet) continue;
          if (tweet.conversation_id_str !== rootId) continue;
          const tid = tweet.id_str as string;
          if (seen.has(tid)) continue;
          seen.add(tid);
          // Convert syndication format → FxTweet shape
          descendants.push({
            id: tid,
            text: tweet.full_text || tweet.text || "",
            author: {
              name: tweet.user?.name,
              screen_name: tweet.user?.screen_name,
            },
            created_at: tweet.created_at,
            likes: tweet.favorite_count,
            retweets: tweet.retweet_count,
            replies: tweet.reply_count,
            replying_to_status: tweet.in_reply_to_status_id_str,
            media: {
              photos: (tweet.entities?.media ?? tweet.mediaDetails ?? [])
                .filter((m: any) => m.type === "photo")
                .map((m: any) => ({ url: m.media_url_https })),
              videos: (tweet.mediaDetails ?? [])
                .filter((m: any) => m.type === "video")
                .map((m: any) => ({
                  thumbnail_url: m.media_url_https,
                  url: m.video_info?.variants?.[0]?.url,
                })),
            },
          });
        }
      }
    }
  } catch {
    // Syndication failed — we still have ancestors + target
  }

  // ── Merge & sort by ID (chronological for snowflake IDs) ──
  const all = [...ancestors, target, ...descendants];
  all.sort((a, b) => {
    if (a.id.length !== b.id.length) return a.id.length - b.id.length;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return all;
}

/** Render a single tweet as an HTML <article> section. */
function getTweetText(tweet: FxTweet): string {
  const text = (tweet.text || "").trim();
  if (text) return text;
  return (tweet.raw_text?.text || "").trim();
}

function renderArticleContent(article: FxArticle): string {
  let html = `<article>`;

  const title = escapeHtml(article.title || "");
  if (title) {
    html += `<h2>${title}</h2>`;
  }

  const coverSrc = escapeHtml(article.cover_media?.media_info?.original_img_url || "");
  if (coverSrc) {
    html += `<figure><img src="${coverSrc}" /></figure>`;
  }

  const blocks = article.content?.blocks ?? [];
  let renderedBlocks = 0;
  let orderedIndex = 1;

  for (const block of blocks) {
    const blockType = block.type || "unstyled";
    const rawText = (block.text || "").trim();
    if (!rawText) continue;

    const text = escapeHtml(rawText).replace(/\n/g, "<br>");
    renderedBlocks++;

    if (blockType === "header-one") {
      html += `<h3>${text}</h3>`;
      continue;
    }
    if (blockType === "header-two") {
      html += `<h4>${text}</h4>`;
      continue;
    }
    if (blockType === "header-three") {
      html += `<h5>${text}</h5>`;
      continue;
    }
    if (blockType === "blockquote") {
      html += `<blockquote><p>${text}</p></blockquote>`;
      continue;
    }
    if (blockType === "unordered-list-item") {
      html += `<p>- ${text}</p>`;
      continue;
    }
    if (blockType === "ordered-list-item") {
      html += `<p>${orderedIndex}. ${text}</p>`;
      orderedIndex++;
      continue;
    }

    html += `<p>${text}</p>`;
  }

  if (renderedBlocks === 0) {
    const preview = escapeHtml(article.preview_text || "").replace(/\n/g, "<br>");
    if (preview) {
      html += `<p>${preview}</p>`;
    }
  }

  html += `</article>`;
  return html;
}

function renderTweetSection(tweet: FxTweet): string {
  const tweetText = getTweetText(tweet);
  const hideLinkOnlyText = Boolean(
    tweet.article &&
    /^https?:\/\/t\.co\/[A-Za-z0-9]+$/i.test(tweetText),
  );
  let section = `<section>`;
  if (tweetText && !hideLinkOnlyText) {
    section += `<p>${escapeHtml(tweetText).replace(/\n/g, "<br>")}</p>`;
  }

  if (tweet.article) {
    section += renderArticleContent(tweet.article);
  }

  if (tweet.media?.photos?.length) {
    for (const photo of tweet.media.photos) {
      const src = escapeHtml(photo.url || "");
      if (src) section += `<figure><img src="${src}" /></figure>`;
    }
  }

  if (tweet.media?.videos?.length) {
    for (const video of tweet.media.videos) {
      const thumb = escapeHtml(video.thumbnail_url || "");
      const vidUrl = escapeHtml(video.url || "");
      if (thumb) section += `<figure><img src="${thumb}" /><figcaption>Video: ${vidUrl}</figcaption></figure>`;
    }
  }

  if (tweet.quote) {
    const qAuthor = escapeHtml(tweet.quote.author?.name || "");
    const qHandle = escapeHtml(tweet.quote.author?.screen_name || "");
    const qText = escapeHtml(tweet.quote.text || "");
    section += `<blockquote>`;
    section += `<p><strong>${qAuthor} (@${qHandle})</strong></p>`;
    section += `<p>${qText.replace(/\n/g, "<br>")}</p>`;
    section += `</blockquote>`;
  }

  section += `</section>`;
  return section;
}

/** Build full HTML from a list of thread tweets. */
function buildThreadHtml(tweets: FxTweet[], user: string): string {
  const first = tweets[0];
  const author = escapeHtml(first.author?.name || "");
  const handle = escapeHtml(first.author?.screen_name || user);
  const isThread = tweets.length > 1;

  let html = `<html><head><title>${author} (@${handle}) on X</title></head><body>`;
  html += `<article>`;
  html += `<h1>${author} (@${handle})${isThread ? " — Thread" : ""}</h1>`;

  for (let i = 0; i < tweets.length; i++) {
    html += renderTweetSection(tweets[i]);
  }

  // Stats from the first tweet (thread root)
  const timestamp = first.created_at || "";
  const likes = first.likes ?? 0;
  const retweets = first.retweets ?? 0;
  const replies = first.replies ?? 0;
  html += `<footer>`;
  if (timestamp) html += `<time>${escapeHtml(timestamp)}</time> · `;
  if (isThread) html += `${tweets.length} tweets · `;
  html += `${replies} replies · ${retweets} retweets · ${likes} likes`;
  html += `</footer>`;

  html += `</article></body></html>`;
  return html;
}

/** Fallback: fetch tweet via Twitter's oEmbed API. Returns basic HTML. */
async function fetchViaOembed(tweetUrl: string): Promise<string | null> {
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
    const resp = await fetch(oembedUrl, {
      headers: FETCH_OPTS.headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;

    const data = (await resp.json()) as any;
    const embedHtml = data?.html;
    if (!embedHtml) return null;

    const author = escapeHtml(data.author_name || "");
    const authorUrl = data.author_url || "";
    const handleMatch = authorUrl.match(/(?:twitter|x)\.com\/([^/?]+)/);
    const handle = escapeHtml(handleMatch ? handleMatch[1] : "");

    let html = `<html><head><title>${author} (@${handle}) on X</title></head><body>`;
    html += `<article>`;
    html += `<h1>${author} (@${handle})</h1>`;
    html += embedHtml;
    html += `</article></body></html>`;
    return html;
  } catch {
    return null;
  }
}

export const twitterAdapter: SiteAdapter = {
  match(url: string): boolean {
    return /:\/\/(www\.)?x\.com\//.test(url) || url.includes("twitter.com/");
  },

  alwaysBrowser: false,

  async fetchDirect(url: string): Promise<string | null> {
    const match = url.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/);
    if (!match) return null;

    const [, user, id] = match;

    // 1. Try full thread fetch via fxtwitter + syndication
    const thread = await fetchThread(user, id);
    if (thread.length > 0) {
      return buildThreadHtml(thread, user);
    }

    // 2. Fallback: Twitter oEmbed API
    return fetchViaOembed(url);
  },

  async configurePage(page: any): Promise<void> {
    await page.setViewport({ width: 1280, height: 900 });
  },

  async extract(_page: any): Promise<ExtractResult | null> {
    return null;
  },
};
