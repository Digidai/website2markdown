/**
 * Tests for Magic Link auth flow (send, verify, logout) and /portal/ HTML.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { createMockEnv, mockCtx } from "./test-helpers";
import { sha256Hex } from "../helpers/crypto";

function createMockD1(): {
  db: D1Database;
  tables: {
    accounts: Map<string, any>;
    api_keys: Map<string, any>;
    sessions: Map<string, any>;
    magic_link_tokens: Map<string, any>;
  };
} {
  const tables = {
    accounts: new Map<string, any>(),
    api_keys: new Map<string, any>(),
    sessions: new Map<string, any>(),
    magic_link_tokens: new Map<string, any>(),
  };

  const prepare = (sql: string) => {
    let binds: any[] = [];
    const stmt = {
      bind(...args: any[]) {
        binds = args;
        return stmt;
      },
      async first<T = any>(): Promise<T | null> {
        // Magic link token lookup
        if (sql.includes("FROM magic_link_tokens")) {
          const [tokenHash] = binds;
          for (const [_, t] of tables.magic_link_tokens) {
            if (t.token_hash === tokenHash) {
              return {
                id: t.id,
                email: t.email,
                expires_at: t.expires_at,
                used_at: t.used_at,
              } as T;
            }
          }
          return null;
        }
        // Account lookup by email
        if (sql.includes("FROM accounts WHERE email")) {
          const [email] = binds;
          for (const [_, a] of tables.accounts) {
            if (a.email === email) return { id: a.id } as T;
          }
          return null;
        }
        // Session + account join
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
        return null;
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        return { results: [] };
      },
      async run() {
        // INSERT magic_link_tokens
        if (sql.includes("INSERT INTO magic_link_tokens")) {
          const [id, email, token_hash, expires_at, created_at] = binds;
          tables.magic_link_tokens.set(id, {
            id, email, token_hash, expires_at, created_at, used_at: null,
          });
          return {};
        }
        // UPDATE magic_link_tokens used_at
        if (sql.includes("UPDATE magic_link_tokens SET used_at")) {
          const [used_at, id] = binds;
          const t = tables.magic_link_tokens.get(id);
          if (t) t.used_at = used_at;
          return {};
        }
        // INSERT accounts
        if (sql.includes("INSERT INTO accounts")) {
          const [id, email, tier, monthly_credits_used, monthly_credits_reset_at, created_at, updated_at] = binds;
          tables.accounts.set(id, {
            id, email, tier, monthly_credits_used, monthly_credits_reset_at,
            created_at, updated_at, github_id: null,
          });
          return {};
        }
        // INSERT sessions
        if (sql.includes("INSERT INTO sessions")) {
          const [id, account_id, token_hash, expires_at, created_at] = binds;
          tables.sessions.set(id, { id, account_id, token_hash, expires_at, created_at });
          return {};
        }
        // DELETE sessions
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

describe("Magic Link: POST /api/auth/magic-link", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects invalid email", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(400);
  });

  it("rejects missing body", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(400);
  });

  it("stores token hash and returns 200 for valid email", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(d1.tables.magic_link_tokens.size).toBe(1);
    const stored = Array.from(d1.tables.magic_link_tokens.values())[0];
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.email).toBe("user@example.com");
    expect(stored.used_at).toBeNull();
  });

  it("normalizes email to lowercase", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "USER@Example.COM" }),
    });
    await worker.fetch(req, env, mockCtx());
    const stored = Array.from(d1.tables.magic_link_tokens.values())[0];
    expect(stored.email).toBe("user@example.com");
  });

  it("calls Resend when RESEND_API_KEY is set", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({
      AUTH_DB: d1.db,
      RESEND_API_KEY: "re_test",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "resend-id" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://md.example.com/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer re_test",
        }),
      }),
    );
  });

  it("still returns 200 when Resend fails (don't leak errors)", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({
      AUTH_DB: d1.db,
      RESEND_API_KEY: "re_bad",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    ));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("https://md.example.com/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
  });
});

describe("Magic Link: GET /api/auth/verify", () => {
  afterEach(() => vi.restoreAllMocks());

  async function seedToken(d1: ReturnType<typeof createMockD1>, overrides: {
    email?: string;
    expiresAt?: string;
    usedAt?: string | null;
  } = {}): Promise<string> {
    const token = "a".repeat(64);
    const tokenHash = await sha256Hex(token);
    const id = crypto.randomUUID();
    d1.tables.magic_link_tokens.set(id, {
      id,
      email: overrides.email ?? "user@example.com",
      token_hash: tokenHash,
      expires_at: overrides.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      used_at: overrides.usedAt ?? null,
      created_at: new Date().toISOString(),
    });
    return token;
  }

  it("rejects missing token with redirect", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/auth/verify");
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=invalid_token");
  });

  it("rejects invalid format token", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/auth/verify?token=not-hex");
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=invalid_token");
  });

  it("rejects expired token", async () => {
    const d1 = createMockD1();
    const token = await seedToken(d1, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request(`https://md.example.com/api/auth/verify?token=${token}`);
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=link_expired");
  });

  it("rejects already-used token", async () => {
    const d1 = createMockD1();
    const token = await seedToken(d1, { usedAt: new Date().toISOString() });
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request(`https://md.example.com/api/auth/verify?token=${token}`);
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=link_already_used");
  });

  it("creates account on first verify, sets session cookie, redirects to /portal/", async () => {
    const d1 = createMockD1();
    const token = await seedToken(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request(`https://md.example.com/api/auth/verify?token=${token}`);
    const res = await worker.fetch(req, env, mockCtx());

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://md.example.com/portal/");
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("md_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");

    // Account was created
    expect(d1.tables.accounts.size).toBe(1);
    const account = Array.from(d1.tables.accounts.values())[0];
    expect(account.email).toBe("user@example.com");
    expect(account.tier).toBe("free");

    // Session was created
    expect(d1.tables.sessions.size).toBe(1);

    // Token was marked as used
    const storedToken = Array.from(d1.tables.magic_link_tokens.values())[0];
    expect(storedToken.used_at).not.toBeNull();
  });

  it("reuses existing account for known email", async () => {
    const d1 = createMockD1();
    const existingId = crypto.randomUUID();
    d1.tables.accounts.set(existingId, {
      id: existingId,
      email: "user@example.com",
      tier: "pro",
      github_id: null,
      monthly_credits_used: 0,
      monthly_credits_reset_at: new Date().toISOString(),
    });
    const token = await seedToken(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request(`https://md.example.com/api/auth/verify?token=${token}`);
    const res = await worker.fetch(req, env, mockCtx());

    expect(res.status).toBe(302);
    expect(d1.tables.accounts.size).toBe(1);
    // Session was created for the existing account
    const session = Array.from(d1.tables.sessions.values())[0];
    expect(session.account_id).toBe(existingId);
  });

  it("token becomes unusable after first verify", async () => {
    const d1 = createMockD1();
    const token = await seedToken(d1);
    const { env } = createMockEnv({ AUTH_DB: d1.db });

    // First verify succeeds
    const res1 = await worker.fetch(
      new Request(`https://md.example.com/api/auth/verify?token=${token}`),
      env, mockCtx(),
    );
    expect(res1.status).toBe(302);
    expect(res1.headers.get("Location")).toBe("https://md.example.com/portal/");

    // Second verify with same token → already used
    const res2 = await worker.fetch(
      new Request(`https://md.example.com/api/auth/verify?token=${token}`),
      env, mockCtx(),
    );
    expect(res2.headers.get("Location")).toContain("error=link_already_used");
  });
});

describe("POST /api/auth/logout", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 200 and clears cookie even without session", async () => {
    const d1 = createMockD1();
    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/auth/logout", { method: "POST" });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("md_session=");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("destroys session in D1 when valid cookie provided", async () => {
    const d1 = createMockD1();
    const accountId = crypto.randomUUID();
    d1.tables.accounts.set(accountId, {
      id: accountId,
      email: "user@example.com",
      tier: "free",
      github_id: null,
    });
    const sessionToken = "test-token";
    const tokenHash = await sha256Hex(sessionToken);
    const sessionId = crypto.randomUUID();
    d1.tables.sessions.set(sessionId, {
      id: sessionId,
      account_id: accountId,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const { env } = createMockEnv({ AUTH_DB: d1.db });
    const req = new Request("https://md.example.com/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `md_session=${sessionToken}` },
    });
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    expect(d1.tables.sessions.size).toBe(0);
  });
});

describe("GET /portal/ — HTML page", () => {
  afterEach(() => vi.restoreAllMocks());

  it("serves HTML at /portal/", async () => {
    const { env } = createMockEnv();
    const req = new Request("https://md.example.com/portal/");
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Developer Portal");
    expect(body).toContain("/api/me");
    expect(body).toContain("/api/auth/magic-link");
  });

  it("serves HTML at /portal (no trailing slash)", async () => {
    const { env } = createMockEnv();
    const req = new Request("https://md.example.com/portal");
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("serves HTML at /portal/keys (client-side routing)", async () => {
    const { env } = createMockEnv();
    const req = new Request("https://md.example.com/portal/keys");
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("sets security headers", async () => {
    const { env } = createMockEnv();
    const req = new Request("https://md.example.com/portal/");
    const res = await worker.fetch(req, env, mockCtx());
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("indexing is disabled via noindex meta", async () => {
    const { env } = createMockEnv();
    const req = new Request("https://md.example.com/portal/");
    const res = await worker.fetch(req, env, mockCtx());
    const body = await res.text();
    expect(body).toContain("noindex");
  });
});
