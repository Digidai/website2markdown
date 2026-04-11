/**
 * API key management endpoints.
 *
 *   POST   /api/keys      — create new key (returns plaintext once)
 *   GET    /api/keys      — list user's keys (prefix only, never plaintext)
 *   DELETE /api/keys/:id  — revoke key
 *
 * All endpoints require a valid session cookie.
 * Keys are stored as SHA-256 hash; plaintext is returned ONLY at creation time.
 */

import type { Env } from "../types";
import type { SessionContext } from "../middleware/session";
import { sha256Hex } from "../helpers/crypto";
import { CORS_HEADERS } from "../config";

const MAX_KEY_NAME_LENGTH = 64;
const MAX_KEYS_PER_ACCOUNT = 10;

interface ApiKeyRow {
  id: string;
  prefix: string;
  name: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Generate a new API key: mk_ + 32 bytes random (hex) */
function generateApiKey(): { full: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const full = `mk_${hex}`;
  const prefix = hex.slice(0, 8);
  return { full, prefix };
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(data, {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders },
  });
}

// ─── POST /api/keys ─────────────────────────────────────────

export async function handleCreateKey(
  request: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  if (!env.AUTH_DB) {
    return jsonResponse({ error: "Service Unavailable" }, 503);
  }

  // Check key count limit
  const countRow = await env.AUTH_DB.prepare(
    `SELECT COUNT(*) AS cnt FROM api_keys WHERE account_id = ? AND revoked_at IS NULL`
  ).bind(session.accountId).first<{ cnt: number }>();

  if ((countRow?.cnt ?? 0) >= MAX_KEYS_PER_ACCOUNT) {
    return jsonResponse({
      error: "Too Many Keys",
      message: `You can have at most ${MAX_KEYS_PER_ACCOUNT} active keys. Revoke an old key first.`,
    }, 400);
  }

  // Parse optional name from body
  let name: string | null = null;
  try {
    const body = await request.json() as { name?: string };
    if (body?.name) {
      const trimmed = String(body.name).trim();
      if (trimmed.length > MAX_KEY_NAME_LENGTH) {
        return jsonResponse({
          error: "Invalid Name",
          message: `Key name must be ${MAX_KEY_NAME_LENGTH} characters or fewer.`,
        }, 400);
      }
      name = trimmed || null;
    }
  } catch {
    // No body or invalid JSON — name is optional
  }

  const { full, prefix } = generateApiKey();
  const keyHash = await sha256Hex(full);
  const keyId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await env.AUTH_DB.prepare(`
      INSERT INTO api_keys (id, account_id, prefix, key_hash, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(keyId, session.accountId, prefix, keyHash, name, now).run();
  } catch (err) {
    console.error("Key creation failed:", err);
    return jsonResponse({ error: "Internal Error", message: "Failed to create key" }, 500);
  }

  // Return plaintext key ONCE — user must save it
  return jsonResponse({
    id: keyId,
    prefix,
    key: full,
    name,
    created_at: now,
    warning: "This is the only time the full key will be shown. Save it securely.",
  }, 201);
}

// ─── GET /api/keys ──────────────────────────────────────────

export async function handleListKeys(
  env: Env,
  session: SessionContext,
): Promise<Response> {
  if (!env.AUTH_DB) {
    return jsonResponse({ error: "Service Unavailable" }, 503);
  }

  try {
    const result = await env.AUTH_DB.prepare(`
      SELECT id, prefix, name, revoked_at, created_at
      FROM api_keys
      WHERE account_id = ?
      ORDER BY created_at DESC
    `).bind(session.accountId).all<ApiKeyRow>();

    const keys = (result.results || []).map((row) => ({
      id: row.id,
      prefix: `mk_${row.prefix}...`,
      name: row.name,
      active: !row.revoked_at,
      revoked_at: row.revoked_at,
      created_at: row.created_at,
    }));

    return jsonResponse({ keys });
  } catch (err) {
    console.error("Key list failed:", err);
    return jsonResponse({ error: "Internal Error" }, 500);
  }
}

// ─── DELETE /api/keys/:id ───────────────────────────────────

export async function handleRevokeKey(
  env: Env,
  session: SessionContext,
  keyId: string,
): Promise<Response> {
  if (!env.AUTH_DB) {
    return jsonResponse({ error: "Service Unavailable" }, 503);
  }

  // Validate key_id is a UUID (prevent injection via path)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keyId)) {
    return jsonResponse({ error: "Invalid Key ID" }, 400);
  }

  try {
    // Verify key belongs to the account before revoking
    const row = await env.AUTH_DB.prepare(
      `SELECT id, revoked_at FROM api_keys WHERE id = ? AND account_id = ?`
    ).bind(keyId, session.accountId).first<{ id: string; revoked_at: string | null }>();

    if (!row) {
      return jsonResponse({ error: "Not Found" }, 404);
    }

    if (row.revoked_at) {
      return jsonResponse({ error: "Already Revoked" }, 400);
    }

    const now = new Date().toISOString();
    await env.AUTH_DB.prepare(
      `UPDATE api_keys SET revoked_at = ? WHERE id = ?`
    ).bind(now, keyId).run();

    return jsonResponse({ id: keyId, revoked_at: now });
  } catch (err) {
    console.error("Key revoke failed:", err);
    return jsonResponse({ error: "Internal Error" }, 500);
  }
}

// ─── GET /api/me ────────────────────────────────────────────

export async function handleMe(session: SessionContext): Promise<Response> {
  return jsonResponse({
    email: session.email,
    tier: session.tier,
    github_linked: !!session.githubId,
    account_id: session.accountId,
  });
}
