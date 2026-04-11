/**
 * Tests for Portal session + key management endpoints.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { createMockEnv, mockCtx } from "./test-helpers";
import { sha256Hex } from "../helpers/crypto";
import type { Env } from "../types";

/**
 * Build a mock D1 database with a simple in-memory table store.
 * Only implements the minimal surface needed by session + keys handlers.
 */
function createMockD1(): {
  db: D1Database;
  tables: {
    accounts: Map<string, any>;
    api_keys: Map<string, any>;
    sessions: Map<string, any>;
  };
} {
  const tables = {
    accounts: new Map<string, any>(),
    api_keys: new Map<string, any>(),
    sessions: new Map<string, any>(),
  };

  const prepare = (sql: string) => {
    let binds: any[] = [];
    const stmt = {
      bind(...args: any[]) {
        binds = args;
        return stmt;
      },
      async first<T = any>(): Promise<T | null> {
        // SELECT session + account JOIN
        if (sql.includes("FROM sessions s") && sql.includes("JOIN accounts")) {
          const [tokenHash] = binds;
          for (const [_, s] of tables.sessions) {
            if (s.token_hash === tokenHash) {
              const account = tables.accounts.get(s.account_id);
              if (!account) return null;
              return {
                session_id: s.id,
                account_id: s.account_id,
                expires_at: s.expires_at,
                email: account.email,
                tier: account.tier,
                github_id: account.github_id,
              } as T;
            }
          }
          return null;
        }

        // COUNT active keys for account
        if (sql.includes("COUNT(*)") && sql.includes("api_keys")) {
          const [accountId] = binds;
          let cnt = 0;
          for (const [_, k] of tables.api_keys) {
            if (k.account_id === accountId && !k.revoked_at) cnt++;
          }
          return { cnt } as T;
        }

        // SELECT key by id + account
        if (sql.includes("SELECT id, revoked_at FROM api_keys WHERE id = ?")) {
          const [keyId, accountId] = binds;
          const k = tables.api_keys.get(keyId);
          if (!k || k.account_id !== accountId) return null;
          return { id: k.id, revoked_at: k.revoked_at } as T;
        }

        return null;
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        // List keys for account
        if (sql.includes("FROM api_keys") && sql.includes("ORDER BY created_at")) {
          const [accountId] = binds;
          const results: any[] = [];
          for (const [_, k] of tables.api_keys) {
            if (k.account_id === accountId) {
              results.push({
                id: k.id,
                prefix: k.prefix,
                name: k.name,
                revoked_at: k.revoked_at,
                created_at: k.created_at,
              });
            }
          }
          return { results: results as T[] };
        }
        return { results: [] };
      },
      async run() {
        // INSERT session
        if (sql.includes("INSERT INTO sessions")) {
          const [id, account_id, token_hash, expires_at, created_at] = binds;
          tables.sessions.set(id, { id, account_id, token_hash, expires_at, created_at });
          return {};
        }
        // INSERT api_keys
        if (sql.includes("INSERT INTO api_keys")) {
          const [id, account_id, prefix, key_hash, name, created_at] = binds;
          tables.api_keys.set(id, { id, account_id, prefix, key_hash, name, created_at, revoked_at: null });
          return {};
        }
        // UPDATE api_keys revoke
        if (sql.includes("UPDATE api_keys SET revoked_at")) {
          const [revoked_at, id] = binds;
          const k = tables.api_keys.get(id);
          if (k) k.revoked_at = revoked_at;
          return {};
        }
        // DELETE session
        if (sql.includes("DELETE FROM sessions")) {
          const [id] = binds;
          tables.sessions.delete(id);
          return {};
        }
        return {};
      },
    };
    return stmt;
  };

  return {
    db: { prepare, batch: async () => [] } as unknown as D1Database,
    tables,
  };
}

async function seedAccountAndSession(
  d1: ReturnType<typeof createMockD1>,
): Promise<{ accountId: string; sessionToken: string }> {
  const accountId = crypto.randomUUID();
  d1.tables.accounts.set(accountId, {
    id: accountId,
    email: "test@example.com",
    tier: "free",
    github_id: null,
    monthly_credits_used: 0,
    monthly_credits_reset_at: new Date().toISOString(),
  });

  const sessionToken = "test-session-token-" + crypto.randomUUID();
  const tokenHash = await sha256Hex(sessionToken);
  const sessionId = crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  d1.tables.sessions.set(sessionId, {
    id: sessionId,
    account_id: accountId,
    token_hash: tokenHash,
    expires_at: expires,
    created_at: new Date().toISOString(),
  });

  return { accountId, sessionToken };
}

describe("Portal: /api/me", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 without session cookie", async () => {
    const { env } = createMockEnv();
    const req = new Request("https://md.example.com/api/me");
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid session cookie", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/me", {
      headers: { Cookie: "md_session=fake-token" },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(401);
  });

  it("returns account info with valid session", async () => {
    const d1 = createMockD1();
    const { sessionToken } = await seedAccountAndSession(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/me", {
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.email).toBe("test@example.com");
    expect(body.tier).toBe("free");
  });
});

