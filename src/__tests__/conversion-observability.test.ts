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
import {
  cleanupExpiredDebugTraces,
  cleanupExpiredOperationalRows,
} from "../observability/conversion-events";
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
  sessionRow?: Record<string, unknown> | null;
  rejectAggregate?: boolean;
  rejectDebugTrace?: boolean;
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
        if (sql.includes("FROM sessions")) {
          return options.sessionRow ?? null;
        }
        return null;
      }),
      run: vi.fn(async () => {
        if (sql.includes("conversion_events_daily") && options.rejectAggregate) {
          throw new Error("D1 failed token=aggregate_secret");
        }
        if (sql.includes("conversion_debug_traces") && options.rejectDebugTrace) {
          throw new Error("D1 failed token=debug_secret");
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

function debugTraceStatements(statements: D1StatementCall[]): D1StatementCall[] {
  return statements.filter((statement) => statement.sql.includes("conversion_debug_traces"));
}

function usageStatements(statements: D1StatementCall[]): D1StatementCall[] {
  return statements.filter((statement) => statement.sql.includes("usage_daily"));
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

  it("writes redacted debug trace for authenticated stream opt-in callers", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult({
      method: "jina",
      content: "# Stream\n\n[url](https://example.com/private?token=raw_token)",
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock({
      authRow: {
        key_id: "key_raw_123",
        account_id: "acct_raw_456",
        revoked_at: null,
        tier: "pro",
        monthly_credits_used: 0,
        monthly_credits_reset_at: "2099-01-01T00:00:00.000Z",
      },
    });
    const { env } = createMockEnv({
      AUTH_DB: db,
      ANALYTICS_SALT: "test-salt",
    });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Fstream%3Ftoken%3Dtarget_secret&debug_trace=true&engine=jina",
      {
        headers: {
          Authorization: "Bearer mk_secret_test",
          "X-Request-ID": "req-stream-debug",
        },
      },
    );
    const res = await worker.fetch(req, env, ctx);
    const body = await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Debug-Trace")).toBe("accepted");
    expect(body).toContain("event: done");

    const debug = debugTraceStatements(statements).find((statement) =>
      statement.sql.includes("INSERT INTO conversion_debug_traces")
    );
    expect(debug).toBeTruthy();
    const binds = serialize(debug?.binds);
    expect(binds).toContain("stream");
    expect(binds).toContain("req-stream-debug");
    expect(binds).not.toContain("target_secret");
    expect(binds).not.toContain("raw_token");
    expect(binds).not.toContain("mk_secret_test");
    const usage = usageStatements(statements)[0];
    expect(usage?.binds).toContain("key_raw_123");
    expect(usage?.binds).toContain(1);
  });

  it("rejects anonymous stream restricted engine before conversion", async () => {
    const { db, statements } = createD1Mock();
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Fstream&engine=sk_live_secret_value&debug_trace=true",
    );
    const res = await worker.fetch(req, env, ctx);
    const payload = await res.json() as { error?: string; message?: string };
    await flushWaitUntil(ctx);

    expect(res.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
    expect(payload.message).toContain("engine selection requires a Pro API key");
    expect(res.headers.get("X-Debug-Trace")).toBeNull();
    expect(vi.mocked(convertUrlWithMetrics)).not.toHaveBeenCalled();
    expect(serialize(statements)).not.toContain("sk_live_secret_value");
  });

  it("does not report accepted debug trace for stream pre-validation failures", async () => {
    const { db, statements } = createD1Mock({
      authRow: {
        key_id: "key_raw_123",
        account_id: "acct_raw_456",
        revoked_at: null,
        tier: "pro",
        monthly_credits_used: 0,
        monthly_credits_reset_at: "2099-01-01T00:00:00.000Z",
      },
    });
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request("https://md.example.com/api/stream?url=not-a-url&debug_trace=true", {
      headers: { Authorization: "Bearer mk_stream_invalid_test" },
    });
    const res = await worker.fetch(req, env, ctx);
    const body = await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Debug-Trace")).toBeNull();
    expect(body).toContain("event: fail");
    expect(body).toContain("Invalid URL");
    expect(debugTraceStatements(statements)).toHaveLength(0);
  });

  it("does not write debug trace for anonymous callers that request it", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult());
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock();
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/https://example.com/a?raw=true&debug_trace=true&access_token=target_secret",
      { headers: { Accept: "text/markdown" } },
    );
    const res = await worker.fetch(req, env, ctx);
    await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Debug-Trace")).toBe("not-authorized");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("X-Debug-Trace");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-Debug-Trace");
    expect(debugTraceStatements(statements)).toHaveLength(0);
    expect(vi.mocked(convertUrlWithMetrics).mock.calls[0][0]).not.toContain("debug_trace");
  });

  it("carries document navigation debug trace into session-authenticated stream conversion", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult({
      method: "jina",
      content: "# Session stream\n\nBody",
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock({
      sessionRow: {
        session_id: "sess_raw_123",
        account_id: "acct_raw_456",
        expires_at: "2099-01-01T00:00:00.000Z",
        email: "person@example.com",
        tier: "pro",
        github_id: null,
      },
    });
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });

    const navReq = new Request("https://md.example.com/https://example.com/nav?debug_trace=true", {
      headers: {
        Accept: "text/html",
        "Sec-Fetch-Dest": "document",
        Cookie: "md_session=session_secret",
      },
    });
    const navRes = await worker.fetch(navReq, env, mockCtx());
    const html = await navRes.text();

    expect(navRes.status).toBe(200);
    expect(navRes.headers.get("X-Debug-Trace")).toBeNull();
    expect(html).toContain("debug_trace=true");

    const streamCtx = mockCtx();
    const streamReq = new Request(
      "https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Fnav&debug_trace=true",
      { headers: { Cookie: "md_session=session_secret" } },
    );
    const streamRes = await worker.fetch(streamReq, env, streamCtx);
    const body = await streamRes.text();
    await flushWaitUntil(streamCtx);

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("X-Debug-Trace")).toBe("accepted");
    expect(body).toContain("event: done");

    const debug = debugTraceStatements(statements).find((statement) =>
      statement.sql.includes("INSERT INTO conversion_debug_traces")
    );
    expect(debug).toBeTruthy();
    const binds = serialize(debug?.binds);
    expect(binds).toContain("stream");
    expect(binds).toContain("jina");
    expect(binds).not.toContain("session_secret");
    expect(binds).not.toContain("person@example.com");
    expect(binds).not.toContain("acct_raw_456");
  });

  it("does not report accepted debug trace on pre-conversion policy rejection", async () => {
    const { db, statements } = createD1Mock({
      authRow: {
        key_id: "key_raw_123",
        account_id: "acct_raw_456",
        revoked_at: null,
        tier: "free",
        monthly_credits_used: 0,
        monthly_credits_reset_at: "2099-01-01T00:00:00.000Z",
      },
    });
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/https://example.com/private?raw=true&no_cache=true&debug_trace=true",
      {
        headers: {
          Accept: "text/markdown",
          Authorization: "Bearer mk_free_policy_test",
        },
      },
    );
    const res = await worker.fetch(req, env, ctx);
    await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(401);
    expect(res.headers.get("X-Debug-Trace")).toBeNull();
    expect(vi.mocked(convertUrlWithMetrics)).not.toHaveBeenCalled();
    expect(debugTraceStatements(statements)).toHaveLength(0);
  });

  it("reports debug trace as unavailable when legacy auth has no D1 trace store", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult());
    const { env } = createMockEnv({ PUBLIC_API_TOKEN: "public-token" });
    const ctx = mockCtx();

    const req = new Request("https://md.example.com/https://example.com/legacy?raw=true&debug_trace=true", {
      headers: {
        Accept: "text/markdown",
        Authorization: "Bearer public-token",
      },
    });
    const res = await worker.fetch(req, env, ctx);
    const body = await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(body).toContain("# converted");
    expect(res.headers.get("X-Debug-Trace")).toBe("not-available");
  });

  it("writes session-authenticated document cache hit debug trace with redacted cached excerpt", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock({
      sessionRow: {
        session_id: "sess_raw_123",
        account_id: "acct_raw_456",
        expires_at: "2099-01-01T00:00:00.000Z",
        email: "person@example.com",
        tier: "pro",
        github_id: null,
      },
    });
    const { env, mocks } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    mocks.kvGet.mockResolvedValueOnce(JSON.stringify({
      content: "# Cached\n\napi_key: cached_secret\nContact cached@example.com",
      method: "native",
      title: "Cached Debug",
      sourceContentType: "text/markdown",
    }));
    const ctx = mockCtx();

    const req = new Request("https://md.example.com/https://example.com/cached-debug?debug_trace=true", {
      headers: {
        Accept: "text/html",
        "Sec-Fetch-Dest": "document",
        Cookie: "md_session=session_secret",
      },
    });
    const res = await worker.fetch(req, env, ctx);
    const html = await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Debug-Trace")).toBe("accepted");
    expect(html).toContain("Cached Debug");

    const debug = debugTraceStatements(statements).find((statement) =>
      statement.sql.includes("INSERT INTO conversion_debug_traces")
    );
    expect(debug).toBeTruthy();
    const binds = serialize(debug?.binds);
    expect(binds).toContain("text/markdown");
    expect(binds).toContain("Cached");
    expect(binds).not.toContain("cached_secret");
    expect(binds).not.toContain("cached@example.com");
    expect(binds).not.toContain("session_secret");
    expect(binds).not.toContain("acct_raw_456");
  });

  it("writes short-lived redacted debug trace for authenticated opt-in callers", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult({
      content:
        [
          "# Private",
          "Contact user@example.com at https://example.com/private?token=raw_token",
          "secret=raw_secret",
          "\"api_key\": \"json_secret\"",
          "token: yaml_secret",
          "Authorization: Basic basic_secret",
          "Cookie: sid=session_cookie; cf_clearance=clearance_secret",
        ].join("\n"),
      method: "firecrawl",
      sourceContentType: "text/html; charset=utf-8",
      diagnostics: {
        cacheHit: false,
        browserRendered: false,
        paywallDetected: true,
        fallbacks: ["jina_fallback"],
      },
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, statements } = createD1Mock({
      authRow: {
        key_id: "key_raw_123",
        account_id: "acct_raw_456",
        revoked_at: null,
        tier: "pro",
        monthly_credits_used: 0,
        monthly_credits_reset_at: "2099-01-01T00:00:00.000Z",
      },
    });
    const { env } = createMockEnv({
      AUTH_DB: db,
      ANALYTICS_SALT: "test-salt",
      DEBUG_TRACE_RETENTION_DAYS: "3",
      DEBUG_TRACE_MAX_CONTENT_CHARS: "512",
    });
    const ctx = mockCtx();

    const req = new Request(
      "https://md.example.com/https://example.com/private/123456789012?raw=true&debug_trace=true&access_token=target_secret&q=search&sk_live_query_secret=value",
      {
        headers: {
          Accept: "text/markdown",
          Authorization: "Bearer mk_secret_test",
          Cookie: "md_session=session_secret",
          "X-Request-ID": "mk_secret_request_id_value",
        },
      },
    );
    const res = await worker.fetch(req, env, ctx);
    await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Debug-Trace")).toBe("accepted");

    const debug = debugTraceStatements(statements).find((statement) =>
      statement.sql.includes("INSERT INTO conversion_debug_traces")
    );
    expect(debug).toBeTruthy();
    const binds = serialize(debug?.binds);
    expect(binds).toContain("firecrawl");
    expect(binds).toContain("text/html; charset=utf-8");
    expect(binds).toContain("jina_fallback");
    expect(binds).toContain("https://example.com/[path:2]");
    expect(binds).toContain("redacted_1");
    expect(binds).toContain("param_2");
    expect(binds).toContain("redacted_3");
    expect(binds).not.toContain("private/123456789012");
    expect(binds).not.toContain("mk_secret_request_id_value");
    expect(binds).not.toContain("access_token");
    expect(binds).not.toContain("sk_live_query_secret");
    expect(binds).not.toContain("target_secret");
    expect(binds).not.toContain("raw_token");
    expect(binds).not.toContain("raw_secret");
    expect(binds).not.toContain("json_secret");
    expect(binds).not.toContain("yaml_secret");
    expect(binds).not.toContain("basic_secret");
    expect(binds).not.toContain("session_cookie");
    expect(binds).not.toContain("clearance_secret");
    expect(binds).not.toContain("user@example.com");
    expect(binds).not.toContain("mk_secret_test");
    expect(binds).not.toContain("session_secret");
    expect(binds).not.toContain("acct_raw_456");
    expect(binds).not.toContain("key_raw_123");
  });

  it("does not fail conversion when opt-in debug trace write fails", async () => {
    vi.mocked(convertUrlWithMetrics).mockResolvedValue(convertResult());
    vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = createD1Mock({
      authRow: {
        key_id: "key_raw_123",
        account_id: "acct_raw_456",
        revoked_at: null,
        tier: "free",
        monthly_credits_used: 0,
        monthly_credits_reset_at: "2099-01-01T00:00:00.000Z",
      },
      rejectDebugTrace: true,
    });
    const { env } = createMockEnv({ AUTH_DB: db, ANALYTICS_SALT: "test-salt" });
    const ctx = mockCtx();

    const req = new Request("https://md.example.com/https://example.com/ok?raw=true&debug_trace=true", {
      headers: {
        Accept: "text/markdown",
        Authorization: "Bearer mk_secret_test",
      },
    });
    const res = await worker.fetch(req, env, ctx);
    const body = await res.text();
    await flushWaitUntil(ctx);

    expect(res.status).toBe(200);
    expect(body).toContain("# converted");
    const errors = serialize(consoleError.mock.calls);
    expect(errors).toContain("Conversion event write failed");
    expect(errors).toContain("token=[redacted]");
    expect(errors).not.toContain("debug_secret");
  });

  it("cleans up expired debug traces without exposing raw values", async () => {
    const { db, statements } = createD1Mock();
    const { env } = createMockEnv({ AUTH_DB: db });

    await cleanupExpiredDebugTraces(env);

    const cleanup = debugTraceStatements(statements).find((statement) =>
      statement.sql.includes("DELETE FROM conversion_debug_traces")
    );
    expect(cleanup).toBeTruthy();
    expect(cleanup?.binds[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("cleans up expired operational rows on scheduled maintenance", async () => {
    const { db, statements } = createD1Mock();
    const { env } = createMockEnv({ AUTH_DB: db });

    await cleanupExpiredOperationalRows(env);

    const deletes = statements
      .filter((statement) => statement.sql.includes("DELETE FROM"))
      .map((statement) => statement.sql.replace(/\s+/g, " ").trim());
    expect(deletes).toEqual([
      expect.stringContaining("DELETE FROM conversion_debug_traces"),
      expect.stringContaining("DELETE FROM sessions"),
      expect.stringContaining("DELETE FROM magic_link_tokens"),
      expect.stringContaining("DELETE FROM rate_limits"),
    ]);
  });
});
