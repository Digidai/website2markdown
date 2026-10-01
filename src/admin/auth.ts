import type { Env } from "../types";
import { bumpLimit } from "../middleware/rate-limit-d1";

const COOKIE = "md_admin";
const SESSION_SECONDS = 60 * 60 * 12;

export function adminPassphrase(env: Env): string {
  return env.ADMIN_PASSWORD?.trim() || "";
}

export async function passwordMatches(env: Env, input: string): Promise<boolean> {
  const expectedText = adminPassphrase(env);
  if (!expectedText || !input) return false;
  const enc = new TextEncoder();
  const [got, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(expectedText)),
  ]);
  const a = new Uint8Array(got);
  const b = new Uint8Array(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function adminLoginAllowed(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const result = await bumpLimit(env, `admin-login:${ip}`, 8, 15 * 60);
  return !result.blocked;
}

export async function createAdminCookie(env: Env): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const sig = await sign(env, String(exp));
  return `${COOKIE}=${exp}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=${SESSION_SECONDS}`;
}

export function clearAdminCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=0`;
}

export async function hasAdminSession(env: Env, request: Request): Promise<boolean> {
  if (!adminPassphrase(env)) return false;
  const raw = readCookie(request, COOKIE);
  if (!raw) return false;
  const dot = raw.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(raw.slice(0, dot));
  const sig = raw.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(env, String(exp));
  return timingEqual(sig, expected);
}

async function sign(env: Env, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(adminPassphrase(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64Url(new Uint8Array(mac));
}

function readCookie(request: Request, name: string): string {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}
