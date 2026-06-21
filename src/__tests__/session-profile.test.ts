import { describe, expect, it, vi } from "vitest";

import {
  applySessionProfileToPage,
  captureSessionProfileSnapshotFromPage,
  clearSessionProfileFailure,
  isLikelySessionExpiredHtml,
  loadSessionProfile,
  markSessionProfileFailure,
  saveSessionProfileSnapshot,
  sessionProfileKey,
} from "../session/profile";
import { createMockEnv } from "./test-helpers";

function createKvBackedEnv() {
  const store = new Map<string, string>();
  const { env, mocks } = createMockEnv();
  mocks.kvGet.mockImplementation(async (key: string) => store.get(key) ?? null);
  mocks.kvPut.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  return { env, store };
}

describe("session profile", () => {
  const scope = "account:acct_test";

  it("saves/loads profile and applies cookies + localStorage to page", async () => {
    const { env } = createKvBackedEnv();
    const url = "https://crawl.example.com/article";

    await saveSessionProfileSnapshot(env, url, {
      cookies: [
        {
          name: "sid",
          value: "abc123",
          domain: "crawl.example.com",
          path: "/",
          secure: true,
          sameSite: "Lax",
        },
      ],
      localStorage: {
        token: "ls-token",
      },
    }, undefined, scope);

    const profile = await loadSessionProfile(env, url, scope);
    expect(profile).toBeTruthy();
    expect(profile?.cookies).toHaveLength(1);

    const page = {
      setCookie: vi.fn(async () => {}),
      evaluateOnNewDocument: vi.fn(async () => {}),
    };

    const applied = await applySessionProfileToPage(page, url, profile);

    expect(applied).toBe(true);
    expect(page.setCookie).toHaveBeenCalledTimes(1);
    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    const localStorageCall = (page.evaluateOnNewDocument.mock.calls as unknown[][])[0];
    expect(typeof localStorageCall?.[0]).toBe("function");
    expect(localStorageCall?.[1]).toEqual({ token: "ls-token" });
  });

  it("captures session snapshot from page cookies/localStorage", async () => {
    const page = {
      cookies: vi.fn(async () => [
        {
          name: "session",
          value: "cookie-value",
          domain: ".crawl.example.com",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Strict",
        },
        {
          name: 123,
          value: "invalid-cookie",
        },
      ]),
      evaluate: vi.fn(async () => ({
        token: "abc",
        nonString: 1,
      })),
    };

    const snapshot = await captureSessionProfileSnapshotFromPage(page);

    expect(snapshot.cookies).toHaveLength(1);
    expect(snapshot.cookies[0].name).toBe("session");
    expect(snapshot.localStorage).toEqual({ token: "abc" });
  });

  it("disables profile after repeated failures and can clear failure state", async () => {
    const { env } = createKvBackedEnv();
    const url = "https://crawl.example.com/protected";

    await saveSessionProfileSnapshot(env, url, {
      cookies: [{ name: "sid", value: "x" }],
      localStorage: {},
    }, undefined, scope);

    await markSessionProfileFailure(env, url, scope);
    await markSessionProfileFailure(env, url, scope);
    await markSessionProfileFailure(env, url, scope);

    const blocked = await loadSessionProfile(env, url, scope);
    expect(blocked).toBeNull();

    await clearSessionProfileFailure(env, url, scope);
    const restored = await loadSessionProfile(env, url, scope);
    expect(restored).toBeTruthy();
  });

  it("detects likely session-expired html", () => {
    expect(isLikelySessionExpiredHtml("Please login to continue. Session expired.")).toBe(true);
    expect(isLikelySessionExpiredHtml("<html><body><article>normal content</article></body></html>")).toBe(false);
  });

  it("normalizes session key host and rejects unsupported URL schemes", () => {
    expect(sessionProfileKey("https://WWW.Example.com/path", scope)).toBe("session:profile:v1:account:acct_test:www.example.com");
    expect(sessionProfileKey("https://WWW.Example.com/path")).toBeNull();
    expect(sessionProfileKey("ftp://example.com/file", scope)).toBeNull();
    expect(sessionProfileKey("not-a-url", scope)).toBeNull();
  });

  it("truncates oversized localStorage values when saving profile snapshots", async () => {
    const { env } = createKvBackedEnv();
    const profile = await saveSessionProfileSnapshot(env, "https://crawl.example.com/x", {
      cookies: [],
      localStorage: {
        token: "a".repeat(5000),
      },
    }, undefined, scope);

    expect(profile).toBeTruthy();
    expect(profile?.localStorage.token.length).toBeLessThanOrEqual(4096);
  });

  it("returns null for disabled profiles until disabled window expires", async () => {
    const { env, store } = createKvBackedEnv();
    const key = "session:profile:v1:account:acct_test:crawl.example.com";
    store.set(key, JSON.stringify({
      version: 1,
      host: "crawl.example.com",
      cookies: [{ name: "sid", value: "x" }],
      localStorage: {},
      failureCount: 3,
      disabledUntil: new Date(Date.now() + 60_000).toISOString(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));

    const blocked = await loadSessionProfile(env, "https://crawl.example.com/article", scope);
    expect(blocked).toBeNull();

    store.set(key, JSON.stringify({
      version: 1,
      host: "crawl.example.com",
      cookies: [{ name: "sid", value: "x" }],
      localStorage: {},
      failureCount: 0,
      disabledUntil: new Date(Date.now() - 60_000).toISOString(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const restored = await loadSessionProfile(env, "https://crawl.example.com/article", scope);
    expect(restored).toBeTruthy();
  });

  it("does not save or load browser session state without an explicit scope", async () => {
    const { env, store } = createKvBackedEnv();
    const saved = await saveSessionProfileSnapshot(env, "https://crawl.example.com/x", {
      cookies: [{ name: "sid", value: "x" }],
      localStorage: { token: "secret" },
    });

    expect(saved).toBeNull();
    expect(store.size).toBe(0);
    await expect(loadSessionProfile(env, "https://crawl.example.com/x")).resolves.toBeNull();
  });

  it("isolates session profiles by caller scope", async () => {
    const { env } = createKvBackedEnv();
    const url = "https://crawl.example.com/account";
    await saveSessionProfileSnapshot(env, url, {
      cookies: [{ name: "sid", value: "account-a" }],
      localStorage: {},
    }, undefined, "account:a");

    await saveSessionProfileSnapshot(env, url, {
      cookies: [{ name: "sid", value: "account-b" }],
      localStorage: {},
    }, undefined, "account:b");

    await expect(loadSessionProfile(env, url, "account:a")).resolves.toMatchObject({
      cookies: [expect.objectContaining({ value: "account-a" })],
    });
    await expect(loadSessionProfile(env, url, "account:b")).resolves.toMatchObject({
      cookies: [expect.objectContaining({ value: "account-b" })],
    });
  });
});
