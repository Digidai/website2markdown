import type { Env } from "../types";
import { CACHE_TTL_DEFAULT, CACHE_TTL_SHORT } from "../config";

/** Build a cache key from URL + format params. */
function cacheKey(url: string, format: string): string {
  return `md:${format}:${url}`;
}

/** Get cached markdown/content from KV. Returns null on miss. */
export async function getCached(
  env: Env,
  url: string,
  format: string,
): Promise<{ content: string; method: string; title: string } | null> {
  try {
    const key = cacheKey(url, format);
    const raw = await env.CACHE_KV.get(key, "text");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Store result in KV cache. */
export async function setCache(
  env: Env,
  url: string,
  format: string,
  data: { content: string; method: string; title: string },
  ttl?: number,
): Promise<void> {
  try {
    const key = cacheKey(url, format);
    const effectiveTtl = ttl ?? getTtlForUrl(url);
    await env.CACHE_KV.put(key, JSON.stringify(data), {
      expirationTtl: effectiveTtl,
    });
  } catch (e) {
    console.error("Cache write failed:", e instanceof Error ? e.message : e);
  }
}

/** Determine TTL based on URL pattern. */
function getTtlForUrl(url: string): number {
  // WeChat articles and Feishu docs rarely change
  if (
    url.includes("mp.weixin.qq.com") ||
    url.includes(".feishu.cn/") ||
    url.includes(".larksuite.com/")
  ) {
    return CACHE_TTL_DEFAULT;
  }
  // News and dynamic sites
  if (
    url.includes("zhihu.com") ||
    url.includes("juejin.cn") ||
    url.includes("twitter.com") ||
    url.includes("x.com")
  ) {
    return CACHE_TTL_SHORT;
  }
  return CACHE_TTL_DEFAULT;
}

/**
 * Store an image in R2 and return its proxy path.
 * Key is derived from the image URL's pathname.
 */
export async function storeImage(
  env: Env,
  imageUrl: string,
  data: ArrayBuffer,
  contentType: string,
): Promise<string> {
  // Use URL pathname as key (strip leading slash)
  let key: string;
  try {
    key = new URL(imageUrl).pathname.slice(1);
  } catch {
    key = `img/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  // Prefix to avoid collisions
  key = `images/${key}`;

  await env.IMAGE_BUCKET.put(key, data, {
    httpMetadata: { contentType },
  });

  return key;
}

/** Get an image from R2. */
export async function getImage(
  env: Env,
  key: string,
): Promise<{ data: ReadableStream; contentType: string } | null> {
  try {
    const obj = await env.IMAGE_BUCKET.get(key);
    if (!obj) return null;
    return {
      data: obj.body,
      contentType: obj.httpMetadata?.contentType || "image/png",
    };
  } catch {
    return null;
  }
}
