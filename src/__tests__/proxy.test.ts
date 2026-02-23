import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import { connect } from "cloudflare:sockets";
import {
  fetchViaProxy,
  fetchViaProxyPool,
  parseProxyUrl,
  parseProxyPool,
  type ProxyConfig,
} from "../proxy";

type ProxyReadResult = { value?: Uint8Array; done: boolean };

function makeProxyConfig(): ProxyConfig {
  return {
    host: "proxy.example.com",
    port: 8080,
    username: "user",
    password: "pass",
  };
}

function createMockSocket(readImpl: () => Promise<ProxyReadResult>) {
  const writtenChunks: Uint8Array[] = [];

  const writer = {
    write: vi.fn(async (chunk: Uint8Array) => {
      writtenChunks.push(chunk);
    }),
    close: vi.fn(async () => {}),
    releaseLock: vi.fn(),
  };

  const reader = {
    read: vi.fn(readImpl),
    cancel: vi.fn(async () => {}),
    releaseLock: vi.fn(),
  };

  const socket = {
    writable: {
      getWriter: vi.fn(() => writer),
    },
    readable: {
      getReader: vi.fn(() => reader),
    },
    close: vi.fn(),
  };

  return { socket, writer, reader, writtenChunks };
}

function createSocketFromRawResponse(responseText: string) {
  const encoded = new TextEncoder().encode(responseText);
  let sent = false;
  return createMockSocket(async () => {
    if (sent) return { done: true };
    sent = true;
    return { done: false, value: encoded };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseProxyUrl", () => {
  it("parses valid proxy URL", () => {
    const parsed = parseProxyUrl("alice:secret@proxy.example.com:8888");
    expect(parsed).toEqual({
      host: "proxy.example.com",
      port: 8888,
      username: "alice",
      password: "secret",
    });
  });

  it("rejects invalid ports", () => {
    expect(parseProxyUrl("alice:secret@proxy.example.com:0")).toBeNull();
    expect(parseProxyUrl("alice:secret@proxy.example.com:70000")).toBeNull();
    expect(parseProxyUrl("alice:secret@proxy.example.com:not-a-port")).toBeNull();
    expect(parseProxyUrl("alice:secret@proxy.example.com:8080abc")).toBeNull();
    expect(parseProxyUrl("alice:secret@proxy.example.com:+8080")).toBeNull();
  });

  it("rejects empty proxy credentials", () => {
    expect(parseProxyUrl(":secret@proxy.example.com:8080")).toBeNull();
    expect(parseProxyUrl("alice:@proxy.example.com:8080")).toBeNull();
  });

  it("rejects proxy credentials or host containing whitespace", () => {
    expect(parseProxyUrl("alice user:secret@proxy.example.com:8080")).toBeNull();
    expect(parseProxyUrl("alice:sec ret@proxy.example.com:8080")).toBeNull();
    expect(parseProxyUrl("alice:secret@proxy .example.com:8080")).toBeNull();
  });

  it("parses bracketed IPv6 proxy hosts", () => {
    const parsed = parseProxyUrl("alice:secret@[2001:db8::1]:8080");
    expect(parsed).toEqual({
      host: "2001:db8::1",
      port: 8080,
      username: "alice",
      password: "secret",
    });
  });

  it("parses proxy pools and deduplicates entries", () => {
    const parsed = parseProxyPool(`
      alice:secret@proxy-1.example.com:8080,
      bob:secret@proxy-2.example.com:8080
      alice:secret@proxy-1.example.com:8080
      invalid-entry
    `);
    expect(parsed).toEqual([
      {
        host: "proxy-1.example.com",
        port: 8080,
        username: "alice",
        password: "secret",
      },
      {
        host: "proxy-2.example.com",
        port: 8080,
        username: "bob",
        password: "secret",
      },
    ]);
  });

  it("deduplicates proxy pools case-insensitively by host", () => {
    const parsed = parseProxyPool(`
      alice:secret@PROXY-1.example.com:8080
      alice:secret@proxy-1.EXAMPLE.com:8080
    `);
    expect(parsed).toEqual([
      {
        host: "PROXY-1.example.com",
        port: 8080,
        username: "alice",
        password: "secret",
      },
    ]);
  });
});

describe("fetchViaProxy", () => {
  it("returns parsed chunked response body", async () => {
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "Content-Type: text/html\r\n\r\n" +
      "5\r\nhello\r\n" +
      "0\r\n\r\n";
    const encoded = new TextEncoder().encode(responseText);
    let sent = false;
    const mock = createMockSocket(async () => {
      if (sent) return { done: true };
      sent = true;
      return { done: false, value: encoded };
    });
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    const result = await fetchViaProxy(
      "https://example.com/path",
      makeProxyConfig(),
      { Accept: "text/html" },
      1000,
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe("hello");
    expect(mock.writer.write).toHaveBeenCalledTimes(1);
    expect(mock.reader.read).toHaveBeenCalled();
    expect(mock.socket.close).toHaveBeenCalledTimes(1);
  });

  it("decodes chunked body with case-insensitive transfer-encoding header", async () => {
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Transfer-Encoding: Chunked\r\n" +
      "Content-Type: text/plain\r\n\r\n" +
      "5\r\nhello\r\n" +
      "0\r\n\r\n";
    const mock = createSocketFromRawResponse(responseText);
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    const result = await fetchViaProxy(
      "https://example.com/path",
      makeProxyConfig(),
      {},
      1000,
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe("hello");
  });

  it("decodes UTF-8 chunked response bodies correctly", async () => {
    const bodyBytes = new TextEncoder().encode("你好");
    const chunkHeader = new TextEncoder().encode(
      `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${bodyBytes.length.toString(16)}\r\n`,
    );
    const chunkFooter = new TextEncoder().encode("\r\n0\r\n\r\n");
    const encoded = new Uint8Array(
      chunkHeader.length + bodyBytes.length + chunkFooter.length,
    );
    encoded.set(chunkHeader, 0);
    encoded.set(bodyBytes, chunkHeader.length);
    encoded.set(chunkFooter, chunkHeader.length + bodyBytes.length);

    let sent = false;
    const mock = createMockSocket(async () => {
      if (sent) return { done: true };
      sent = true;
      return { done: false, value: encoded };
    });
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    const result = await fetchViaProxy(
      "https://example.com/path",
      makeProxyConfig(),
      { Accept: "text/html" },
      1000,
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe("你好");
  });

  it("rejects malformed chunked encoding", async () => {
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "Content-Type: text/html\r\n\r\n" +
      "ZZ\r\nhello\r\n" +
      "0\r\n\r\n";
    const mock = createSocketFromRawResponse(responseText);
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("https://example.com/path", makeProxyConfig(), {}, 1000),
    ).rejects.toThrow("Invalid chunked encoding");
  });

  it("rejects partially valid chunk size tokens", async () => {
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "Content-Type: text/html\r\n\r\n" +
      "5g\r\nhello\r\n" +
      "0\r\n\r\n";
    const mock = createSocketFromRawResponse(responseText);
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("https://example.com/path", makeProxyConfig(), {}, 1000),
    ).rejects.toThrow("Invalid chunked encoding: non-hex chunk size");
  });

  it("closes socket resources on malformed proxy response", async () => {
    const malformed = new TextEncoder().encode("HTTP/1.1 200 OK\r\n");
    let sent = false;
    const mock = createMockSocket(async () => {
      if (sent) return { done: true };
      sent = true;
      return { done: false, value: malformed };
    });
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("https://example.com/path", makeProxyConfig(), {}, 1000),
    ).rejects.toThrow("Invalid HTTP response from proxy");

    expect(mock.reader.cancel).toHaveBeenCalledTimes(1);
    expect(mock.writer.close).toHaveBeenCalledTimes(1);
    expect(mock.socket.close).toHaveBeenCalledTimes(1);
  });

  it("rejects proxy responses with invalid status lines", async () => {
    const responseText =
      "NOTHTTP\r\n" +
      "Content-Type: text/plain\r\n\r\n" +
      "oops";
    const mock = createSocketFromRawResponse(responseText);
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("https://example.com/path", makeProxyConfig(), {}, 1000),
    ).rejects.toThrow("Invalid HTTP status line from proxy");
    expect(mock.socket.close).toHaveBeenCalledTimes(1);
  });

  it("rejects outbound proxy headers containing CRLF characters", async () => {
    const mock = createSocketFromRawResponse(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nok",
    );
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy(
        "https://example.com/path",
        makeProxyConfig(),
        {
          "X-Test": "ok\r\nInjected: bad",
        },
        1000,
      ),
    ).rejects.toThrow("Invalid proxy request header value");
  });

  it("includes non-default target port in forwarded Host header", async () => {
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Content-Type: text/plain\r\n\r\n" +
      "ok";
    const mock = createSocketFromRawResponse(responseText);
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await fetchViaProxy(
      "https://example.com:8443/path",
      makeProxyConfig(),
      {},
      1000,
    );

    const payload = new TextDecoder().decode(mock.writtenChunks[0]);
    expect(payload).toContain("Host: example.com:8443\r\n");
  });

  it("enforces 8MB max response size and still closes socket resources", async () => {
    const body = "x".repeat(8 * 1024 * 1024 + 1);
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Content-Type: text/html\r\n\r\n" +
      body;
    const encoded = new TextEncoder().encode(responseText);
    let sent = false;
    const mock = createMockSocket(async () => {
      if (sent) return { done: true };
      sent = true;
      return { done: false, value: encoded };
    });
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("https://example.com/path", makeProxyConfig(), {}, 1_000),
    ).rejects.toThrow("Proxy response exceeded 8 MB limit");

    expect(mock.reader.cancel).toHaveBeenCalledTimes(1);
    expect(mock.writer.close).toHaveBeenCalledTimes(1);
    expect(mock.socket.close).toHaveBeenCalledTimes(1);
  });

  it("times out stalled reads and still closes socket resources", async () => {
    const mock = createMockSocket(
      async () => await new Promise<ProxyReadResult>(() => {}),
    );
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("https://example.com/path", makeProxyConfig(), {}, 30),
    ).rejects.toThrow("Proxy response timed out");

    expect(mock.reader.cancel).toHaveBeenCalledTimes(1);
    expect(mock.writer.close).toHaveBeenCalledTimes(1);
    expect(mock.socket.close).toHaveBeenCalledTimes(1);
  });

  it("aborts stalled proxy reads when AbortSignal is triggered", async () => {
    const mock = createMockSocket(
      async () => await new Promise<ProxyReadResult>(() => {}),
    );
    vi.mocked(connect).mockReturnValue(mock.socket as never);
    const controller = new AbortController();

    const task = fetchViaProxy(
      "https://example.com/path",
      makeProxyConfig(),
      {},
      5_000,
      controller.signal,
    );
    controller.abort();

    await expect(task).rejects.toThrow("Proxy request aborted");
    expect(mock.reader.cancel).toHaveBeenCalledTimes(1);
    expect(mock.writer.close).toHaveBeenCalledTimes(1);
    expect(mock.socket.close).toHaveBeenCalledTimes(1);
  });

  it("rotates proxies until an accepted response is found", async () => {
    const firstSocket = createSocketFromRawResponse(
      "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n\r\nblocked",
    );
    const secondSocket = createSocketFromRawResponse(
      "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nok-via-second-proxy",
    );
    vi.mocked(connect)
      .mockReturnValueOnce(firstSocket.socket as never)
      .mockReturnValueOnce(secondSocket.socket as never);

    const result = await fetchViaProxyPool(
      "https://example.com/path",
      [
        {
          host: "proxy-1.example.com",
          port: 8080,
          username: "u1",
          password: "p1",
        },
        {
          host: "proxy-2.example.com",
          port: 8080,
          username: "u2",
          password: "p2",
        },
      ],
      [{ name: "desktop", headers: {} }],
      {
        acceptResult: (candidate) => candidate.status === 200,
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe("ok-via-second-proxy");
    expect(result.proxyIndex).toBe(1);
    expect(result.attempts).toBe(2);
    expect(result.errors[0]).toContain("rejected status=403");
  });

  it("rotates header variants on a single proxy", async () => {
    const firstVariant = createSocketFromRawResponse(
      "HTTP/1.1 429 Too Many Requests\r\nContent-Type: text/html\r\n\r\nslow-down",
    );
    const secondVariant = createSocketFromRawResponse(
      "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nok-mobile-variant",
    );
    vi.mocked(connect)
      .mockReturnValueOnce(firstVariant.socket as never)
      .mockReturnValueOnce(secondVariant.socket as never);

    const result = await fetchViaProxyPool(
      "https://example.com/path",
      [makeProxyConfig()],
      [
        { name: "desktop", headers: { "User-Agent": "Desktop-UA" } },
        { name: "mobile", headers: { "User-Agent": "Mobile-UA" } },
      ],
      {
        acceptResult: (candidate) => candidate.status === 200,
      },
    );

    expect(result.status).toBe(200);
    expect(result.variant).toBe("mobile");
    expect(result.attempts).toBe(2);
    expect(result.errors[0]).toContain("rejected status=429");
  });
});
