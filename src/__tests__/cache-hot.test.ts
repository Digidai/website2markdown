import { afterEach, describe, expect, it, vi } from "vitest";
import { getCached, HOT_CACHE_CAPACITY, HOT_CACHE_TTL_MS, setCache } from "../cache";
import type { Env } from "../types";

type CachedPayload = { content: string; method: string; title: string };

function makePayload(id: string): CachedPayload {
  return {
    content: `content-${id}`,
    method: "native",
    title: `title-${id}`,
  };
}

function createEnv(options?: { throwOnGet?: boolean; throwOnPut?: boolean }): {
  env: Env;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  const kvStore = new Map<string, string>();
  const get = vi.fn(async (key: string) => {
    if (options?.throwOnGet) {
      throw new Error("kv get failed");
    }
    return kvStore.get(key) ?? null;
  });
  const put = vi.fn(async (key: string, value: string) => {
    if (options?.throwOnPut) {
      throw new Error("kv put failed");
    }
    kvStore.set(key, value);
  });

  const env = {
    MYBROWSER: {} as never,
    CACHE_KV: { get, put } as never,
    IMAGE_BUCKET: {} as never,
  } as unknown as Env;

  return { env, get, put };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cache hot layer", () => {
  it("returns hot cache directly on hit without reading KV", async () => {
    const { env, get } = createEnv();
    const url = `https://example.com/hot-hit-${Date.now()}`;
    const data = makePayload("hit");

    await setCache(env, url, "markdown", data);
    get.mockClear();

    const cached = await getCached(env, url, "markdown");
    expect(cached).toEqual(data);
    expect(get).not.toHaveBeenCalled();
  });

  it("expires hot cache by TTL and falls back to KV", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T00:00:00.000Z"));

    const { env, get } = createEnv();
    const url = "https://example.com/hot-expire";
    const data = makePayload("expire");

    await setCache(env, url, "markdown", data);
    get.mockClear();

    const hot = await getCached(env, url, "markdown");
    expect(hot).toEqual(data);
    expect(get).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HOT_CACHE_TTL_MS + 1);

    const fromKv = await getCached(env, url, "markdown");
    expect(fromKv).toEqual(data);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("evicts older entries when capacity is exceeded", async () => {
    const { env, get } = createEnv();
    const total = HOT_CACHE_CAPACITY + 100;
    const urls: string[] = [];

    for (let i = 0; i < total; i += 1) {
      const url = `https://example.com/hot-capacity-${Date.now()}-${i}`;
      urls.push(url);
      await setCache(env, url, "markdown", makePayload(String(i)));
    }

    get.mockClear();

    const oldest = await getCached(env, urls[0], "markdown");
    const newest = await getCached(env, urls[urls.length - 1], "markdown");

    expect(oldest).toEqual(makePayload("0"));
    expect(newest).toEqual(makePayload(String(total - 1)));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("degrades gracefully when KV throws errors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T00:00:00.000Z"));

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, get, put } = createEnv({ throwOnGet: true, throwOnPut: true });
    const url = "https://example.com/hot-kv-error";
    const data = makePayload("kv-error");

    await expect(setCache(env, url, "markdown", data)).resolves.toBeUndefined();
    expect(put).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();

    get.mockClear();
    const hot = await getCached(env, url, "markdown");
    expect(hot).toEqual(data);
    expect(get).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HOT_CACHE_TTL_MS + 1);
    const afterExpire = await getCached(env, url, "markdown");
    expect(afterExpire).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
