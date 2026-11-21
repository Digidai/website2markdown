import { readFileSync } from "node:fs";
import { connect as connectTcp } from "node:net";
import { fileURLToPath } from "node:url";
import { createServer as createTlsServer, type SecureVersion } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";

// A test-only CA (valid until 2126) and a certificate it signed for proxy-test.example.
const tlsFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/proxy-tls/${name}`, import.meta.url).href), "utf8");

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));
vi.mock("../proxy-roots", async () => ({
  PROXY_ROOTS_PEM: (await import("node:fs")).readFileSync(
    (await import("node:url")).fileURLToPath(new URL("./fixtures/proxy-tls/ca.pem", import.meta.url).href),
    "utf8",
  ),
}));

import { connect } from "cloudflare:sockets";
import {
  fetchViaProxy,
  fetchViaProxyPool,
  parseProxyUrl,
  parseProxyPool,
  type ProxyConfig,
  type ProxyPoolError,
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

  it("rejects non-Latin1 proxy credentials", () => {
    expect(parseProxyUrl("用户:secret@proxy.example.com:8080")).toBeNull();
    expect(parseProxyUrl("alice:密码@proxy.example.com:8080")).toBeNull();
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
      "http://example.com/path",
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
      "http://example.com/path",
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
      "http://example.com/path",
      makeProxyConfig(),
      { Accept: "text/html" },
      1000,
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe("你好");
  });

  it("gives up on a proxy connection that never opens within the timeout", async () => {
    const mock = createMockSocket(() => new Promise(() => {}));
    mock.writer.write.mockImplementation(() => new Promise(() => {}));
    mock.writer.close.mockImplementation(() => new Promise(() => {}));
    mock.reader.cancel.mockImplementation(() => new Promise(() => {}));
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("https://example.com/path", makeProxyConfig(), {}, 50),
    ).rejects.toThrow("Proxy response timed out after 50ms");
    expect(mock.socket.close).toHaveBeenCalled();
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
      fetchViaProxy("http://example.com/path", makeProxyConfig(), {}, 1000),
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
      fetchViaProxy("http://example.com/path", makeProxyConfig(), {}, 1000),
    ).rejects.toThrow("Invalid chunked encoding: non-hex chunk size");
  });

  it("rejects chunked encoding without final trailer terminator", async () => {
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "Content-Type: text/html\r\n\r\n" +
      "5\r\nhello\r\n" +
      "0\r\n";
    const mock = createSocketFromRawResponse(responseText);
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("http://example.com/path", makeProxyConfig(), {}, 1000),
    ).rejects.toThrow("Invalid chunked encoding: missing terminating trailer end");
  });

  it("accepts valid chunked trailers", async () => {
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "Content-Type: text/html\r\n\r\n" +
      "5\r\nhello\r\n" +
      "0\r\n" +
      "X-Test: ok\r\n\r\n";
    const mock = createSocketFromRawResponse(responseText);
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    const result = await fetchViaProxy(
      "http://example.com/path",
      makeProxyConfig(),
      {},
      1000,
    );
    expect(result.status).toBe(200);
    expect(result.body).toBe("hello");
  });

  it("rejects malformed chunked trailer lines", async () => {
    const responseText =
      "HTTP/1.1 200 OK\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "Content-Type: text/html\r\n\r\n" +
      "5\r\nhello\r\n" +
      "0\r\n" +
      "bad-trailer\r\n\r\n";
    const mock = createSocketFromRawResponse(responseText);
    vi.mocked(connect).mockReturnValue(mock.socket as never);

    await expect(
      fetchViaProxy("http://example.com/path", makeProxyConfig(), {}, 1000),
    ).rejects.toThrow("Invalid chunked encoding: malformed trailer line");
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
      fetchViaProxy("http://example.com/path", makeProxyConfig(), {}, 1000),
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
      fetchViaProxy("http://example.com/path", makeProxyConfig(), {}, 1000),
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
        "http://example.com/path",
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
      "http://example.com:8443/path",
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
      fetchViaProxy("http://example.com/path", makeProxyConfig(), {}, 1_000),
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
      fetchViaProxy("http://example.com/path", makeProxyConfig(), {}, 30),
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
      "http://example.com/path",
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

  /**
   * A proxy that answers CONNECT and then relays to a local TLS server offering only `version`.
   * The server answers every request with `body` and records what it received. `cert` names the
   * fixture it presents; with `cutAfterBytes` the tunnel drops after relaying that many bytes.
   */
  async function tunnelToTlsServer(
    version: SecureVersion,
    { body = "secure-content", cert = "proxy-test.example", cutAfterBytes = Infinity } = {},
  ) {
    const seen = { request: "", protocol: "" };
    const server = createTlsServer(
      {
        key: tlsFixture(`${cert}.key`),
        cert: tlsFixture(`${cert}.pem`),
        minVersion: version,
        maxVersion: version,
      },
      (socket) => {
        seen.protocol = socket.getProtocol() ?? "";
        socket.on("data", (chunk) => {
          seen.request += chunk.toString();
          if (seen.request.includes("\r\n\r\n")) {
            socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          }
        });
      },
    );
    server.on("tlsClientError", () => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const connectPayloads: string[] = [];
    vi.mocked(connect).mockImplementation(() => {
      const tcp = connectTcp(port, "127.0.0.1");
      const inbox: Uint8Array[] = [];
      let ended = false;
      let wake = () => {};
      let relayed = 0;
      tcp.on("data", (chunk: Buffer) => {
        if (ended) return;
        const room = cutAfterBytes - relayed;
        relayed += chunk.byteLength;
        if (room > 0) inbox.push(new Uint8Array(chunk.subarray(0, room)));
        if (relayed >= cutAfterBytes) { ended = true; tcp.destroy(); }
        wake();
      });
      tcp.on("close", () => { ended = true; wake(); });
      tcp.on("error", () => {});
      let tunnelOpen = false;
      return {
        writable: {
          getWriter: () => ({
            write: async (chunk: Uint8Array) => {
              if (!tunnelOpen) {
                // The first write is the CONNECT request: answer it as the proxy would.
                tunnelOpen = true;
                connectPayloads.push(new TextDecoder().decode(chunk));
                inbox.push(new TextEncoder().encode("HTTP/1.1 200 Connection established\r\n\r\n"));
                wake();
                return;
              }
              await new Promise<void>((resolve) => tcp.write(chunk, () => resolve()));
            },
            close: async () => {},
            releaseLock: () => {},
          }),
        },
        readable: {
          getReader: () => ({
            read: async () => {
              while (inbox.length === 0 && !ended) await new Promise<void>((resolve) => { wake = resolve; });
              const value = inbox.shift();
              return value ? { done: false, value } : { done: true };
            },
            cancel: async () => {},
            releaseLock: () => {},
          }),
        },
        close: () => tcp.destroy(),
      } as never;
    });

    return {
      seen,
      connectPayloads,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it.each(["TLSv1.2", "TLSv1.3"] as const)("tunnels HTTPS through CONNECT to a %s server and verifies it", async (version) => {
    const tunnel = await tunnelToTlsServer(version);
    try {
      const result = await fetchViaProxy("https://proxy-test.example/secure-path?q=1", makeProxyConfig(), { "User-Agent": "test-agent" }, 5000);

      expect(result.status).toBe(200);
      expect(result.body).toBe("secure-content");
      expect(tunnel.seen.protocol).toBe(version);
      expect(tunnel.connectPayloads[0]).toMatch(/^CONNECT proxy-test\.example:443 HTTP\/1\.1\r\n/);
      expect(tunnel.connectPayloads[0]).toContain("Proxy-Authorization: Basic ");
      expect(tunnel.seen.request).toMatch(/^GET \/secure-path\?q=1 HTTP\/1\.1\r\nHost: proxy-test\.example\r\n/);
      expect(tunnel.seen.request).toContain("User-Agent: test-agent\r\n");
      expect(tunnel.seen.request).not.toContain("Proxy-Authorization");
    } finally {
      await tunnel.close();
    }
  });

  it("checks the certificate against the host without its root dot", async () => {
    const tunnel = await tunnelToTlsServer("TLSv1.2");
    try {
      const result = await fetchViaProxy("https://proxy-test.example./path", makeProxyConfig(), {}, 5000);
      expect(result.body).toBe("secure-content");
    } finally {
      await tunnel.close();
    }
  });

  it("refuses a certificate that names the host only in its Common Name", async () => {
    const tunnel = await tunnelToTlsServer("TLSv1.2", { cert: "proxy-test.example-no-san" });
    try {
      await expect(fetchViaProxy("https://proxy-test.example/path", makeProxyConfig(), {}, 5000))
        .rejects.toThrow(/TLS handshake with proxy-test\.example failed: .*subjectAltName/);
      expect(tunnel.seen.request).toBe("");
    } finally {
      await tunnel.close();
    }
  });

  it("returns a body that spans several TLS records whole", async () => {
    const body = "x".repeat(64 * 1024);
    const tunnel = await tunnelToTlsServer("TLSv1.2", { body });
    try {
      const result = await fetchViaProxy("https://proxy-test.example/big", makeProxyConfig(), {}, 5000);
      expect(result.body).toBe(body);
    } finally {
      await tunnel.close();
    }
  });

  it("rejects a response whose tunnel drops in the middle of a TLS record", async () => {
    // The handshake takes about 1-2 KB and records carry 16 KB each, so 20,000 bytes ends
    // inside the second record of the 64 KB body.
    const tunnel = await tunnelToTlsServer("TLSv1.2", { body: "x".repeat(64 * 1024), cutAfterBytes: 20_000 });
    try {
      await expect(fetchViaProxy("https://proxy-test.example/big", makeProxyConfig(), {}, 5000))
        .rejects.toThrow(/TLS connection ended in the middle of a record/);
    } finally {
      await tunnel.close();
    }
  });

  it("refuses a server whose certificate names another host", async () => {
    const tunnel = await tunnelToTlsServer("TLSv1.2");
    try {
      await expect(fetchViaProxy("https://other.example/path", makeProxyConfig(), {}, 5000))
        .rejects.toThrow(/TLS handshake with other\.example failed: .*Certificate verification failed/);
      expect(tunnel.seen.request).toBe("");
    } finally {
      await tunnel.close();
    }
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
      "http://example.com/path",
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
      "http://example.com/path",
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

  it("reports every attempt when none is accepted, including those that threw", async () => {
    const refused = createSocketFromRawResponse(
      "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n\r\nblocked",
    );
    vi.mocked(connect)
      .mockReturnValueOnce(refused.socket as never)
      .mockImplementationOnce(() => { throw new Error("connect failed"); });

    const error: ProxyPoolError = await fetchViaProxyPool(
      "http://example.com/path",
      [makeProxyConfig()],
      [{ name: "mobile", headers: {} }, { name: "desktop", headers: {} }],
      { acceptResult: (candidate) => candidate.status === 200 },
    ).then(() => { throw new Error("expected a failure"); }, (e: ProxyPoolError) => e);

    expect(error.attempts).toBe(2);
    expect(error.message).toContain("rejected status=403");
  });
});

describe("proxy CONNECT rejection reason", () => {
  it("reports the status line but no response header values", async () => {
    const { socket } = createSocketFromRawResponse(
      "HTTP/1.1 407 Proxy Authentication Required\r\n" +
      "x-proxy-error: account hl_secret is not whitelisted\r\n" +
      "\r\n",
    );
    vi.mocked(connect).mockReturnValue(socket as never);

    const error = await fetchViaProxy("https://example.com/", makeProxyConfig(), {}, 1_000)
      .catch((e: Error) => e);

    expect(String(error)).toContain("status 407: HTTP/1.1 407 Proxy Authentication Required");
    expect(String(error)).not.toContain("hl_secret");
  });
});
