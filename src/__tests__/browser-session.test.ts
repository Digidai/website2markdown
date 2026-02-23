import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

import puppeteer from "@cloudflare/puppeteer";
import { fetchWithBrowser } from "../browser";
import {
  loadSessionProfile,
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
  return { env, store, mocks };
}

function createBrowserMock(html: string) {
  let requestHandler: ((req: any) => void) | null = null;

  const page = {
    setUserAgent: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    setExtraHTTPHeaders: vi.fn(async () => {}),
    setCookie: vi.fn(async () => {}),
    evaluateOnNewDocument: vi.fn(async () => {}),
    on: vi.fn((event: string, cb: (req: any) => void) => {
      if (event === "request") requestHandler = cb;
    }),
    setRequestInterception: vi.fn(async () => {
      if (!requestHandler) return;
      requestHandler({
        url: () => "https://www.163.com/dy/article/abc.html",
        resourceType: () => "document",
        abort: vi.fn(),
        continue: vi.fn(),
      });
    }),
    goto: vi.fn(async () => {}),
    content: vi.fn(async () => html),
    evaluate: vi.fn(async () => ({
      sessionToken: "from-local-storage",
    })),
    cookies: vi.fn(async () => [
      {
        name: "sid",
        value: "new-cookie",
        domain: "www.163.com",
        path: "/",
      },
    ]),
  };

  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };

  return { browser, page };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("browser session profile integration", () => {
  it("replays and refreshes session profile on browser fetch", async () => {
    const { env } = createKvBackedEnv();
    const url = "https://www.163.com/dy/article/abc.html";

    await saveSessionProfileSnapshot(env, url, {
      cookies: [{ name: "sid", value: "old-cookie", domain: "www.163.com" }],
      localStorage: { sessionToken: "old-token" },
    });

    const mock = createBrowserMock("<html><body>page content</body></html>");
    vi.mocked(puppeteer.launch).mockResolvedValue(mock.browser as any);

    const result = await fetchWithBrowser(url, env, "md.example.com");

    expect(result).toContain("page content");
    expect(mock.page.setCookie).toHaveBeenCalled();
    expect(mock.page.evaluateOnNewDocument).toHaveBeenCalled();

    const saved = await loadSessionProfile(env, url);
    expect(saved).toBeTruthy();
    expect(saved?.cookies[0]?.value).toBe("new-cookie");
    expect(saved?.localStorage.sessionToken).toBe("from-local-storage");
  });
});
