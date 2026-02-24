import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

import puppeteer from "@cloudflare/puppeteer";
import worker from "../index";
import { createMockEnv } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("index route edge coverage", () => {
  it("returns 405 for non-GET/HEAD methods outside batch endpoint", async () => {
    const req = new Request("https://md.example.com/api/health", {
      method: "PUT",
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(405);
    expect(await res.text()).toBe("Method Not Allowed");
  });

  it("handles HEAD favicon without side effects", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://md.example.com/favicon.ico", {
      method: "HEAD",
    });
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves landing page when target URL is missing", async () => {
    const req = new Request("https://md.example.com/");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(body).toContain("Markdown");
  });

  it("serves Chinese landing page when lang=zh", async () => {
    const req = new Request("https://md.example.com/?lang=zh");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('href="/?lang=zh"');
    expect(body).toContain("任意 URL 转");
    expect(body).toContain("转换");
  });

  it("returns HTML error response when invalid url is requested by browser", async () => {
    const req = new Request("https://md.example.com/https://exa mple.com", {
      headers: { Accept: "text/html" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const html = await res.text();

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(html).toContain("Invalid URL");
  });

  it("streams blocked event for private /api/stream target", async () => {
    const req = new Request("https://md.example.com/api/stream?url=http%3A%2F%2F127.0.0.1%2Fa");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("event: fail");
    expect(body).toContain("\"title\":\"Blocked\"");
  });

  it("returns 502 when /img upstream response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("missing", {
        status: 404,
        headers: { "Content-Type": "image/png" },
      }),
    ));

    const target = encodeURIComponent("https://example.com/not-found.png");
    const req = new Request(`https://md.example.com/img/${target}`);
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Image fetch failed");
  });

  it("returns 403 when /img upstream content is svg", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<svg></svg>", {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      }),
    ));

    const target = encodeURIComponent("https://example.com/icon.svg");
    const req = new Request(`https://md.example.com/img/${target}`);
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("SVG images are not allowed");
  });

  it("returns 403 when /img redirect target is blocked by SSRF protection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { Location: "http://127.0.0.1/private" },
      }),
    ));

    const target = encodeURIComponent("https://example.com/redirect.png");
    const req = new Request(`https://md.example.com/img/${target}`);
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Redirect target blocked");
  });

  it("returns 502 when /img fetch throws non-SSRF errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dial tcp failed")));

    const target = encodeURIComponent("https://example.com/error.png");
    const req = new Request(`https://md.example.com/img/${target}`);
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Image fetch failed");
  });

  it("returns proxied image bytes with strict headers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    ));

    const target = encodeURIComponent("https://example.com/ok.png");
    const req = new Request(`https://md.example.com/img/${target}`);
    const res = await worker.fetch(req, createMockEnv().env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns 404 when r2 image read throws", async () => {
    const { env, mocks } = createMockEnv();
    mocks.r2Get.mockRejectedValueOnce(new Error("r2 unavailable"));

    const req = new Request("https://md.example.com/r2img/images/miss.png");
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(404);
  });

  it("returns 502 when static fetch fails and force_browser browser fallback also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("unavailable", {
        status: 500,
        statusText: "Server Error",
        headers: { "Content-Type": "text/html" },
      }),
    ));
    vi.mocked(puppeteer.launch).mockRejectedValueOnce(new Error("browser down"));

    const req = new Request("https://md.example.com/https://example.com/fail?force_browser=true", {
      headers: { Accept: "application/json" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(502);
    expect(payload.error).toBe("Fetch Failed");
    expect(payload.message).toContain("Static fetch returned 500 and browser rendering also failed");
  });

  it("renders og image default title block when title is missing", async () => {
    const req = new Request("https://md.example.com/api/og");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Any URL to");
    expect(body).toContain("Markdown");
  });
});
