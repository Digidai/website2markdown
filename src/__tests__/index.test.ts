import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { createByteStream, createMockEnv } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("worker fetch hardening", () => {
  it("rejects HEAD conversion routes to avoid side effects", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://md.example.com/https://example.com/article", {
      method: "HEAD",
      headers: { Accept: "application/json" },
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces /img body size limit even without Content-Length", async () => {
    const stream = createByteStream(1024 * 1024, 5); // 5 MB
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const target = encodeURIComponent("https://example.com/oversized.png");
    const req = new Request(`https://md.example.com/img/${target}`);
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(413);
    expect(await res.text()).toBe("Image too large");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 413 when target page body exceeds max size without Content-Length", async () => {
    const stream = createByteStream(700 * 1024, 8); // 5.6 MB
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://md.example.com/https://example.com/huge", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as {
      error?: string;
      message?: string;
      status?: number;
    };

    expect(res.status).toBe(413);
    expect(payload.error).toBe("Content Too Large");
    expect(payload.message).toContain("5 MB");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