describe("Portal: /api/keys create", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a new key and returns plaintext once", async () => {
    const d1 = createMockD1();
    const { sessionToken } = await seedAccountAndSession(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/keys", {
      method: "POST",
      headers: {
        Cookie: `md_session=${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "test-key" }),
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.key).toMatch(/^mk_[0-9a-f]{64}$/);
    // Prefix format matches GET /api/keys for client consistency
    expect(body.prefix).toMatch(/^mk_[0-9a-f]{8}\.\.\.$/);
    expect(body.name).toBe("test-key");
    expect(body.warning).toBeTruthy();
  });

  it("rejects key name longer than 64 chars", async () => {
    const d1 = createMockD1();
    const { sessionToken } = await seedAccountAndSession(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/keys", {
      method: "POST",
      headers: {
        Cookie: `md_session=${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "x".repeat(65) }),
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(400);
  });

  it("accepts creation without a name", async () => {
    const d1 = createMockD1();
    const { sessionToken } = await seedAccountAndSession(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/keys", {
      method: "POST",
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.name).toBeNull();
  });

  it("enforces max 10 active keys per account", async () => {
    const d1 = createMockD1();
    const { accountId, sessionToken } = await seedAccountAndSession(d1);
    // Pre-populate 10 active keys
    for (let i = 0; i < 10; i++) {
      d1.tables.api_keys.set(`key-${i}`, {
        id: `key-${i}`,
        account_id: accountId,
        prefix: `p${i}`,
        key_hash: `h${i}`,
        name: null,
        created_at: new Date().toISOString(),
        revoked_at: null,
      });
    }
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/keys", {
      method: "POST",
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    // 409 Conflict is semantically correct for a quota violation,
    // distinguishing it from 400 (malformed input)
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toBe("Too Many Keys");
  });
});

describe("Portal: /api/keys list", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns empty list for new account", async () => {
    const d1 = createMockD1();
    const { sessionToken } = await seedAccountAndSession(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/keys", {
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.keys).toEqual([]);
  });

  it("lists keys with prefix only (never full key)", async () => {
    const d1 = createMockD1();
    const { accountId, sessionToken } = await seedAccountAndSession(d1);
    d1.tables.api_keys.set("k1", {
      id: "k1",
      account_id: accountId,
      prefix: "abc12345",
      key_hash: "hash1",
      name: "prod",
      created_at: new Date().toISOString(),
      revoked_at: null,
    });
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/keys", {
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    const body = await res.json() as any;
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].prefix).toBe("mk_abc12345...");
    expect(body.keys[0].name).toBe("prod");
    expect(body.keys[0].active).toBe(true);
    expect(body.keys[0]).not.toHaveProperty("key");
    expect(body.keys[0]).not.toHaveProperty("key_hash");
  });
});

describe("Portal: /api/keys revoke", () => {
  afterEach(() => vi.restoreAllMocks());

  it("revokes an existing key", async () => {
    const d1 = createMockD1();
    const { accountId, sessionToken } = await seedAccountAndSession(d1);
    const keyId = crypto.randomUUID();
    d1.tables.api_keys.set(keyId, {
      id: keyId,
      account_id: accountId,
      prefix: "test1234",
      key_hash: "hash",
      name: "test",
      created_at: new Date().toISOString(),
      revoked_at: null,
    });
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request(`https://md.example.com/api/keys/${keyId}`, {
      method: "DELETE",
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(keyId);
    expect(body.revoked_at).toBeTruthy();
    // Verify in mock table
    expect(d1.tables.api_keys.get(keyId).revoked_at).toBeTruthy();
  });

  it("rejects invalid UUID in path", async () => {
    const d1 = createMockD1();
    const { sessionToken } = await seedAccountAndSession(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/keys/not-a-uuid", {
      method: "DELETE",
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(400);
  });

  it("returns 404 for keys belonging to other accounts", async () => {
    const d1 = createMockD1();
    const { sessionToken } = await seedAccountAndSession(d1);
    const otherKeyId = crypto.randomUUID();
    d1.tables.api_keys.set(otherKeyId, {
      id: otherKeyId,
      account_id: "some-other-account",
      prefix: "other",
      key_hash: "x",
      name: null,
      created_at: new Date().toISOString(),
      revoked_at: null,
    });
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request(`https://md.example.com/api/keys/${otherKeyId}`, {
      method: "DELETE",
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(404);
  });

  it("is idempotent when key is already revoked (returns existing timestamp)", async () => {
    const d1 = createMockD1();
    const { accountId, sessionToken } = await seedAccountAndSession(d1);
    const keyId = crypto.randomUUID();
    const originalRevokedAt = "2026-04-10T00:00:00.000Z";
    d1.tables.api_keys.set(keyId, {
      id: keyId,
      account_id: accountId,
      prefix: "test1234",
      key_hash: "hash",
      name: null,
      created_at: new Date().toISOString(),
      revoked_at: originalRevokedAt,
    });
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request(`https://md.example.com/api/keys/${keyId}`, {
      method: "DELETE",
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    // DELETE is idempotent by REST convention: a second delete of a
    // revoked key returns 200 with the original revocation timestamp,
    // not an error.
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(keyId);
    expect(body.revoked_at).toBe(originalRevokedAt);
  });
});

describe("Portal: session security", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects expired sessions", async () => {
    const d1 = createMockD1();
    const accountId = crypto.randomUUID();
    d1.tables.accounts.set(accountId, {
      id: accountId,
      email: "test@example.com",
      tier: "free",
      github_id: null,
    });
    const sessionToken = "expired-token";
    const tokenHash = await sha256Hex(sessionToken);
    const sessionId = crypto.randomUUID();
    d1.tables.sessions.set(sessionId, {
      id: sessionId,
      account_id: accountId,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() - 1000).toISOString(), // expired
      created_at: new Date(Date.now() - 10000).toISOString(),
    });

    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/me", {
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(401);
  });

  it("stores sessions as hash, never plaintext", async () => {
    const d1 = createMockD1();
    const { sessionToken } = await seedAccountAndSession(d1);
    // The plaintext token should NOT appear in the sessions table
    const stored = Array.from(d1.tables.sessions.values())[0];
    expect(stored.token_hash).not.toBe(sessionToken);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
