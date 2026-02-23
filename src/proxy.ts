import { connect } from "cloudflare:sockets";
import { errorMessage } from "./utils";

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ProxyHeaderVariant {
  name: string;
  headers: Record<string, string>;
}

export interface ProxyFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ProxyPoolResult extends ProxyFetchResult {
  proxyIndex: number;
  proxy: ProxyConfig;
  variant: string;
  attempts: number;
  errors: string[];
}

export interface ProxyPoolOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  acceptResult?: (
    result: ProxyFetchResult,
    context: { proxyIndex: number; variant: string; attempts: number },
  ) => boolean | Promise<boolean>;
}

const PROXY_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const HEADER_SEPARATOR_BYTES = new Uint8Array([13, 10, 13, 10]); // \r\n\r\n
const CRLF_BYTES = new Uint8Array([13, 10]); // \r\n
const HEADER_NAME_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function assertValidProxyHeader(name: string, value: string): void {
  const normalizedName = name.trim();
  if (!normalizedName || !HEADER_NAME_TOKEN_PATTERN.test(normalizedName)) {
    throw new Error(`Invalid proxy request header name: ${name}`);
  }
  if (value.includes("\r") || value.includes("\n")) {
    throw new Error(`Invalid proxy request header value for ${normalizedName}`);
  }
}

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
    const trimmed = raw.trim();
    const atIdx = trimmed.lastIndexOf("@");
    if (atIdx < 0) return null;
    const auth = trimmed.slice(0, atIdx);
    const hostPort = trimmed.slice(atIdx + 1);
    const colonIdx = auth.indexOf(":");
    if (colonIdx < 0) return null;
    const username = auth.slice(0, colonIdx);
    const password = auth.slice(colonIdx + 1);
    if (!username || !password) return null;
    if (/\s/.test(username) || /\s/.test(password)) return null;
    let host = "";
    let portStr = "";
    if (hostPort.startsWith("[")) {
      const bracketEnd = hostPort.indexOf("]");
      if (bracketEnd < 1) return null;
      host = hostPort.slice(1, bracketEnd);
      if (hostPort[bracketEnd + 1] !== ":") return null;
      portStr = hostPort.slice(bracketEnd + 2);
    } else {
      const hostColonIdx = hostPort.lastIndexOf(":");
      if (hostColonIdx <= 0) return null;
      host = hostPort.slice(0, hostColonIdx);
      portStr = hostPort.slice(hostColonIdx + 1);
    }
    if (!host || !portStr) return null;
    if (/\s/.test(host)) return null;
    if (!/^\d+$/.test(portStr)) return null;
    const port = parseInt(portStr, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      host,
      port,
      username,
      password,
    };
  } catch {
    return null;
  }
}

