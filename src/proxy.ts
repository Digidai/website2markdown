import { connect } from "cloudflare:sockets";
import { errorMessage } from "./utils";

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

const PROXY_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const HEADER_SEPARATOR_BYTES = new Uint8Array([13, 10, 13, 10]); // \r\n\r\n

async function readWithTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  signal?: AbortSignal,
  abortMessage: string = "Proxy request aborted",
): Promise<T> {
  if (signal?.aborted) {
    throw new Error(abortMessage);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  let abortHandler: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    if (!signal) return;
    abortHandler = () => reject(new Error(abortMessage));
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    return await Promise.race(signal ? [task, timeout, abort] : [task, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

/** Parse "username:password@host:port" into ProxyConfig. */
export function parseProxyUrl(raw: string): ProxyConfig | null {
  try {
    const atIdx = raw.lastIndexOf("@");
    if (atIdx < 0) return null;
    const auth = raw.slice(0, atIdx);
    const hostPort = raw.slice(atIdx + 1);
    const colonIdx = auth.indexOf(":");
    if (colonIdx < 0) return null;
    const [host, portStr] = hostPort.split(":");
    if (!host || !portStr) return null;
    const port = parseInt(portStr, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      host,
      port,
      username: auth.slice(0, colonIdx),
      password: auth.slice(colonIdx + 1),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a URL through an HTTP forward proxy.
 * Sends the full target URL to the proxy; the proxy handles TLS to the target.
 * Uses Cloudflare Workers TCP sockets.
 */
export async function fetchViaProxy(
  targetUrl: string,
  proxy: ProxyConfig,
  headers: Record<string, string>,
  timeoutMs: number = 20_000,
  signal?: AbortSignal,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (signal?.aborted) {
    throw new Error("Proxy request aborted");
  }

  const url = new URL(targetUrl);
  const socket = connect(
    { hostname: proxy.host, port: proxy.port },
    { secureTransport: "off", allowHalfOpen: false },
  );
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;

  try {
    // Send HTTP request with full URL (forward proxy mode)
    // The proxy will handle HTTPS to the target on our behalf.
    const authBase64 = btoa(`${proxy.username}:${proxy.password}`);
    let httpReq = `GET ${targetUrl} HTTP/1.1\r\n`;
    httpReq += `Host: ${url.hostname}\r\n`;
    httpReq += `Proxy-Authorization: Basic ${authBase64}\r\n`;
    for (const [key, val] of Object.entries(headers)) {
      httpReq += `${key}: ${val}\r\n`;
    }
    httpReq += "Connection: close\r\n\r\n";
    if (signal?.aborted) {
      throw new Error("Proxy request aborted");
    }
    await writer.write(encoder.encode(httpReq));

    // Read response with a hard deadline.
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    while (true) {
      if (signal?.aborted) {
        throw new Error("Proxy request aborted");
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Proxy response timed out after ${timeoutMs}ms`);
      }
      const { value, done } = await readWithTimeout(
        reader.read(),
        remainingMs,
        `Proxy response timed out after ${timeoutMs}ms`,
        signal,
      );
      if (done) break;
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > PROXY_RESPONSE_MAX_BYTES) {
          throw new Error("Proxy response exceeded 8 MB limit");
        }
        chunks.push(value);
      }
    }
    const rawResponse = concatUint8Arrays(chunks, bytesRead);

    // Parse HTTP response
    const headerEnd = indexOfBytes(rawResponse, HEADER_SEPARATOR_BYTES);
    if (headerEnd < 0) throw new Error("Invalid HTTP response from proxy");

    const headerSection = decoder.decode(rawResponse.subarray(0, headerEnd));
    let bodyBytes = rawResponse.subarray(headerEnd + HEADER_SEPARATOR_BYTES.length);
    const [statusLine, ...headerLines] = headerSection.split("\r\n");

    const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

    const respHeaders: Record<string, string> = {};
    for (const line of headerLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        respHeaders[line.slice(0, colonIdx).trim().toLowerCase()] =
          line.slice(colonIdx + 1).trim();
      }
    }

    // Handle chunked transfer encoding
    if (respHeaders["transfer-encoding"]?.includes("chunked")) {
      bodyBytes = decodeChunked(bodyBytes);
    }

    const body = decoder.decode(bodyBytes);
    return { status, headers: respHeaders, body };
  } finally {
    try { await writer.close(); } catch {}
    try { writer.releaseLock(); } catch {}
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock(); } catch {}
    try { socket.close(); } catch (e) {
      console.error("Proxy socket close failed:", errorMessage(e));
    }
  }
}

function concatUint8Arrays(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0];
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  start: number = 0,
): number {
  if (needle.length === 0) return start;
  const end = haystack.length - needle.length;
  for (let i = start; i <= end; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/** Decode chunked transfer encoding from bytes. */
function decodeChunked(raw: Uint8Array): Uint8Array {
  const lineDecoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let pos = 0;

  while (pos < raw.length) {
    const lineEnd = indexOfBytes(raw, new Uint8Array([13, 10]), pos); // \r\n
    if (lineEnd < 0) break;
    const sizeLine = lineDecoder.decode(raw.subarray(pos, lineEnd)).trim();
    const sizeToken = sizeLine.split(";", 1)[0];
    const size = parseInt(sizeToken, 16);
    if (isNaN(size) || size === 0) break;
    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + size;
    if (chunkEnd > raw.length) break;
    const chunk = raw.subarray(chunkStart, chunkEnd);
    chunks.push(chunk);
    total += chunk.byteLength;
    pos = chunkEnd + 2; // skip trailing \r\n
  }

  return concatUint8Arrays(chunks, total);
}
