import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockEnv, mockCtx } from "./test-helpers";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));

// Exhausted free-tier key. checkPolicy() deliberately does NOT block on an
// exhausted quota ("handled separately"), so each route must enforce it itself.
vi.mock("../middleware/auth-d1", () => ({
  resolveAuth: vi.fn(async () => ({
    tier: "free",
    accountId: "acct_1",
    keyId: "key_1",
    quotaLimit: 1000,
    quotaUsed: 1000,
  })),
}));

// No portal session — exercise the Bearer-key path.
vi.mock("../middleware/session", () => ({
  resolveSession: vi.fn(async () => null),
}));

import worker from "../index";

const AUTH_DB = {} as unknown as D1Database;

describe("/api/stream quota enforcement", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 429 for an exhausted key instead of converting for free", async () => {
    const { env } = createMockEnv({ AUTH_DB });
    const req = new Request(
      "https://md.example.com/api/stream?url=" +
        encodeURIComponent("https://example.com/article"),
      { headers: { Authorization: "Bearer mk_exhausted" } },
    );

    const res = await worker.fetch(req, env, mockCtx());

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Quota Exceeded");
    // The conversion must never start.
    expect(fetch).not.toHaveBeenCalled();
  });
});
