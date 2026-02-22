import { afterEach, describe, expect, it, vi } from "vitest";
import { getCached, getImage, setCache, storeImage } from "../cache";
import type { Env } from "../types";

function createCacheEnv(): {
  env: Env;
  mocks: {
    kvGet: ReturnType<typeof vi.fn>;
    kvPut: ReturnType<typeof vi.fn>;
    r2Get: ReturnType<typeof vi.fn>;
    r2Put: ReturnType<typeof vi.fn>;
  };
  stores: {
    kv: Map<string, string>;
  };
} {
  const kv = new Map<string, string>();

  const kvGet = vi.fn(async (key: string) => kv.get(key) ?? null);
  const kvPut = vi.fn(async (key: string, value: string) => {
    kv.set(key, value);
  });
  const r2Get = vi.fn(async () => null);
  const r2Put = vi.fn(async () => {});

  const env: Env = {
    MYBROWSER: {} as Fetcher,
    CACHE_KV: {
      get: kvGet,
      put: kvPut,
    } as unknown as KVNamespace,
    IMAGE_BUCKET: {
      get: r2Get,
      put: r2Put,
    } as unknown as R2Bucket,
  };

  return {
    env,
    mocks: { kvGet, kvPut, r2Get, r2Put },
    stores: { kv },
  };
}

function payload(id: string) {
  return {
    content: `content-${id}`,
    method: "native",
    title: `title-${id}`,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cache edge behavior", () => {
  it("returns null for invalid cached payload shape", async () => {
    const { env, mocks } = createCacheEnv();
    mocks.kvGet.mockResolvedValueOnce(JSON.stringify({ content: "x", method: "native" }));

    const result = await getCached(env, "https://example.com/bad-shape", "markdown");

    expect(result).toBeNull();
  });

  it("returns null for invalid cached payload json", async () => {
    const { env, mocks } = createCacheEnv();
    mocks.kvGet.mockResolvedValueOnce("{");

    const result = await getCached(env, "https://example.com/invalid-json", "markdown");

    expect(result).toBeNull();
  });

  it("does not use hot cache when ttl is zero", async () => {
    const { env, mocks } = createCacheEnv();
    const url = "https://example.com/no-hot-cache";
    const data = payload("ttl-zero");

    await setCache(env, url, "markdown", data, undefined, 0);
    mocks.kvGet.mockClear();

    const result = await getCached(env, url, "markdown");

    expect(result).toEqual(data);
    expect(mocks.kvGet).toHaveBeenCalledTimes(1);
  });

  it("handles long selector/url keys with hashing and key memoization", async () => {
    const { env, mocks } = createCacheEnv();
    const longSelector = "." + "section ".repeat(80);
    const longUrl = `https://example.com/${"very-long-path/".repeat(80)}article`;
    const data = payload("long-key");
    const digestSpy = vi.spyOn(crypto.subtle, "digest");
    const baseline = digestSpy.mock.calls.length;

    await setCache(env, longUrl, "markdown", data, longSelector);
    await setCache(env, longUrl, "markdown", data, longSelector);

    const [firstKey] = mocks.kvPut.mock.calls[0] as [string, string, { expirationTtl?: number }];
    const [secondKey] = mocks.kvPut.mock.calls[1] as [string, string, { expirationTtl?: number }];

    expect(firstKey.length).toBeLessThanOrEqual(500);
    expect(firstKey).toContain(":sh=");
    expect(firstKey).toContain(":h=");
    expect(secondKey).toBe(firstKey);
    expect(digestSpy.mock.calls.length - baseline).toBe(2);
  });

  it("retries transient kv write failures and then succeeds", async () => {
    vi.useFakeTimers();
    const { env, mocks } = createCacheEnv();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.kvPut
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(undefined);

    const promise = setCache(env, "https://example.com/retry", "markdown", payload("retry"));
    await vi.advanceTimersByTimeAsync(80);
    await promise;

    expect(mocks.kvPut).toHaveBeenCalledTimes(2);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("does not retry non-transient kv write failures", async () => {
    const { env, mocks } = createCacheEnv();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.kvPut.mockRejectedValueOnce(new Error("permission denied"));

    await setCache(env, "https://example.com/no-retry", "markdown", payload("no-retry"));

    expect(mocks.kvPut).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("stores image with hashed key and content-type extension", async () => {
    const { env, mocks } = createCacheEnv();

    const key = await storeImage(
      env,
      "https://cdn.example.com/image.jpg",
      new Uint8Array([1, 2, 3]),
      "image/jpeg; charset=utf-8",
    );

    expect(key.startsWith("images/")).toBe(true);
    expect(key.endsWith(".jpeg")).toBe(true);
    expect(mocks.r2Put).toHaveBeenCalledTimes(1);
    expect(mocks.r2Put.mock.calls[0]?.[2]).toEqual({
      httpMetadata: { contentType: "image/jpeg; charset=utf-8" },
    });
  });

  it("falls back to .bin extension when content type is malformed", async () => {
    const { env } = createCacheEnv();
    const key = await storeImage(
      env,
      "https://cdn.example.com/file",
      new Uint8Array([4, 5]),
      "unknown",
    );

    expect(key.endsWith(".bin")).toBe(true);
  });

  it("retries transient r2 write errors and succeeds", async () => {
    const { env, mocks } = createCacheEnv();
    mocks.r2Put
      .mockRejectedValueOnce(new Error("service unavailable"))
      .mockResolvedValueOnce(undefined);

    const key = await storeImage(
      env,
      "https://cdn.example.com/retry-write.png",
      new Uint8Array([1]),
      "image/png",
    );

    expect(key.startsWith("images/")).toBe(true);
    expect(mocks.r2Put).toHaveBeenCalledTimes(2);
  });

  it("wraps non-transient r2 write errors", async () => {
    const { env, mocks } = createCacheEnv();
    mocks.r2Put.mockRejectedValueOnce(new Error("bad request"));

    await expect(storeImage(
      env,
      "https://cdn.example.com/fail.png",
      new Uint8Array([1]),
      "image/png",
    )).rejects.toThrow("Image storage failed: bad request");
  });

  it("returns null when image key is missing", async () => {
    const { env } = createCacheEnv();
    const result = await getImage(env, "images/missing.png");
    expect(result).toBeNull();
  });

  it("uses default content type when r2 object metadata is missing", async () => {
    const { env, mocks } = createCacheEnv();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    mocks.r2Get.mockResolvedValueOnce({ body: stream });

    const result = await getImage(env, "images/no-meta.png");

    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("image/png");
  });

  it("retries transient r2 read errors and succeeds", async () => {
    vi.useFakeTimers();
    const { env, mocks } = createCacheEnv();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    });
    mocks.r2Get
      .mockRejectedValueOnce(new Error("read timed out"))
      .mockResolvedValueOnce({ body: stream, httpMetadata: { contentType: "image/webp" } });

    const promise = getImage(env, "images/retry-read.webp");
    await vi.advanceTimersByTimeAsync(80);
    const result = await promise;

    expect(result?.contentType).toBe("image/webp");
    expect(mocks.r2Get).toHaveBeenCalledTimes(2);
  });

  it("returns null on non-transient r2 read errors", async () => {
    const { env, mocks } = createCacheEnv();
    mocks.r2Get.mockRejectedValueOnce(new Error("forbidden"));

    const result = await getImage(env, "images/forbidden.png");

    expect(result).toBeNull();
    expect(mocks.r2Get).toHaveBeenCalledTimes(1);
  });
});
