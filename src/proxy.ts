import { connect } from "cloudflare:sockets";

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
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
    return {
      host,
      port: parseInt(portStr, 10),
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
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const url = new URL(targetUrl);

  // Connect to proxy over plain TCP
  const socket = connect(
    { hostname: proxy.host, port: proxy.port },
    { secureTransport: "off", allowHalfOpen: false },
  );

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

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
  await writer.write(encoder.encode(httpReq));

  // Read response with timeout
  let rawResponse = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    rawResponse += decoder.decode(value, { stream: true });
  }

  // Parse HTTP response
  const headerEnd = rawResponse.indexOf("\r\n\r\n");
  if (headerEnd < 0) throw new Error("Invalid HTTP response from proxy");

  const headerSection = rawResponse.slice(0, headerEnd);
  let body = rawResponse.slice(headerEnd + 4);
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
    body = decodeChunked(body);
  }

  // Clean up
  try { writer.releaseLock(); } catch {}
  try { reader.releaseLock(); } catch {}
  try { socket.close(); } catch {}

  return { status, headers: respHeaders, body };
}

/** Decode chunked transfer encoding. */
function decodeChunked(raw: string): string {
  let result = "";
  let pos = 0;
  while (pos < raw.length) {
    const lineEnd = raw.indexOf("\r\n", pos);
    if (lineEnd < 0) break;
    const sizeStr = raw.slice(pos, lineEnd).trim();
    const size = parseInt(sizeStr, 16);
    if (isNaN(size) || size === 0) break;
    const chunkStart = lineEnd + 2;
    result += raw.slice(chunkStart, chunkStart + size);
    pos = chunkStart + size + 2; // skip chunk data + \r\n
  }
  return result;
}
