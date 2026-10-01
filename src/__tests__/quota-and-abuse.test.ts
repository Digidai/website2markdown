import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_ANON_CONVERT_PER_WINDOW,
  RATE_LIMIT_CONVERT_PER_WINDOW,
} from "../config";
import { handleUsageForAccount } from "../handlers/usage";
import { clearAuthLru, resolveAuth } from "../middleware/auth-d1";
import { ensureMonthlyQuota } from "../middleware/quota";
import { consumeRateLimit } from "../middleware/rate-limit";
import { localRateCounters } from "../runtime-state";
import type { Env } from "../types";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const NEXT_RESET = "2026-10-01T00:00:00.000Z";

function createSqliteAuthDb(): { raw: DatabaseSync; db: D1Database; sql: string[] } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      tier TEXT NOT NULL DEFAULT 'free',
      monthly_credits_used INTEGER NOT NULL DEFAULT 0,
      monthly_credits_reset_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      name TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE usage_daily (
      key_id TEXT NOT NULL,
      date TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      credits INTEGER NOT NULL DEFAULT 0,
      browser_calls INTEGER NOT NULL DEFAULT 0,
      cache_hits INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key_id, date)
    );
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL
    );
  `);
  const sql: string[] = [];
  const db = {
    prepare(statement: string) {
      sql.push(statement);
      const stmt = raw.prepare(statement);
      return {
        bind(...params: Array<string | number | null>) {
          return {
            first: async () => stmt.get(...params) ?? null,
            all: async () => ({ results: stmt.all(...params) }),
            run: async () => {
              const info = stmt.run(...params);
              return { success: true, meta: { changes: Number(info.changes) } };
            },
          };
        },
      };
    },
  };
  return { raw, db: db as unknown as D1Database, sql };
}

async function sha256(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function insertAccount(
  raw: DatabaseSync,
  row: {
    id: string;
    email: string;
    used: number;
    resetAt: string;
    createdAt: string;
    keyId: string;
    keyHash: string;
  },
): void {
  raw.prepare(`
    INSERT INTO accounts (
      id, email, tier, monthly_credits_used, monthly_credits_reset_at, created_at, updated_at
    ) VALUES (?, ?, 'free', ?, ?, ?, ?)
  `).run(row.id, row.email, row.used, row.resetAt, row.createdAt, row.createdAt);
  raw.prepare(`
    INSERT INTO api_keys (id, account_id, prefix, key_hash, name, revoked_at, created_at)
    VALUES (?, ?, 'mk_test', ?, NULL, NULL, ?)
  `).run(row.keyId, row.id, row.keyHash, row.createdAt);
}

function insertUsage(
  raw: DatabaseSync,
  keyId: string,
  rows: Array<[string, number, number]>,
): void {
  const stmt = raw.prepare(`
    INSERT INTO usage_daily (key_id, date, requests, credits, browser_calls, cache_hits)
    VALUES (?, ?, ?, ?, ?, 0)
  `);
  for (const [date, credits, browserCalls] of rows) {
    stmt.run(keyId, date, credits, credits, browserCalls);
  }
}

function storedQuota(raw: DatabaseSync, accountId: string): { used: number; resetAt: string } {
  const row = raw.prepare(
    "SELECT monthly_credits_used AS used, monthly_credits_reset_at AS resetAt FROM accounts WHERE id = ?",
  ).get(accountId) as { used: number; resetAt: string };
  return row;
}

function ipRequest(ip: string): Request {
  return new Request("https://md.example.com/https://example.com", {
    headers: { "cf-connecting-ip": ip },
  });
}

describe("monthly quota roll", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    clearAuthLru();
  });

  afterEach(() => {
    clearAuthLru();
    vi.useRealTimers();
  });

  it("rolls a stale window to this month's usage and the next UTC boundary", async () => {
    const { raw, db } = createSqliteAuthDb();
    const keyHash = await sha256("mk_quota_september");
    insertAccount(raw, {
      id: "acct-sep",
      email: "sep@example.com",
      used: 1934,
      resetAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-07-19T00:00:00.000Z",
      keyId: "key-sep",
      keyHash,
    });
    insertUsage(raw, "key-sep", [
      ["2026-07-15", 1000, 643],
      ["2026-08-10", 453, 316],
      ["2026-09-12", 481, 347],
    ]);

    const rolled = await ensureMonthlyQuota(
      { AUTH_DB: db } as Env,
      "acct-sep",
      1934,
      "2026-08-01T00:00:00.000Z",
      NOW,
    );

    expect(rolled).toEqual({ used: 481, resetAt: NEXT_RESET });
    expect(storedQuota(raw, "acct-sep")).toEqual({ used: 481, resetAt: NEXT_RESET });
  });

  it("sets a month with no ledger rows to zero instead of keeping the old total", async () => {
    const { raw, db } = createSqliteAuthDb();
    insertAccount(raw, {
      id: "acct-empty",
      email: "empty@example.com",
      used: 1000,
      resetAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-07-10T00:00:00.000Z",
      keyId: "key-empty",
      keyHash: "hash-empty",
    });
    insertUsage(raw, "key-empty", [["2026-07-20", 1000, 544]]);

    const rolled = await ensureMonthlyQuota(
      { AUTH_DB: db } as Env,
      "acct-empty",
      1000,
      "2026-08-01T00:00:00.000Z",
      NOW,
    );

    expect(rolled).toEqual({ used: 0, resetAt: NEXT_RESET });
    expect(storedQuota(raw, "acct-empty").used).toBe(0);
  });

  it("keeps this month's usage when the reset date is already in the past", async () => {
    const { raw, db } = createSqliteAuthDb();
    insertAccount(raw, {
      id: "acct-current",
      email: "current@example.com",
      used: 376,
      resetAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-08-23T00:00:00.000Z",
      keyId: "key-current",
      keyHash: "hash-current",
    });
    insertUsage(raw, "key-current", [
      ["2026-08-25", 105, 0],
      ["2026-09-18", 271, 0],
    ]);

    const rolled = await ensureMonthlyQuota(
      { AUTH_DB: db } as Env,
      "acct-current",
      376,
      "2026-09-01T00:00:00.000Z",
      NOW,
    );

    expect(rolled.used).toBe(271);
    expect(rolled.resetAt).toBe(NEXT_RESET);
  });

  it("does not write when the stored window is still in the future", async () => {
    const { db, sql } = createSqliteAuthDb();
    const rolled = await ensureMonthlyQuota(
      { AUTH_DB: db } as Env,
      "acct-future",
      42,
      "2099-01-01T00:00:00.000Z",
      NOW,
    );

    expect(rolled).toEqual({ used: 42, resetAt: "2099-01-01T00:00:00.000Z" });
    expect(sql).toEqual([]);
  });

  it("keeps a newer window when another request already rolled", async () => {
    const { raw, db } = createSqliteAuthDb();
    insertAccount(raw, {
      id: "acct-race",
      email: "race@example.com",
      used: 12,
      resetAt: NEXT_RESET,
      createdAt: "2026-07-19T00:00:00.000Z",
      keyId: "key-race",
      keyHash: "hash-race",
    });

    const rolled = await ensureMonthlyQuota(
      { AUTH_DB: db } as Env,
      "acct-race",
      1934,
      "2026-08-01T00:00:00.000Z",
      NOW,
    );

    expect(rolled).toEqual({ used: 12, resetAt: NEXT_RESET });
    expect(storedQuota(raw, "acct-race")).toEqual({ used: 12, resetAt: NEXT_RESET });
  });

  it("keeps the stored cumulative when the roll write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      AUTH_DB: {
        prepare(sql: string) {
          if (sql.includes("UPDATE")) throw new Error("d1 down");
          return {
            bind: () => ({
              first: async () => null,
              run: async () => ({ meta: { changes: 0 } }),
            }),
          };
        },
      },
    } as unknown as Env;

    const rolled = await ensureMonthlyQuota(
      env,
      "acct-fail",
      1934,
      "2026-08-01T00:00:00.000Z",
      NOW,
    );

    expect(rolled).toEqual({ used: 1934, resetAt: "2026-08-01T00:00:00.000Z" });
    expect(warn).toHaveBeenCalled();
  });

  it("makes the auth gate and the portal report the same rolled balance", async () => {
    const gate = createSqliteAuthDb();
    const portal = createSqliteAuthDb();
    const rawKey = "mk_quota_gate";
    const keyHash = await sha256(rawKey);
    const account = {
      id: "acct-gate",
      email: "gate@example.com",
      used: 1934,
      resetAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-07-19T00:00:00.000Z",
      keyId: "key-gate",
      keyHash,
    };
    const usage: Array<[string, number, number]> = [
      ["2026-07-15", 1000, 643],
      ["2026-08-10", 453, 316],
      ["2026-09-12", 481, 347],
    ];
    insertAccount(gate.raw, account);
    insertUsage(gate.raw, account.keyId, usage);
    insertAccount(portal.raw, account);
    insertUsage(portal.raw, account.keyId, usage);

    const auth = await resolveAuth(
      new Request("https://md.example.com/", { headers: { Authorization: `Bearer ${rawKey}` } }),
      { AUTH_DB: gate.db } as Env,
    );
    const response = await handleUsageForAccount({ AUTH_DB: portal.db } as Env, account.id);
    const body = await response.json() as {
      used: number;
      remaining: number;
      quota: number;
      period: { start: string; reset_at: string };
    };

    expect(auth.quotaUsed).toBe(481);
    expect(auth.quotaLimit).toBe(1000);
    expect(body.used).toBe(481);
    expect(body.remaining).toBe(519);
    expect(body.quota).toBe(1000);
    expect(body.period.start).toBe("2026-09-01");
    expect(body.period.reset_at).toBe(NEXT_RESET);
  });
});

describe("anonymous durable rate limit", () => {
  afterEach(() => {
    localRateCounters.clear();
  });

  it("blocks the 11th anonymous convert from a fresh isolate at 10", async () => {
    const { raw, db } = createSqliteAuthDb();
    const env = { AUTH_DB: db } as Env;
    const ip = "203.0.113.10";

    for (let i = 0; i < RATE_LIMIT_ANON_CONVERT_PER_WINDOW; i++) {
      localRateCounters.clear();
      const decision = await consumeRateLimit(ipRequest(ip), env, "convert", { anonymous: true });
      expect(decision?.exceeded, `request ${i + 1}`).toBe(false);
    }

    localRateCounters.clear();
    const blocked = await consumeRateLimit(ipRequest(ip), env, "convert", { anonymous: true });
    const row = raw.prepare("SELECT count FROM rate_limits WHERE key = ?").get(`anon-rl:convert:${ip}`) as { count: number };

    expect(blocked?.exceeded).toBe(true);
    expect(blocked?.limit).toBe(RATE_LIMIT_ANON_CONVERT_PER_WINDOW);
    expect(row.count).toBe(RATE_LIMIT_ANON_CONVERT_PER_WINDOW + 1);
  });

  it("keeps authenticated callers on the local limit and does not write D1", async () => {
    const { db, sql } = createSqliteAuthDb();
    const env = { AUTH_DB: db } as Env;
    const ip = "203.0.113.11";

    for (let i = 0; i < RATE_LIMIT_CONVERT_PER_WINDOW; i++) {
      const decision = await consumeRateLimit(ipRequest(ip), env, "convert", { anonymous: false });
      expect(decision?.exceeded).toBe(false);
    }
    const blocked = await consumeRateLimit(ipRequest(ip), env, "convert", { anonymous: false });

    expect(blocked?.exceeded).toBe(true);
    expect(blocked?.limit).toBe(RATE_LIMIT_CONVERT_PER_WINDOW);
    expect(sql).toEqual([]);
  });

  it("does not let anonymous traffic spend the authenticated local budget", async () => {
    const { db } = createSqliteAuthDb();
    const env = { AUTH_DB: db } as Env;
    const ip = "203.0.113.12";

    for (let i = 0; i < RATE_LIMIT_ANON_CONVERT_PER_WINDOW; i++) {
      localRateCounters.clear();
      await consumeRateLimit(ipRequest(ip), env, "convert", { anonymous: true });
    }
    localRateCounters.clear();
    const decision = await consumeRateLimit(ipRequest(ip), env, "convert", { anonymous: false });

    expect(decision?.exceeded).toBe(false);
    expect(decision?.limit).toBe(RATE_LIMIT_CONVERT_PER_WINDOW);
  });

  it("returns null when the client IP is missing", async () => {
    const { db } = createSqliteAuthDb();
    const decision = await consumeRateLimit(
      new Request("https://md.example.com/https://example.com"),
      { AUTH_DB: db } as Env,
      "convert",
      { anonymous: true },
    );
    expect(decision).toBeNull();
  });
});
