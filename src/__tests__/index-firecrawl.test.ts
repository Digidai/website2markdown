import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { createMockEnv, mockCtx } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Firecrawl integration", () => {
  it("rejects anonymous engine=firecrawl before any vendor fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://md.example.com/https://example.com/public?raw=true&engine=firecrawl",
      { headers: { Accept: "text/markdown" } },
    );
    const res = await worker.fetch(req, createMockEnv().env, mockCtx());
    const payload = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
    expect(payload.message).toBe("engine selection requires an API key.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not spend the server Firecrawl key for anonymous engine=firecrawl requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { env } = createMockEnv({ FIRECRAWL_API_KEY: "fc_server_secret" });
    const req = new Request(
      "https://md.example.com/https://example.com/anonymous-keyless?raw=true&engine=firecrawl",
      { headers: { Accept: "text/markdown" } },
    );
    const res = await worker.fetch(req, env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body).not.toContain("fc_server_secret");
  });

  it("uses Firecrawl for explicit engine=firecrawl without forwarding the app Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: {
          markdown: "# Firecrawl Engine\n\nConverted content.",
          metadata: { title: "Firecrawl Engine" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { env } = createMockEnv({ API_TOKEN: "test-token" });
    const req = new Request(
      "https://md.example.com/https://example.com/page?raw=true&engine=firecrawl",
      {
        headers: {
          Accept: "text/markdown",
          Authorization: "Bearer test-token",
        },
      },
    );
    const res = await worker.fetch(req, env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("readability+turndown");
    expect(body).toContain("# Firecrawl Engine");
    const outboundInit = fetchMock.mock.calls[0][1];
    expect(outboundInit.headers).not.toHaveProperty("Authorization");
  });

  it("uses Firecrawl before Jina for non-text document URLs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("pdf bytes", {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: {
            markdown: "# Parsed PDF\n\nFirecrawl parsed this document.",
            metadata: { title: "Parsed PDF" },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://md.example.com/https://example.com/file.pdf?raw=true",
      {
        headers: {
          Accept: "text/markdown",
          Authorization: "Bearer test-token",
        },
      },
    );
    const res = await worker.fetch(req, createMockEnv({ API_TOKEN: "test-token" }).env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("readability+turndown");
    expect(res.headers.get("X-Markdown-Fallbacks")).toBeNull();
    expect(body).toContain("Firecrawl parsed this document");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still rescues a near-empty page with Firecrawl after the CF engine failed", async () => {
    const story = "The council approved the harbour plan after a long night of debate. ".repeat(12);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://api.cloudflare.com/")) return Response.json({ success: false }, { status: 500 });
      if (url.includes("firecrawl")) {
        return Response.json({ success: true, data: { markdown: `# Harbour plan\n\n${story}`, metadata: { title: "Harbour plan" } } });
      }
      // A client-rendered shell: plenty of HTML, almost no text.
      return new Response(`<html><head><title>Harbour plan</title></head>
        <body><div id="root">${'<div class="card-placeholder"></div>'.repeat(120)}</div><p>Loading</p></body></html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createMockEnv({ API_TOKEN: "test-token", CF_ACCOUNT_ID: "acct", CF_API_TOKEN: "cf-token" });

    const res = await worker.fetch(new Request("https://md.example.com/https://news.example.com/harbour-plan-cf?engine=cf&raw=true", {
      headers: { Accept: "text/markdown", Authorization: "Bearer test-token" },
    }), env, mockCtx());

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("https://api.cloudflare.com/"))).toBe(true);
    expect(await res.text()).toContain("approved the harbour plan");
  });

  it("falls through to Jina when Firecrawl keyless is blocked", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("pdf bytes", {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { success: false, error: "keyless blocked" },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 200,
          data: {
            url: "https://example.com/file-jina.pdf",
            title: "Jina PDF",
            content: "# Jina PDF\n\nJina parsed this document.",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://md.example.com/https://example.com/file-jina.pdf?raw=true",
      {
        headers: {
          Accept: "text/markdown",
          Authorization: "Bearer test-token",
        },
      },
    );
    const res = await worker.fetch(req, createMockEnv({ API_TOKEN: "test-token" }).env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("readability+turndown");
    expect(res.headers.get("X-Markdown-Fallbacks")).toBeNull();
    expect(body).toContain("Jina parsed this document");
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://r.jina.ai/https://example.com/file-jina.pdf",
    );
  });

  it("returns 415 for an anonymous non-text document without calling Firecrawl or Jina", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("pdf bytes", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://md.example.com/https://example.com/anon.pdf?raw=true",
      { headers: { Accept: "text/markdown" } },
    );
    const res = await worker.fetch(req, createMockEnv().env, mockCtx());
    const payload = await res.json() as { error?: string; message?: string };
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(res.status).toBe(415);
    expect(payload.error).toBe("Unsupported Content");
    expect(urls.some((url) => url.includes("firecrawl") || url.includes("r.jina.ai"))).toBe(false);
  });
});
