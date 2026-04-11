/**
 * Session management (D1-backed).
 *
 *   Login ──▶ generate random token ──▶ sha256 hash ──▶ store in D1
 *                                                    │
 *                                                    ▼
 *                                  Set-Cookie: session=<token> (HttpOnly, Secure, SameSite=Lax)
 *
 *   Request ──▶ parse cookie ──▶ sha256 hash ──▶ D1 lookup
 *                                             │
 *                                             ▼
 *                                      return SessionContext
 *
 * Session tokens are NEVER stored in plaintext. The plaintext token is only
 * in the cookie; D1 only stores the hash. If D1 leaks, sessions aren't compromised.
 */

import type { Env } from "../types";
import { sha256Hex } from "../helpers/crypto";

export const SESSION_TTL_DAYS = 7;
export const SESSION_COOKIE_NAME = "md_session";

export interface SessionContext {
  sessionId: string;
  accountId: string;
  email: string;
  tier: "free" | "pro" | "enterprise";
  githubId: string | null;
}

/** Generate a cryptographically random session token (32 bytes, base64url). */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

/**
 * Create a new session, store hashed token in D1, return the plaintext token
 * (to be set as a cookie — never persisted anywhere else).
 */
export async function createSession(
  env: Env,
  accountId: string,
): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  if (!env.AUTH_DB) throw new Error("AUTH_DB not configured");

  const token = generateSessionToken();
  const tokenHash = await sha256Hex(token);
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await env.AUTH_DB.prepare(`
    INSERT INTO sessions (id, account_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    sessionId,
    accountId,
    tokenHash,
    expiresAt.toISOString(),
    now.toISOString(),
  ).run();

  return { token, sessionId, expiresAt: expiresAt.toISOString() };
}

/**
 * Resolve session from request cookie. Returns null if not present,
 * not found, or expired.
 */
export async function resolveSession(
  request: Request,
  env: Env,
): Promise<SessionContext | null> {
  if (!env.AUTH_DB) return null;

  const token = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);

  try {
    const row = await env.AUTH_DB.prepare(`
      SELECT s.id AS session_id, s.account_id, s.expires_at,
             a.email, a.tier, a.github_id
      FROM sessions s
      JOIN accounts a ON s.account_id = a.id
      WHERE s.token_hash = ?
      LIMIT 1
    `).bind(tokenHash).first<{
      session_id: string;
      account_id: string;
      expires_at: string;
      email: string;
      tier: string;
      github_id: string | null;
    }>();

    if (!row) return null;

    // Check expiration
    if (new Date(row.expires_at) < new Date()) {
      // Fire-and-forget cleanup
      env.AUTH_DB.prepare("DELETE FROM sessions WHERE id = ?")
        .bind(row.session_id)
        .run()
        .catch(() => {});
      return null;
    }

    const tier = (row.tier === "pro" ? "pro" : row.tier === "enterprise" ? "enterprise" : "free") as SessionContext["tier"];
    return {
      sessionId: row.session_id,
      accountId: row.account_id,
      email: row.email,
      tier,
      githubId: row.github_id,
    };
  } catch (err) {
    console.error("Session lookup failed:", err);
    return null;
  }
}

/** Delete a session (logout) */
export async function destroySession(
  env: Env,
  sessionId: string,
): Promise<void> {
  if (!env.AUTH_DB) return;
  await env.AUTH_DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(sessionId)
    .run()
    .catch((err) => console.error("Session delete failed:", err));
}

/** Build Set-Cookie header for a new session */
export function buildSessionCookie(token: string, expiresAt: string, secure = true): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=/`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Build Set-Cookie header that clears the session cookie */
export function buildClearCookie(secure = true): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=/`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
