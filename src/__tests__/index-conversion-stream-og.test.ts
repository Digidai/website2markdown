import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { createMockEnv } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("index conversion/stream/og routes", () => {
  it("returns JSON error for invalid format", async () => {
    const req = new Request(
      "https://md.example.com/https://example.com/article?format=xml",
      { headers: { Accept: "application/json" } },
    );
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid Format");
    expect(payload.message).toContain("Unknown format");
  });

  it("returns Invalid URL when target URL is malformed", async () => {
    const req = new Request(
      "https://md.example.com/https://exa mple.com",
      { headers: { Accept: "application/json" } },
    );
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string; status?: number };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid URL");
  });

  it("returns Blocked for private target URLs", async () => {
    const req = new Request(
      "https://md.example.com/http://127.0.0.1/private",
      { headers: { Accept: "application/json" } },
    );
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(403);
    expect(payload.error).toBe("Blocked");
  });

  it("rejects non-text content types", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("PDF", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/file", {
      headers: { Accept: "application/json" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(415);
    expect(payload.error).toBe("Unsupported Content");
  });

  it("rejects unsupported text/css content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("body{color:red}", {
        status: 200,
        headers: { "Content-Type": "text/css; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/style.css", {
      headers: { Accept: "application/json" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(415);
    expect(payload.error).toBe("Unsupported Content");
  });

  it("returns loading page for browser document navigation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://md.example.com/https://example.com/nav", {
      headers: {
        Accept: "text/html",
        "Sec-Fetch-Dest": "document",
      },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
    expect(html).toContain("Converting");
    expect(html).toContain("/api/stream?url=");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns rendered cached page for document navigation cache hit", async () => {
    const { env, mocks } = createMockEnv();
    mocks.kvGet.mockResolvedValueOnce(JSON.stringify({
      content: "# cached markdown",
      method: "native",
      title: "Cached Title",
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://md.example.com/https://example.com/cached", {
      headers: {
        Accept: "text/html",
        "Sec-Fetch-Dest": "document",
      },
    });
    const res = await worker.fetch(req, env);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("cached markdown");
    expect(html).toContain("CACHED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns markdown response for native markdown source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("# native markdown", {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/md", {
      headers: { Accept: "text/markdown" },
    });
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
    expect(res.headers.get("X-Markdown-Native")).toBe("true");
    expect(body).toContain("# native markdown");
  });

  it("returns html format for native markdown source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("# md with <tag>", {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/md?raw=true&format=html");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(body).toContain("<pre>");
    expect(body).toContain("&lt;tag&gt;");
  });

  it("returns json format for native markdown source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("# md json", {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/md?raw=true&format=json");
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { method?: string; markdown?: string };

    expect(res.status).toBe(200);
    expect(payload.method).toBe("native");
    expect(payload.markdown).toContain("# md json");
  });

  it("returns text format converted from html", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><head><title>T</title></head><body><h1>Hello</h1><p>World</p></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/https://example.com/t?raw=true&format=text");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("Hello");
    expect(body).toContain("World");
  });

  it("returns 400 for oversized selector on sync convert route", async () => {
    const selector = "x".repeat(257);
    const req = new Request(
      `https://md.example.com/https://example.com/t?raw=true&selector=${selector}`,
      { headers: { Accept: "application/json" } },
    );
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(payload.error).toBe("Invalid Selector");
  });

  it("returns selector-scoped text format", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(
        "<html><body><div class='sidebar'>Noise</div><article class='main'><h1>Hello</h1><p>World</p></article></body></html>",
        {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      ),
    ));

    const req = new Request(
      "https://md.example.com/https://example.com/t?raw=true&format=text&selector=.main",
    );
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Hello");
    expect(body).toContain("World");
    expect(body).not.toContain("Noise");
  });

  it("uses redirect final URL in json output", async () => {
    const fetchMock = vi.fn(async (req: RequestInfo | URL) => {
      const reqUrl = String(req);
      if (reqUrl === "https://example.com/original") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://final.example/article" },
        });
      }
      if (reqUrl === "https://final.example/article") {
        return new Response(
          "<html><head><title>T</title></head><body><article><p>redirected</p></article></body></html>",
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
      throw new Error(`Unexpected fetch URL: ${reqUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://md.example.com/https://example.com/original?raw=true&format=json",
    );
    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { url?: string; markdown?: string };

    expect(res.status).toBe(200);
    expect(payload.url).toBe("https://final.example/article");
    expect(payload.markdown).toContain("redirected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("streams fail event for invalid /api/stream URL", async () => {
    const req = new Request("https://md.example.com/api/stream?url=not-a-url");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(body).toContain("event: fail");
    expect(body).toContain("Invalid URL");
  });

  it("streams fail event for oversized selector", async () => {
    const selector = "a".repeat(257);
    const req = new Request(
      `https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Fstream&selector=${selector}`,
    );
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("event: fail");
    expect(body).toContain("\"title\":\"Invalid Selector\"");
  });

  it("streams done event for successful /api/stream conversion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("# stream markdown", {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Fstream");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("event: done");
    expect(body).toContain("\"rawUrl\":\"/https%3A%2F%2Fexample.com%2Fstream?raw=true\"");
    expect(body).toContain("\"method\":\"native\"");
  });

  it("streams fail event when conversion throws ConvertError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("upstream failed", {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const req = new Request("https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Ffail");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(body).toContain("event: fail");
    expect(body).toContain("\"title\":\"Fetch Failed\"");
    expect(body).toContain("\"status\":502");
  });

  it("renders /api/og svg image", async () => {
    const req = new Request("https://md.example.com/api/og?title=This%20is%20a%20long%20title");
    const res = await worker.fetch(req, createMockEnv().env);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(body).toContain("<svg");
    expect(body).toContain("This is a long title");
  });
});
