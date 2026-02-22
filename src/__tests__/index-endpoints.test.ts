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

describe("worker endpoints", () => {
  it("handles CORS preflight", async () => {
    const req = new Request("https://md.example.com/anything", {
      method: "OPTIONS",
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("serves health endpoint for GET", async () => {
    const req = new Request("https://md.example.com/api/health");
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as {
      status?: string;
      service?: string;
      browser?: { active?: number; queued?: number };
      metrics?: { requestsTotal?: number };
      paywall?: { source?: string };
    };

    expect(res.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.service).toBe("md.example.com");
    expect(payload.browser).toBeTruthy();
    expect(payload.metrics).toBeTruthy();
    expect(payload.paywall).toBeTruthy();
  });

  it("serves health endpoint for HEAD without conversion", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://md.example.com/api/health", {
      method: "HEAD",
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires token for /api/stream when PUBLIC_API_TOKEN is configured", async () => {
    const { env } = createMockEnv({ PUBLIC_API_TOKEN: "public-token" });
    const req = new Request("https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Farticle");
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
  });

  it("accepts query token for /api/stream when PUBLIC_API_TOKEN is configured", async () => {
    const { env } = createMockEnv({ PUBLIC_API_TOKEN: "public-token" });
    const req = new Request(
      "https://md.example.com/api/stream?url=not-a-url&token=public-token",
    );
    const res = await worker.fetch(req, env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("event: fail");
    expect(body).toContain("Invalid URL");
  });

  it("requires token for raw convert API when PUBLIC_API_TOKEN is configured", async () => {
    const { env } = createMockEnv({ PUBLIC_API_TOKEN: "public-token" });
    const req = new Request(
      "https://md.example.com/https://example.com/article?raw=true",
      { headers: { Accept: "application/json" } },
    );
    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
  });

  it("rate limits /api/stream by client IP", async () => {
    const { env } = createMockEnv();
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    let last: Response | null = null;

    for (let i = 0; i < 31; i++) {
      const req = new Request("https://md.example.com/api/stream?url=not-a-url", {
        headers: { "cf-connecting-ip": ip },
      });
      last = await worker.fetch(req, env);
    }

    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 400 for malformed encoded /img URLs", async () => {
    const req = new Request("https://md.example.com/img/%E0%A4%A");
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid image URL encoding");
  });

  it("rejects non-image content from /img", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html>not image</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ));

    const target = encodeURIComponent("https://example.com/not-image");
    const req = new Request(`https://md.example.com/img/${target}`);
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Not an image");
  });

  it("rejects oversized image by Content-Length in /img", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("x", {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(5 * 1024 * 1024),
        },
      }),
    ));

    const target = encodeURIComponent("https://example.com/big-image");
    const req = new Request(`https://md.example.com/img/${target}`);
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(413);
    expect(await res.text()).toBe("Image too large");
  });

  it("returns 404 for invalid /r2img key", async () => {
    const req = new Request("https://md.example.com/r2img/not-images/path");
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(404);
  });

  it("rejects SVG content in /r2img", async () => {
    const stream = createByteStream(16, 1);
    const { env, mocks } = createMockEnv();
    mocks.r2Get.mockResolvedValueOnce({
      body: stream,
      httpMetadata: { contentType: "image/svg+xml" },
    });

    const req = new Request("https://md.example.com/r2img/images/test.svg");
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("serves non-SVG image from /r2img", async () => {
    const stream = createByteStream(16, 1);
    const { env, mocks } = createMockEnv();
    mocks.r2Get.mockResolvedValueOnce({
      body: stream,
      httpMetadata: { contentType: "image/png" },
    });

    const req = new Request("https://md.example.com/r2img/images/test.png");
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
