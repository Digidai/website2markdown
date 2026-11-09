import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaBrowserUse } from "../browser-use";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchViaBrowserUse", () => {
  it("stops the remote session when the caller aborts while it runs", async () => {
    const controller = new AbortController();
    const calls: Array<[string, string]> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push([init?.method ?? "GET", url]);
      if (url.endsWith("/sessions") && init?.method === "POST") {
        setTimeout(() => controller.abort(), 5);
        return Response.json({ id: "s1", status: "running" });
      }
      return Response.json({ id: "s1", status: "running" });
    }));

    const started = Date.now();
    expect(await fetchViaBrowserUse("https://example.com/a", "key", controller.signal)).toBeNull();
    // It gives up at once instead of finishing the 2 s poll wait.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls).toContainEqual(["PUT", "https://api.browser-use.com/api/v3/sessions/s1/stop"]);
  });
});
