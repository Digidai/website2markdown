import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

vi.mock("../handlers/convert", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers/convert")>();
  return {
    ...actual,
    convertUrlWithMetrics: vi.fn(),
  };
});

import worker from "../index";
import { ConvertError } from "../helpers/response";
import { convertUrlWithMetrics, type ConvertResult } from "../handlers/convert";
import { createMockEnv, mockCtx } from "./test-helpers";

interface D1StatementCall {
  sql: string;
  binds: unknown[];
  first: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

function convertResult(overrides: Partial<ConvertResult> = {}): ConvertResult {
  return {
    content: "# converted\n\nBody",
    title: "Converted",
    method: "native",
    tokenCount: "4",
    sourceContentType: "text/markdown",
    cached: false,
    diagnostics: {
      cacheHit: false,
      browserRendered: false,
      paywallDetected: false,
      fallbacks: [],
    },
    ...overrides,
  };
}

function createD1Mock(options: {
  authRow?: Record<string, unknown> | null;
  rejectAggregate?: boolean;
} = {}): { db: D1Database; statements: D1StatementCall[] } {
  const statements: D1StatementCall[] = [];
  const prepare = vi.fn((sql: string) => {
    const call: D1StatementCall = {
      sql,
      binds: [],
      first: vi.fn(async () => {
        if (sql.includes("FROM api_keys")) {
          return options.authRow ?? null;
        }
        return null;
      }),
      run: vi.fn(async () => {
        if (sql.includes("conversion_events_daily") && options.rejectAggregate) {
          throw new Error("D1 failed token=aggregate_secret");
        }
        return { success: true };
      }),
    };
    statements.push(call);
    return {
      bind: (...args: unknown[]) => {
        call.binds = args;
        return call;
      },
      first: call.first,
      run: call.run,
    };
  });
  const batch = vi.fn(async (items: Array<{ run: () => Promise<unknown> }>) => {
    return Promise.all(items.map((item) => item.run()));
  });
  return { db: { prepare, batch } as unknown as D1Database, statements };
}

async function flushWaitUntil(ctx: ExecutionContext): Promise<void> {
  const waitUntilMock = ctx.waitUntil as unknown as {
    mock: { calls: Array<[Promise<unknown>]> };
  };
  await Promise.all(waitUntilMock.mock.calls.map(([promise]) => promise));
}

function aggregateStatements(statements: D1StatementCall[]): D1StatementCall[] {
  return statements.filter((statement) => statement.sql.includes("conversion_events_daily"));
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

afterEach(() => {
  vi.mocked(convertUrlWithMetrics).mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("conversion observability", () => {
  it("records successful sync conversion as a sanitized aggregate event", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult());
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock();
    const { env } = createMockEnv({
      AUTH_DB: db,
      ANALYTICS_SALT: "test-salt",
    });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/https://example.com/private?access_token=target_secret&raw=true",
      {
        headers: {
          Accept: "text/markdown",
          "X-Request-ID": "req-success-123",
          Cookie: "md_session=session_secret",
        },
      },
    );
    const res = await worker.fetch(req, env, ctx);
    const body = await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-ID")).toBe("req-success-123");
    expect(body).toContain("# converted");

    const aggregate = aggregateStatements(statements)[0];
    expect(aggregate.binds).toContain("convert");
    expect(aggregate.binds).toContain("success");
    expect(aggregate.binds).toContain(200);
    expect(aggregate.binds).toContain("anonymous");
    expect(aggregate.binds).toContain("generic");
    expect(aggregate.binds).toContain("native");
    expect(aggregate.binds).toContain("miss");

    const persisted = serialize(aggregate.binds);
    const logged = serialize(consoleLog.mock.calls);
    expect(persisted).not.toContain("target_secret");
    expect(persisted).not.toContain("example.com");
    expect(persisted).not.toContain("session_secret");
    expect(logged).toContain("conversion.event");
    expect(logged).not.toContain("target_secret");
    expect(logged).not.toContain("session_secret");
  });

  it("records authenticated tier without persisting raw bearer, account, or key ids", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult());
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock({
      authRow: {
        key_id: "key_raw_123",
        account_id: "acct_raw_456",
        revoked_at: null,
        tier: "pro",
        monthly_credits_used: 7,
        monthly_credits_reset_at: "2099-01-01T00:00:00.000Z",
      },
    });
    const { env } = createMockEnv({
      AUTH_DB: db,
      ANALYTICS_SALT: "test-salt",
    });
    const ctx = mockCtx();

    const req = new Request("https://md.example.com/https://example.com/pro?raw=true", {
      headers: {
        Accept: "text/markdown",
        Authorization: "Bearer mk_secret_test",
      },
    });
    const res = await worker.fetch(req, env, ctx);
    await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Cost")).toBe("1");
    const aggregate = aggregateStatements(statements)[0];
    expect(aggregate.binds).toContain("pro");

    const aggregateWrites = serialize(aggregateStatements(statements));
    expect(aggregateWrites).not.toContain("mk_secret_test");
    expect(aggregateWrites).not.toContain("acct_raw_456");
    expect(aggregateWrites).not.toContain("key_raw_123");
  });

