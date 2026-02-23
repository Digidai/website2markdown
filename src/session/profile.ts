import type { Env } from "../types";

const SESSION_PROFILE_KEY_PREFIX = "session:profile:v1:";
const SESSION_PROFILE_DEFAULT_TTL_SECONDS = 86_400 * 7;
const SESSION_FAILURE_THRESHOLD = 3;
const SESSION_DISABLE_SECONDS = 15 * 60;
const SESSION_MAX_COOKIES = 200;
const SESSION_MAX_LOCAL_STORAGE_ITEMS = 200;
const SESSION_MAX_LOCAL_STORAGE_VALUE_BYTES = 4096;

export type SessionCookieSameSite = "Strict" | "Lax" | "None";

export interface SessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SessionCookieSameSite;
}

export interface SessionProfileSnapshot {
  cookies: SessionCookie[];
  localStorage: Record<string, string>;
}

export interface SessionProfile {
  version: number;
  host: string;
  cookies: SessionCookie[];
  localStorage: Record<string, string>;
  failureCount: number;
  disabledUntil?: string;
  createdAt: string;
  updatedAt: string;
}

function profileHostFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function profileOriginFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeSameSite(value: unknown): SessionCookieSameSite | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "strict") return "Strict";
  if (normalized === "lax") return "Lax";
  if (normalized === "none") return "None";
  return undefined;
}

function normalizeCookie(raw: unknown): SessionCookie | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.value !== "string") {
    return null;
  }

  const cookie: SessionCookie = {
    name: item.name,
    value: item.value,
  };

  if (typeof item.domain === "string" && item.domain.trim()) {
    cookie.domain = item.domain.trim().toLowerCase();
  }
  if (typeof item.path === "string" && item.path.trim()) {
    cookie.path = item.path.trim();
  }
  if (typeof item.expires === "number" && Number.isFinite(item.expires)) {
    cookie.expires = item.expires;
  }
  if (typeof item.httpOnly === "boolean") {
    cookie.httpOnly = item.httpOnly;
  }
  if (typeof item.secure === "boolean") {
    cookie.secure = item.secure;
  }
  const sameSite = normalizeSameSite(item.sameSite);
  if (sameSite) {
    cookie.sameSite = sameSite;
  }

  return cookie;
}

function normalizeLocalStorageValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= SESSION_MAX_LOCAL_STORAGE_VALUE_BYTES) {
    return value;
  }
  const truncated = bytes.slice(0, SESSION_MAX_LOCAL_STORAGE_VALUE_BYTES);
  return new TextDecoder().decode(truncated);
}

function normalizeSnapshot(snapshot: SessionProfileSnapshot): SessionProfileSnapshot {
  const normalizedCookies = snapshot.cookies
    .map((cookie) => normalizeCookie(cookie))
    .filter((cookie): cookie is SessionCookie => cookie !== null)
    .slice(0, SESSION_MAX_COOKIES);

  const localStorageEntries = Object.entries(snapshot.localStorage || {})
    .filter(([key, value]) => typeof key === "string" && typeof value === "string")
    .slice(0, SESSION_MAX_LOCAL_STORAGE_ITEMS)
    .map(([key, value]) => [key, normalizeLocalStorageValue(value)] as const);

  return {
    cookies: normalizedCookies,
    localStorage: Object.fromEntries(localStorageEntries),
  };
}

export function sessionProfileKey(url: string): string | null {
  const host = profileHostFromUrl(url);
  if (!host) return null;
  return `${SESSION_PROFILE_KEY_PREFIX}${host}`;
}

function isSessionProfileDisabled(profile: SessionProfile, nowMs: number = Date.now()): boolean {
  if (!profile.disabledUntil) return false;
  const until = Date.parse(profile.disabledUntil);
  if (!Number.isFinite(until)) return false;
  return until > nowMs;
}

