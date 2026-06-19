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
  it("allows explicit engine=firecrawl without an app API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: {
          markdown: "# Anonymous Firecrawl\n\nConverted without app auth.",
          metadata: { title: "Anonymous Firecrawl" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request(
      "https://md.example.com/https://example.com/public?raw=true&engine=firecrawl",
      { headers: { Accept: "text/markdown" } },
    );
    const res = await worker.fetch(req, createMockEnv().env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("firecrawl");
    expect(body).toContain("Converted without app auth");
    const outboundInit = fetchMock.mock.calls[0][1];
    expect(outboundInit.headers).not.toHaveProperty("Authorization");
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
    expect(res.headers.get("X-Markdown-Method")).toBe("firecrawl");
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
      { headers: { Accept: "text/markdown" } },
    );
    const res = await worker.fetch(req, createMockEnv().env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("firecrawl");
    expect(res.headers.get("X-Markdown-Fallbacks")).toBe("firecrawl_fallback");
    expect(body).toContain("Firecrawl parsed this document");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      { headers: { Accept: "text/markdown" } },
    );
    const res = await worker.fetch(req, createMockEnv().env, mockCtx());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("jina");
    expect(res.headers.get("X-Markdown-Fallbacks")).toBe(
      "firecrawl_error_fallthrough,jina_fallback",
    );
    expect(body).toContain("Jina parsed this document");
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://r.jina.ai/https://example.com/file-jina.pdf",
    );
  });
});
