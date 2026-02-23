const PROXY_RETRY_TOKEN_PREFIX = "PROXY_RETRY_TOKEN:";
const PROXY_RETRY_LEGACY_PREFIX = "PROXY_RETRY:";
const PROXY_RETRY_STORE_TTL_MS = 2 * 60 * 1000;
const PROXY_RETRY_STORE_MAX_ENTRIES = 256;

interface ProxyRetryStoreEntry {
  cookieHeader: string;
  createdAt: number;
  expiresAt: number;
}

const proxyRetryStore = new Map<string, ProxyRetryStoreEntry>();

function pruneProxyRetryStore(nowMs: number = Date.now()): void {
  for (const [token, entry] of proxyRetryStore) {
    if (entry.expiresAt <= nowMs) {
      proxyRetryStore.delete(token);
    }
  }
  if (proxyRetryStore.size <= PROXY_RETRY_STORE_MAX_ENTRIES) {
    return;
  }

  const sortedByOldest = [...proxyRetryStore.entries()].sort(
    (a, b) =>
      a[1].createdAt - b[1].createdAt ||
      a[1].expiresAt - b[1].expiresAt,
  );
  const overflow = sortedByOldest.length - PROXY_RETRY_STORE_MAX_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    proxyRetryStore.delete(sortedByOldest[i][0]);
  }
}

function generateRetryToken(nowMs: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${nowMs}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeCookieHeader(
  cookies: Array<{ name?: unknown; value?: unknown }>,
): string {
  return cookies
    .filter((item) => typeof item.name === "string" && typeof item.value === "string")
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

export function createProxyRetrySignal(
  cookies: Array<{ name?: unknown; value?: unknown }>,
): string | null {
  const cookieHeader = normalizeCookieHeader(cookies);
  if (!cookieHeader) {
    return null;
  }
  const nowMs = Date.now();
  pruneProxyRetryStore(nowMs);
  const token = generateRetryToken(nowMs);
  proxyRetryStore.set(token, {
    cookieHeader,
    createdAt: nowMs,
    expiresAt: nowMs + PROXY_RETRY_STORE_TTL_MS,
  });
  return `${PROXY_RETRY_TOKEN_PREFIX}${token}`;
}

export function extractProxyRetryToken(message: string): string | null {
  const match = message.match(/PROXY_RETRY_TOKEN:([A-Za-z0-9._-]+)/);
  return match?.[1] || null;
}

export function consumeProxyRetryCookies(token: string): string | null {
  pruneProxyRetryStore();
  const entry = proxyRetryStore.get(token);
  if (!entry) {
    return null;
  }
  proxyRetryStore.delete(token);
  if (entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.cookieHeader;
}

export function extractLegacyProxyRetryCookies(message: string): string | null {
  const markerIndex = message.indexOf(PROXY_RETRY_LEGACY_PREFIX);
  if (markerIndex < 0) {
    return null;
  }
  const raw = message.slice(markerIndex + PROXY_RETRY_LEGACY_PREFIX.length)
    .replace(/^(Browser rendering failed:\s*)+/, "")
    .trim();
  if (!raw || raw.startsWith("<redacted>")) {
    return null;
  }
  return raw;
}

export function redactLegacyProxyRetryMessage(message: string): string {
  const markerIndex = message.indexOf(PROXY_RETRY_LEGACY_PREFIX);
  if (markerIndex < 0) {
    return message;
  }
  return `${message.slice(0, markerIndex + PROXY_RETRY_LEGACY_PREFIX.length)}<redacted>`;
}
