import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import { connect } from "cloudflare:sockets";
import { fetchViaProxy, parseProxyUrl, type ProxyConfig } from "../proxy";

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
});
