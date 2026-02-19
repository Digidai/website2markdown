import type { Env } from "../types";
import { CACHE_TTL_DEFAULT, CACHE_TTL_SHORT } from "../config";

type CachedPayload = { content: string; method: string; title: string };

/** In-process hot cache to reduce KV roundtrips and JSON parse overhead. */
export const HOT_CACHE_TTL_MS = 15_000;
export const HOT_CACHE_CAPACITY = 256;
const hotCache = new Map<string, { value: CachedPayload; expiresAt: number }>();

/** Small memoization maps to reduce repeated hash/key computation overhead. */
const HASH_MEMO_CAPACITY = 256;
const CACHE_KEY_MEMO_CAPACITY = 512;
const hashMemo = new Map<string, string>();
const cacheKeyMemo = new Map<string, string>();

function touchBoundedMap<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  maxSize: number,
): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function getMemoized<T>(map: Map<string, T>, key: string): T | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  touchBoundedMap(map, key, value, Number.MAX_SAFE_INTEGER);
  return value;
}

function clonePayload(data: CachedPayload): CachedPayload {
  return {
    content: data.content,
    method: data.method,
    title: data.title,
  };
}

function parseCachedPayload(raw: string): CachedPayload | null {
  const parsed = JSON.parse(raw) as Partial<CachedPayload> | null;
  if (
    !parsed ||
    typeof parsed.content !== "string" ||
    typeof parsed.method !== "string" ||
    typeof parsed.title !== "string"
  ) {
    return null;
  }
  return {
    content: parsed.content,
    method: parsed.method,
    title: parsed.title,
  };
}

function getHotCache(key: string): CachedPayload | null {
  const entry = hotCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    hotCache.delete(key);
    return null;
  }
  // touch for recency
  touchBoundedMap(hotCache, key, entry, HOT_CACHE_CAPACITY);
  return clonePayload(entry.value);
}

function putHotCache(key: string, value: CachedPayload, ttlMs: number): void {
  if (ttlMs <= 0) return;
  touchBoundedMap(
    hotCache,
    key,
    { value: clonePayload(value), expiresAt: Date.now() + ttlMs },
    HOT_CACHE_CAPACITY,
  );
}

function hotTtlMs(effectiveTtlSeconds: number): number {
  return Math.max(0, Math.min(HOT_CACHE_TTL_MS, effectiveTtlSeconds * 1000));
}

/** SHA-256 hash (truncated) for cache key deduplication of long URLs. */
async function urlHash(str: string): Promise<string> {
  const memoized = getMemoized(hashMemo, str);
  if (memoized) return memoized;

  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  const hash = Array.from(new Uint8Array(buf).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  touchBoundedMap(hashMemo, str, hash, HASH_MEMO_CAPACITY);
  return hash;
}

/** Build a cache key from URL + format + optional selector. KV key max is 512 bytes. */
async function cacheKey(
  url: string,
  format: string,
  selector?: string,
): Promise<string> {
  const memoKey = `${format}\u0000${selector || ""}\u0000${url}`;
  const memoized = getMemoized(cacheKeyMemo, memoKey);
  if (memoized) return memoized;

  const maxKeyLength = 500;
  let selPart = selector ? `:sel=${selector}` : "";

  // Keep selector bounded in cache keys.
  if (selector && selector.length > 120) {
    const selectorHash = await urlHash(selector);
    selPart = `:sel=${selector.slice(0, 120)}:sh=${selectorHash}`;
  }

  let full = `md:${format}${selPart}:${url}`;
  if (full.length <= maxKeyLength) {
    touchBoundedMap(cacheKeyMemo, memoKey, full, CACHE_KEY_MEMO_CAPACITY);
    return full;
  }

  // If key is still too long, hash selector as well (if not hashed yet).
  if (selector && !selPart.includes(":sh=")) {
    const selectorHash = await urlHash(selector);
    selPart = `:sel=${selector.slice(0, 120)}:sh=${selectorHash}`;
    full = `md:${format}${selPart}:${url}`;
    if (full.length <= maxKeyLength) {
      touchBoundedMap(cacheKeyMemo, memoKey, full, CACHE_KEY_MEMO_CAPACITY);
      return full;
    }
  }

  // Truncate URL and append SHA-256 hash.
  const hash = await urlHash(`${url}|${selector || ""}`);
  const prefix = `md:${format}${selPart}:`;
  const suffix = `:h=${hash}`;
  const maxUrlLength = Math.max(0, maxKeyLength - prefix.length - suffix.length);
  const finalKey = `${prefix}${url.slice(0, maxUrlLength)}${suffix}`;
  touchBoundedMap(cacheKeyMemo, memoKey, finalKey, CACHE_KEY_MEMO_CAPACITY);
  return finalKey;
}

/** Get cached markdown/content from KV. Returns null on miss. */
export async function getCached(
  env: Env,
  url: string,
  format: string,
  selector?: string,
): Promise<CachedPayload | null> {
  try {
    const key = await cacheKey(url, format, selector);

    const hot = getHotCache(key);
    if (hot) return hot;

    const raw = await env.CACHE_KV.get(key, "text");
    if (!raw) return null;
    const parsed = parseCachedPayload(raw);
    if (!parsed) return null;
    putHotCache(key, parsed, HOT_CACHE_TTL_MS);
    return clonePayload(parsed);
  } catch {
    return null;
  }
}

/** Store result in KV cache. */
export async function setCache(
  env: Env,
  url: string,
  format: string,
  data: CachedPayload,
  selector?: string,
  ttl?: number,
): Promise<void> {
  try {
    const key = await cacheKey(url, format, selector);
    const effectiveTtl = ttl ?? getTtlForUrl(url);
    putHotCache(key, data, hotTtlMs(effectiveTtl));
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
 * Store an image in R2 and return its key.
 * Key is a SHA-256 hash of the URL for non-predictable, collision-resistant keys.
 */
export async function storeImage(
  env: Env,
  imageUrl: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<string> {
  // Generate a non-guessable key using SHA-256 hash of the URL
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(imageUrl),
  );
  const hash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Extract extension from content type
  const ext = contentType.split("/")[1]?.split(";")[0]?.trim() || "bin";
  const key = `images/${hash}.${ext}`;

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
