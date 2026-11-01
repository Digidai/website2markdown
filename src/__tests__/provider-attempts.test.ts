import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "../types";
import {
  checkProviderHealth,
  loadProviderHealth,
  recordProviderAttempt,
  trackProvider,
} from "../observability/provider-attempts";

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, "../../migrations/0006_provider_attempts.sql"),
  "utf8",
);

// Runs the Worker's SQL against real SQLite so the upsert and the query are checked as written.
function sqliteEnv(extra: Partial<Env> = {}): { env: Env; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION);
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind: (...values: unknown[]) => {
        binds = values;
        return stmt;
      },
      run: async () => {
        const info = db.prepare(sql).run(...(binds as never[]));
        return { meta: { changes: Number(info.changes) } };
      },
      all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    };
    return stmt;
  };
  return { env: { AUTH_DB: { prepare } as unknown as D1Database, ...extra } as Env, db };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("provider attempt tracking", () => {
  it("counts successes, thrown errors, and unusable results per path", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { env } = sqliteEnv();

    await trackProvider(env, "wayback", undefined, async () => "<html>");
    await trackProvider(env, "wayback", undefined, async () => null, (html) => Boolean(html));
    await expect(
      trackProvider(env, "jina", undefined, async () => {
        throw new Error("HTTP 451 from r.jina.ai");
      }),
    ).rejects.toThrow("HTTP 451");
    await trackProvider(env, "jina", undefined, async () => ({ markdown: "ok" }));

    const rows = await loadProviderHealth(env, "2000-01-01");
    const byPath = Object.fromEntries(rows.map((row) => [row.path, row]));
    expect(byPath.wayback).toMatchObject({ attempts: 2, failures: 1, lastError: "empty or unusable result" });
    expect(byPath.jina).toMatchObject({ attempts: 2, failures: 1, lastError: "HTTP 451 from r.jina.ai" });
    // A success after a failure must not erase the last recorded error.
    expect(byPath.jina.lastFailureAt).not.toBe("");
  });

  it("does not blame the provider when the caller aborted", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { env } = sqliteEnv();
    const controller = new AbortController();
    controller.abort();

    await expect(
      trackProvider(env, "browser", controller.signal, async () => {
        throw new Error("aborted");
      }),
    ).rejects.toThrow("aborted");

    expect(await loadProviderHealth(env, "2000-01-01")).toEqual([]);
  });

  it("returns the latest error across days and only reads the requested window", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { env, db } = sqliteEnv();
    db.exec(`
      INSERT INTO provider_attempts_daily VALUES
        ('2026-10-01', 'proxy_pool', 10, 10, 'old window error', '2026-10-01T05:00:00.000Z', '2026-10-01T05:00:00.000Z'),
        ('2026-10-30', 'proxy_pool', 10, 9, 'previous day error', '2026-10-30T09:00:00.000Z', '2026-10-30T09:00:00.000Z'),
        ('2026-10-31', 'proxy_pool', 5, 1, 'latest error', '2026-10-31T01:00:00.000Z', '2026-10-31T20:00:00.000Z')
    `);
    await recordProviderAttempt(env, "firecrawl", true);

    const rows = await loadProviderHealth(env, "2026-10-30");
    const pool = rows.find((row) => row.path === "proxy_pool");
    expect(pool).toEqual({
      path: "proxy_pool",
      attempts: 15,
      failures: 10,
      lastError: "latest error",
      lastFailureAt: "2026-10-31T01:00:00.000Z",
    });
    expect(rows[0].path).toBe("proxy_pool");
  });

  it("emails only paths with enough calls and a failure rate at or above 50%", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(async () => ({ messageId: "m-1" }));
    const { env, db } = sqliteEnv({ EMAIL: { send } as unknown as SendEmail, ADMIN_EMAIL: "ops@example.com" });
    db.exec(`
      INSERT INTO provider_attempts_daily VALUES
        ('2026-10-31', 'proxy_pool', 20, 10, 'Proxy pool exhausted', '2026-10-31T10:00:00.000Z', '2026-10-31T10:00:00.000Z'),
        ('2026-10-31', 'jina', 19, 19, 'HTTP 451', '2026-10-31T10:00:00.000Z', '2026-10-31T10:00:00.000Z'),
        ('2026-10-31', 'firecrawl', 40, 19, 'timeout', '2026-10-31T10:00:00.000Z', '2026-10-31T10:00:00.000Z'),
        ('2026-10-29', 'browser', 50, 50, 'too old', '2026-10-29T10:00:00.000Z', '2026-10-29T10:00:00.000Z')
    `);
    const unhealthy = await checkProviderHealth(env, new Date("2026-11-01T03:17:00.000Z"));

    expect(unhealthy.map((row) => row.path)).toEqual(["proxy_pool"]);
    expect(send).toHaveBeenCalledTimes(1);
    const body = (send.mock.calls[0] as unknown as [{ from: string; to: string; text: string }])[0];
    expect(body.from).toBe("mdget.dev <noreply@mdget.dev>");
    expect(body.to).toBe("ops@example.com");
    expect(body.text).toContain("proxy_pool: 10/20 failed (50%)");
    expect(body.text).not.toContain("jina");
  });

  it("sends nothing when every path is healthy", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const send = vi.fn();
    const { env } = sqliteEnv({ EMAIL: { send } as unknown as SendEmail, ADMIN_EMAIL: "ops@example.com" });
    await recordProviderAttempt(env, "jina", true);

    expect(await checkProviderHealth(env)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
