import { describe, expect, it, vi } from "vitest";

import {
  applySessionProfileToPage,
  captureSessionProfileSnapshotFromPage,
  clearSessionProfileFailure,
  isLikelySessionExpiredHtml,
  loadSessionProfile,
  markSessionProfileFailure,
  saveSessionProfileSnapshot,
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
});
