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

function extractRequest(
  body: unknown,
  token?: string,
  headers?: Record<string, string>,
): Request {
  return new Request("https://md.example.com/api/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/extract", () => {
  it("returns 503 when API_TOKEN is missing", async () => {
    const req = extractRequest({
      strategy: "css",
      html: "<h1>Hello</h1>",
      schema: { fields: [{ name: "title", selector: "h1" }] },
    }, "token");

    const res = await worker.fetch(req, createMockEnv().env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(503);
    expect(payload.error).toBe("Service misconfigured");
  });

  it("returns 401 for invalid bearer token", async () => {
    const { env } = createMockEnv({ API_TOKEN: "correct-token" });
    const req = extractRequest({
      strategy: "css",
      html: "<h1>Hello</h1>",
      schema: { fields: [{ name: "title", selector: "h1" }] },
    }, "wrong-token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
  });

  it("extracts from html input in single mode", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = extractRequest({
      strategy: "css",
      html: "<article><h1>Hello</h1><p>World</p></article>",
      include_markdown: true,
      schema: {
        fields: [
          { name: "title", selector: "h1", type: "text" },
          { name: "body", selector: "p", type: "text" },
        ],
      },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      success?: boolean;
      strategy?: string;
      data?: { title?: string; body?: string };
      markdown?: string;
    };

    expect(res.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.strategy).toBe("css");
    expect(payload.data?.title).toBe("Hello");
    expect(payload.data?.body).toBe("World");
    expect(payload.markdown).toContain("Hello");
  });

  it("extracts in batch mode", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = extractRequest({
      items: [
        {
          strategy: "regex",
          html: "a@example.com b@example.com",
          schema: {
            patterns: {
              emails: "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}",
            },
            flags: "gi",
          },
        },
        {
          strategy: "css",
          html: "<div class='x'><span>42</span></div>",
          schema: {
            fields: [{ name: "value", selector: ".x span", type: "text" }],
          },
        },
      ],
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      results?: Array<{
        success?: boolean;
        strategy?: string;
        data?: Record<string, unknown>;
      }>;
    };

    expect(res.status).toBe(200);
    expect(payload.results?.length).toBe(2);
    expect(payload.results?.[0].success).toBe(true);
    expect(payload.results?.[0].strategy).toBe("regex");
    expect(payload.results?.[1].success).toBe(true);
    expect(payload.results?.[1].strategy).toBe("css");
  });

  it("returns 400 for invalid strategy", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = extractRequest({
      strategy: "llm",
      html: "<h1>Hello</h1>",
      schema: { fields: [{ name: "title", selector: "h1" }] },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { code?: string; message?: string };

    expect(res.status).toBe(400);
    expect(payload.code).toBe("UNSUPPORTED_STRATEGY");
    expect(payload.message).toContain("strategy");
  });

  it("returns indexed validation errors for invalid batch items", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = extractRequest({
      items: [
        {
          strategy: "css",
          html: "<h1>ok</h1>",
          schema: { fields: [{ name: "title", selector: "h1" }] },
        },
        {
          strategy: "regex",
          html: "",
          schema: { patterns: { email: ".+" } },
        },
      ],
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      code?: string;
      details?: { index?: number };
    };

    expect(res.status).toBe(400);
    expect(payload.code).toBe("INVALID_REQUEST");
    expect(payload.details?.index).toBe(1);
  });

  it("accepts nested input.url format for single extraction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body><h1>Nested Input</h1></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ));

    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = extractRequest({
      strategy: "css",
      input: { url: "https://example.com/nested" },
      schema: { fields: [{ name: "title", selector: "h1", type: "text" }] },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as {
      success?: boolean;
      data?: { title?: string };
      source?: { url?: string };
    };

    expect(res.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toBeTruthy();
    expect(payload.source?.url).toBe("https://example.com/nested");
  });

  it("rejects empty items array and oversized items batch", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });

    const emptyReq = extractRequest({ items: [] }, "token");
    const emptyRes = await worker.fetch(emptyReq, env);
    const emptyPayload = await emptyRes.json() as { message?: string };
    expect(emptyRes.status).toBe(400);
    expect(emptyPayload.message).toContain("cannot be empty");

    const tooManyReq = extractRequest({
      items: Array.from({ length: 11 }, () => ({
        strategy: "css",
        html: "<h1>x</h1>",
        schema: { fields: [{ name: "title", selector: "h1" }] },
      })),
    }, "token");
    const tooManyRes = await worker.fetch(tooManyReq, env);
    const tooManyPayload = await tooManyRes.json() as { message?: string };
    expect(tooManyRes.status).toBe(400);
    expect(tooManyPayload.message).toContain("Maximum 10 items");
  });

  it("rejects selector longer than max length", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = extractRequest({
      strategy: "css",
      html: "<h1>Hello</h1>",
      selector: "a".repeat(257),
      schema: { fields: [{ name: "title", selector: "h1" }] },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { code?: string; message?: string };

    expect(res.status).toBe(400);
    expect(payload.code).toBe("INVALID_REQUEST");
    expect(payload.message).toContain("selector is too long");
  });

  it("rejects oversized extract request body before parsing payload", async () => {
    const { env } = createMockEnv({ API_TOKEN: "token" });
    const req = extractRequest({
      strategy: "css",
      html: "x".repeat(5 * 1024 * 1024 + 1),
      schema: { fields: [{ name: "title", selector: "h1" }] },
    }, "token");

    const res = await worker.fetch(req, env);
    const payload = await res.json() as { code?: string; message?: string };

    expect(res.status).toBe(413);
    expect(payload.code).toBe("INVALID_REQUEST");
    expect(payload.message).toContain("Maximum body size");
  });
});
