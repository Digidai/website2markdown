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

/** Mock ExecutionContext for tests (fetch handler's 3rd argument) */
export function mockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
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

export function createApiKeyAuthD1(
  overrides: Record<string, unknown> = {},
): D1Database {
  const prepare = vi.fn((sql: string) => {
    const stmt = {
      bind: vi.fn(() => stmt),
      first: vi.fn(async () => {
        if (sql.includes("FROM api_keys")) {
          return {
            key_id: "key_test_123",
            account_id: "acct_test_123",
            revoked_at: null,
            tier: "pro",
            monthly_credits_used: 0,
            monthly_credits_reset_at: "2099-01-01T00:00:00.000Z",
            ...overrides,
          };
        }
        return null;
      }),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
    };
    return stmt;
  });
  const batch = vi.fn(async (items: Array<{ run: () => Promise<unknown> }>) =>
    Promise.all(items.map((item) => item.run()))
  );
  return { prepare, batch } as unknown as D1Database;
}