function parseProfile(raw: string): SessionProfile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SessionProfile>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.host !== "string" || !parsed.host.trim()) return null;

    const cookies = Array.isArray(parsed.cookies)
      ? parsed.cookies
        .map((cookie) => normalizeCookie(cookie))
        .filter((cookie): cookie is SessionCookie => cookie !== null)
        .slice(0, SESSION_MAX_COOKIES)
      : [];

    const localStorage = parsed.localStorage && typeof parsed.localStorage === "object"
      ? Object.fromEntries(
        Object.entries(parsed.localStorage as Record<string, unknown>)
          .filter(([key, value]) => typeof key === "string" && typeof value === "string")
          .slice(0, SESSION_MAX_LOCAL_STORAGE_ITEMS)
          .map(([key, value]) => [key, normalizeLocalStorageValue(value as string)]),
      )
      : {};

    return {
      version: Number(parsed.version) || 1,
      host: parsed.host,
      cookies,
      localStorage,
      failureCount: Math.max(0, Number(parsed.failureCount) || 0),
      disabledUntil: typeof parsed.disabledUntil === "string"
        ? parsed.disabledUntil
        : undefined,
      createdAt: typeof parsed.createdAt === "string"
        ? parsed.createdAt
        : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string"
        ? parsed.updatedAt
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function loadRawSessionProfile(env: Env, url: string): Promise<SessionProfile | null> {
  const key = sessionProfileKey(url);
  if (!key) return null;
  const raw = await env.CACHE_KV.get(key, "text");
  if (!raw) return null;
  return parseProfile(raw);
}

async function putSessionProfile(
  env: Env,
  url: string,
  profile: SessionProfile,
  ttlSeconds: number,
): Promise<void> {
  const key = sessionProfileKey(url);
  if (!key) return;
  await env.CACHE_KV.put(
    key,
    JSON.stringify(profile),
    {
      expirationTtl: Math.max(60, Math.floor(ttlSeconds)),
    },
  );
}

export async function loadSessionProfile(
  env: Env,
  url: string,
): Promise<SessionProfile | null> {
  const profile = await loadRawSessionProfile(env, url);
  if (!profile) return null;
  if (isSessionProfileDisabled(profile)) {
    return null;
  }
  return profile;
}

export async function applySessionProfileToPage(
  page: any,
  url: string,
  profile: SessionProfile | null,
): Promise<boolean> {
  if (!profile) return false;

  const origin = profileOriginFromUrl(url);
  if (!origin) return false;

  const hasCookies = profile.cookies.length > 0;
  const hasLocalStorage = Object.keys(profile.localStorage).length > 0;
  if (!hasCookies && !hasLocalStorage) return false;

  if (hasCookies && typeof page.setCookie === "function") {
    const cookieInputs = profile.cookies.map((cookie) => {
      const base: Record<string, unknown> = {
        name: cookie.name,
        value: cookie.value,
      };
      if (cookie.domain) {
        base.domain = cookie.domain;
      } else {
        base.url = origin;
      }
      if (cookie.path) base.path = cookie.path;
      if (typeof cookie.expires === "number" && Number.isFinite(cookie.expires)) {
        base.expires = cookie.expires;
      }
      if (typeof cookie.httpOnly === "boolean") base.httpOnly = cookie.httpOnly;
      if (typeof cookie.secure === "boolean") base.secure = cookie.secure;
      if (cookie.sameSite) base.sameSite = cookie.sameSite;
      return base;
    });
    if (cookieInputs.length > 0) {
      await page.setCookie(...cookieInputs);
    }
  }

  if (hasLocalStorage && typeof page.evaluateOnNewDocument === "function") {
    const serialized = JSON.stringify(profile.localStorage);
    await page.evaluateOnNewDocument(`
      (() => {
        try {
          const data = ${serialized};
          for (const key of Object.keys(data)) {
            window.localStorage.setItem(key, String(data[key]));
          }
        } catch {}
      })();
    `);
  }

  return true;
}

export async function captureSessionProfileSnapshotFromPage(
  page: any,
): Promise<SessionProfileSnapshot> {
  let cookies: SessionCookie[] = [];
  if (typeof page.cookies === "function") {
    try {
      const rawCookies = await page.cookies();
      if (Array.isArray(rawCookies)) {
        cookies = rawCookies
          .map((cookie) => normalizeCookie(cookie))
          .filter((cookie): cookie is SessionCookie => cookie !== null)
          .slice(0, SESSION_MAX_COOKIES);
      }
    } catch {
      // Ignore cookie read failures.
    }
  }

  let localStorage: Record<string, string> = {};
  if (typeof page.evaluate === "function") {
    try {
      const rawStorage = await page.evaluate(`
        (() => {
          try {
            const out = {};
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (!key) continue;
              const value = window.localStorage.getItem(key);
              if (typeof value === "string") {
                out[key] = value;
              }
            }
            return out;
          } catch {
            return {};
          }
        })();
      `);
      if (rawStorage && typeof rawStorage === "object") {
        localStorage = Object.fromEntries(
          Object.entries(rawStorage as Record<string, unknown>)
            .filter(([key, value]) => typeof key === "string" && typeof value === "string")
            .slice(0, SESSION_MAX_LOCAL_STORAGE_ITEMS)
            .map(([key, value]) => [key, normalizeLocalStorageValue(value as string)]),
        );
      }
    } catch {
      // Ignore localStorage read failures.
    }
  }

  return normalizeSnapshot({
    cookies,
    localStorage,
  });
}

export async function saveSessionProfileSnapshot(
  env: Env,
  url: string,
  snapshot: SessionProfileSnapshot,
  ttlSeconds: number = SESSION_PROFILE_DEFAULT_TTL_SECONDS,
): Promise<SessionProfile | null> {
  const host = profileHostFromUrl(url);
  if (!host) return null;

  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const existing = await loadRawSessionProfile(env, url);
  const now = new Date().toISOString();

  const profile: SessionProfile = {
    version: 1,
    host,
    cookies: normalizedSnapshot.cookies,
    localStorage: normalizedSnapshot.localStorage,
    failureCount: 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await putSessionProfile(env, url, profile, ttlSeconds);
  return profile;
}

export async function markSessionProfileFailure(env: Env, url: string): Promise<void> {
  const host = profileHostFromUrl(url);
  if (!host) return;

  const existing = await loadRawSessionProfile(env, url);
  if (!existing) return;

  const nowMs = Date.now();
  const nextFailureCount = Math.max(0, existing.failureCount) + 1;
  const nowIso = new Date(nowMs).toISOString();

  const updated: SessionProfile = {
    ...existing,
    failureCount: nextFailureCount,
    updatedAt: nowIso,
  };

  if (nextFailureCount >= SESSION_FAILURE_THRESHOLD) {
    updated.failureCount = 0;
    updated.disabledUntil = new Date(nowMs + SESSION_DISABLE_SECONDS * 1000).toISOString();
  }

  await putSessionProfile(env, url, updated, SESSION_PROFILE_DEFAULT_TTL_SECONDS);
}

export async function clearSessionProfileFailure(env: Env, url: string): Promise<void> {
  const existing = await loadRawSessionProfile(env, url);
  if (!existing) return;

  const updated: SessionProfile = {
    ...existing,
    failureCount: 0,
    updatedAt: new Date().toISOString(),
  };
  delete updated.disabledUntil;
  await putSessionProfile(env, url, updated, SESSION_PROFILE_DEFAULT_TTL_SECONDS);
}

const SESSION_EXPIRED_HTML_HINTS = [
  "sign in",
  "log in",
  "login",
  "please login",
  "verify you are human",
  "access denied",
  "session expired",
  "验证码",
  "登录",
  "重新登录",
];

export function isLikelySessionExpiredHtml(html: string): boolean {
  const normalized = html.toLowerCase();
  let hits = 0;
  for (const hint of SESSION_EXPIRED_HTML_HINTS) {
    if (normalized.includes(hint)) {
      hits += 1;
      if (hits >= 2) {
        return true;
      }
    }
  }
  return false;
}
