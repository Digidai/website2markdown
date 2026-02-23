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
    });

    const profile = await loadSessionProfile(env, url);
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
    });

    await markSessionProfileFailure(env, url);
    await markSessionProfileFailure(env, url);
    await markSessionProfileFailure(env, url);

    const blocked = await loadSessionProfile(env, url);
    expect(blocked).toBeNull();

    await clearSessionProfileFailure(env, url);
    const restored = await loadSessionProfile(env, url);
    expect(restored).toBeTruthy();
  });

  it("detects likely session-expired html", () => {
    expect(isLikelySessionExpiredHtml("Please login to continue. Session expired.")).toBe(true);
    expect(isLikelySessionExpiredHtml("<html><body><article>normal content</article></body></html>")).toBe(false);
  });

  it("normalizes session key host and rejects unsupported URL schemes", () => {
    expect(sessionProfileKey("https://WWW.Example.com/path")).toBe("session:profile:v1:www.example.com");
    expect(sessionProfileKey("ftp://example.com/file")).toBeNull();
    expect(sessionProfileKey("not-a-url")).toBeNull();
  });

  it("truncates oversized localStorage values when saving profile snapshots", async () => {
    const { env } = createKvBackedEnv();
    const profile = await saveSessionProfileSnapshot(env, "https://crawl.example.com/x", {
      cookies: [],
      localStorage: {
        token: "a".repeat(5000),
      },
    });

    expect(profile).toBeTruthy();
    expect(profile?.localStorage.token.length).toBeLessThanOrEqual(4096);
  });

  it("returns null for disabled profiles until disabled window expires", async () => {
    const { env, store } = createKvBackedEnv();
    const key = "session:profile:v1:crawl.example.com";
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

    const blocked = await loadSessionProfile(env, "https://crawl.example.com/article");
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
    const restored = await loadSessionProfile(env, "https://crawl.example.com/article");
    expect(restored).toBeTruthy();
  });
});