  it("records ConvertError as sanitized failure metadata", async () => {
    vi.mocked(convertUrlWithMetrics).mockRejectedValue(
      new ConvertError(
        "Fetch Failed",
        "upstream failed token=raw_secret at https://example.com/private",
        502,
      ),
    );
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock();
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/https://example.com/fail?raw=true",
      { headers: { Accept: "application/json", "X-Request-ID": "req-error-123" } },
    );
    const res = await worker.fetch(req, env, ctx);
    const payload = await res.json() as { error?: string; status?: number };
    await flushWaitUntil(ctx);

    expect(res.status).toBe(502);
    expect(res.headers.get("X-Request-ID")).toBe("req-error-123");
    expect(payload.error).toBe("Fetch Failed");

    const aggregate = aggregateStatements(statements)[0];
    expect(aggregate.binds).toContain("convert_error");
    expect(aggregate.binds).toContain("fetch_failed");
    expect(aggregate.binds).toContain(502);

    const persisted = serialize(aggregate.binds);
    const logged = serialize(consoleLog.mock.calls);
    expect(persisted).not.toContain("raw_secret");
    expect(persisted).not.toContain("example.com");
    expect(logged).not.toContain("raw_secret");
    expect(logged).not.toContain("example.com");
  });

  it("records unexpected errors without changing the generic 500 response", async () => {
    vi.mocked(convertUrlWithMetrics).mockRejectedValue(
      new Error("boom secret=raw_secret"),
    );
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, statements } = createD1Mock();
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/https://example.com/boom?raw=true",
      { headers: { Accept: "application/json" } },
    );
    const res = await worker.fetch(req, env, ctx);
    const payload = await res.json() as { error?: string; message?: string };
    await flushWaitUntil(ctx);

    expect(res.status).toBe(500);
    expect(payload.error).toBe("Error");
    expect(payload.message).toContain("Failed to process");

    const aggregate = aggregateStatements(statements)[0];
    expect(aggregate.binds).toContain("unexpected_error");
    expect(aggregate.binds).toContain("error");
    expect(aggregate.binds).toContain(500);

    const logs = serialize([consoleLog.mock.calls, consoleError.mock.calls, aggregate.binds]);
    expect(logs).not.toContain("raw_secret");
  });

  it("does not fail conversion when aggregate D1 write fails", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult());
    vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = createD1Mock({ rejectAggregate: true });
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request("https://md.example.com/https://example.com/ok?raw=true", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, env, ctx);
    const body = await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(body).toContain("# converted");
    const errors = serialize(consoleError.mock.calls);
    expect(errors).toContain("Conversion event write failed");
    expect(errors).toContain("token=[redacted]");
    expect(errors).not.toContain("aggregate_secret");
  });

  it("adds request id and sanitized aggregate event to stream conversions", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult({
      method: "jina",
      cached: true,
      diagnostics: {
        cacheHit: true,
        browserRendered: false,
        paywallDetected: false,
        fallbacks: ["firecrawl_error_fallthrough"],
      },
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock();
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Fstream%3Faccess_token%3Dtarget_secret&engine=jina",
      { headers: { "X-Request-ID": "req-stream-123" } },
    );
    const res = await worker.fetch(req, env, ctx);
    const body = await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-ID")).toBe("req-stream-123");
    expect(body).toContain("event: done");

    const aggregate = aggregateStatements(statements)[0];
    expect(aggregate.binds).toContain("stream");
    expect(aggregate.binds).toContain("success");
    expect(aggregate.binds).toContain("jina");
    expect(aggregate.binds).toContain("hit");
    expect(serialize(aggregate.binds)).not.toContain("target_secret");
    expect(serialize(aggregate.binds)).not.toContain("example.com");
  });
});