/** Parse a proxy pool string (comma/newline/semicolon separated). */
export function parseProxyPool(raw: string): ProxyConfig[] {
  const parts = raw
    .split(/[\n,;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = new Set<string>();
  const configs: ProxyConfig[] = [];

  for (const part of parts) {
    const parsed = parseProxyUrl(part);
    if (!parsed) continue;
    const dedupeKey = `${parsed.username}:${parsed.password}@${parsed.host.toLowerCase()}:${parsed.port}`;
    if (unique.has(dedupeKey)) continue;
    unique.add(dedupeKey);
    configs.push(parsed);
  }
  return configs;
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
): Promise<ProxyFetchResult> {
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
    const hostHeader = url.port &&
      !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))
      ? `${url.hostname}:${url.port}`
      : url.hostname;
    let httpReq = `GET ${targetUrl} HTTP/1.1\r\n`;
    httpReq += `Host: ${hostHeader}\r\n`;
    httpReq += `Proxy-Authorization: Basic ${authBase64}\r\n`;
    for (const [key, val] of Object.entries(headers)) {
      assertValidProxyHeader(key, val);
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
    if (!statusMatch) {
      throw new Error("Invalid HTTP status line from proxy");
    }
    const status = parseInt(statusMatch[1], 10);

    const respHeaders: Record<string, string> = {};
    for (const line of headerLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        respHeaders[line.slice(0, colonIdx).trim().toLowerCase()] =
          line.slice(colonIdx + 1).trim();
      }
    }

    // Handle chunked transfer encoding
    if (respHeaders["transfer-encoding"]?.toLowerCase().includes("chunked")) {
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

/**
 * Try multiple proxies and header variants until one attempt is accepted.
 * This is useful for anti-bot scenarios where a single proxy+UA pair may fail.
 */
export async function fetchViaProxyPool(
  targetUrl: string,
  proxies: ProxyConfig[],
  variants: ProxyHeaderVariant[],
  options: ProxyPoolOptions = {},
): Promise<ProxyPoolResult> {
  if (proxies.length === 0) {
    throw new Error("Proxy pool is empty.");
  }
  const normalizedVariants = variants.length > 0
    ? variants
    : [{ name: "default", headers: {} }];

  const errors: string[] = [];
  let attempts = 0;

  for (let proxyIndex = 0; proxyIndex < proxies.length; proxyIndex++) {
    const proxy = proxies[proxyIndex];
    for (const variant of normalizedVariants) {
      attempts += 1;
      try {
        const result = await fetchViaProxy(
          targetUrl,
          proxy,
          variant.headers,
          options.timeoutMs ?? 20_000,
          options.signal,
        );
        const accepted = options.acceptResult
          ? await options.acceptResult(result, {
            proxyIndex,
            variant: variant.name,
            attempts,
          })
          : result.status >= 200 && result.status < 400;
        if (accepted) {
          return {
            ...result,
            proxyIndex,
            proxy,
            variant: variant.name,
            attempts,
            errors,
          };
        }
        errors.push(
          `proxy[${proxyIndex}]/${variant.name}: rejected status=${result.status} body_bytes=${result.body.length}`,
        );
      } catch (error) {
        errors.push(
          `proxy[${proxyIndex}]/${variant.name}: ${errorMessage(error)}`,
        );
      }
    }
  }

  throw new Error(
    `All proxy attempts failed (${attempts} attempts): ${errors.join(" | ")}`,
  );
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
  let sawTerminator = false;

  while (pos < raw.length) {
    const lineEnd = indexOfBytes(raw, CRLF_BYTES, pos); // \r\n
    if (lineEnd < 0) {
      throw new Error("Invalid chunked encoding: missing chunk size line terminator");
    }
    const sizeLine = lineDecoder.decode(raw.subarray(pos, lineEnd)).trim();
    const sizeToken = sizeLine.split(";", 1)[0];
    if (!/^[0-9a-f]+$/i.test(sizeToken)) {
      throw new Error("Invalid chunked encoding: non-hex chunk size");
    }
    const size = parseInt(sizeToken, 16);
    if (size === 0) {
      let trailerPos = lineEnd + 2;
      while (true) {
        const trailerLineEnd = indexOfBytes(raw, CRLF_BYTES, trailerPos);
        if (trailerLineEnd < 0) {
          throw new Error("Invalid chunked encoding: missing terminating trailer end");
        }
        if (trailerLineEnd === trailerPos) {
          if (trailerLineEnd + 2 !== raw.length) {
            throw new Error("Invalid chunked encoding: unexpected bytes after terminating chunk");
          }
          break;
        }
        const trailerLine = lineDecoder.decode(raw.subarray(trailerPos, trailerLineEnd));
        if (!trailerLine.includes(":")) {
          throw new Error("Invalid chunked encoding: malformed trailer line");
        }
        trailerPos = trailerLineEnd + 2;
      }
      sawTerminator = true;
      break;
    }
    const chunkStart = lineEnd + 2;
    const chunkEnd = chunkStart + size;
    if (chunkEnd > raw.length) {
      throw new Error("Invalid chunked encoding: truncated chunk body");
    }
    if (
      chunkEnd + 1 >= raw.length ||
      raw[chunkEnd] !== 13 ||
      raw[chunkEnd + 1] !== 10
    ) {
      throw new Error("Invalid chunked encoding: missing chunk terminator");
    }
    const chunk = raw.subarray(chunkStart, chunkEnd);
    chunks.push(chunk);
    total += chunk.byteLength;
    pos = chunkEnd + 2; // skip trailing \r\n
  }

  if (!sawTerminator) {
    throw new Error("Invalid chunked encoding: missing terminating chunk");
  }

  return concatUint8Arrays(chunks, total);
}
