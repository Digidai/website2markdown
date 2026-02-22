import { vi } from "vitest";
import type { Env } from "../types";

export interface EnvMocks {
  kvGet: ReturnType<typeof vi.fn>;
  kvPut: ReturnType<typeof vi.fn>;
  r2Get: ReturnType<typeof vi.fn>;
  r2Put: ReturnType<typeof vi.fn>;
}

export function createMockEnv(overrides?: Partial<Env>): {
  env: Env;
  mocks: EnvMocks;
} {
  const kvGet = vi.fn(async () => null);
  const kvPut = vi.fn(async () => {});
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
    ...overrides,
  };

  return {
    env,
    mocks: {
      kvGet,
      kvPut,
      r2Get,
      r2Put,
    },
  };
}

export function createByteStream(
  chunkSize: number,
  chunkCount: number,
): ReadableStream<Uint8Array> {
  let emitted = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunkCount) {
        controller.close();
        return;
      }
      emitted += 1;
      const chunk = new Uint8Array(chunkSize);
      chunk.fill(0x78); // "x"
      controller.enqueue(chunk);
    },
  });
}
