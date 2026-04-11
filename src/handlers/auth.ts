/**
 * Portal authentication — Magic Link (passwordless email) flow.
 *
 *   POST /api/auth/magic-link
 *        body: { email }
 *        → Creates magic_link_tokens row, sends email via Resend.
 *        Always returns 200 (does NOT reveal if email is registered).
 *
 *   GET /api/auth/verify?token=<token>
 *        → Validates token, finds/creates account, creates session,
 *          sets cookie, redirects to /portal/.
 *
 *   POST /api/auth/logout
 *        → Destroys session, clears cookie.
 *
 * Security:
 *  - Magic link tokens stored as SHA-256 hash (never plaintext in D1)
 *  - 15-minute token TTL
 *  - Single-use (marked with used_at after verification)
 *  - Per-email rate limit (3 requests per hour via Cache API)
 */

import type { Env } from "../types";
import { sha256Hex } from "../helpers/crypto";
import { CORS_HEADERS } from "../config";
import {
  buildClearCookie,
  buildSessionCookie,
  createSession,
  destroySession,
  resolveSession,
  SESSION_COOKIE_NAME,
} from "../middleware/session";

const TOKEN_TTL_MINUTES = 15;
const EMAIL_RATE_LIMIT_PER_HOUR = 3;
const IP_RATE_LIMIT_PER_HOUR = 10;  // Per-IP cap to prevent cross-email abuse
const MAX_BODY_BYTES = 1024;         // Reject oversized magic-link request bodies
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

/**
 * Increment a Cache-API-backed counter at `key` with `ttlSeconds` expiry.
 * Returns the new count. Non-atomic across isolates but good enough for
 * abuse prevention (a distributed attacker can still trivially stay under
 * the limit across isolates; this mostly prevents single-source bursts).
 */
async function incrementRateCounter(key: string, ttlSeconds: number): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const req = new Request(key);
    const existing = await caches.default.match(req);
    const current = existing ? Number(await existing.text()) || 0 : 0;
    const next = current + 1;
    await caches.default.put(req, new Response(String(next), {
      headers: { "Cache-Control": `max-age=${ttlSeconds}` },
    }));
    return next;
  } catch {
    return 0;
  }
}

async function readRateCounter(key: string): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const existing = await caches.default.match(new Request(key));
    if (!existing) return 0;
    return Number(await existing.text()) || 0;
  } catch {
    return 0;
  }
}

function getClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

// ─── POST /api/auth/magic-link ──────────────────────────────

export async function handleSendMagicLink(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  if (!env.AUTH_DB) {
    return Response.json({ error: "Service Unavailable" }, { status: 503, headers: CORS_HEADERS });
  }

  // Body size cap — prevent memory pressure from giant JSON payloads
  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) {
    return Response.json({ error: "Request too large" }, { status: 413, headers: CORS_HEADERS });
  }

  let email: string;
  try {
    const body = JSON.parse(bodyText) as { email?: string };
    email = String(body?.email || "").trim().toLowerCase();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
    return Response.json({ error: "Invalid email address" }, { status: 400, headers: CORS_HEADERS });
  }

  // ── Rate limiting (two-dimensional) ─────────────────────────
  // 1) Per-email cap: prevents mailbox flooding for a specific victim
  // 2) Per-IP cap: prevents a single attacker from burning Resend quota
  //    by rotating across many victim emails
  const emailKey = `https://md-rate-limit/magic-link/email/${encodeURIComponent(email)}`;
  const ip = getClientIp(request);
  const ipKey = `https://md-rate-limit/magic-link/ip/${encodeURIComponent(ip)}`;

  const [emailCount, ipCount] = await Promise.all([
    readRateCounter(emailKey),
    readRateCounter(ipKey),
  ]);

  // Silently 200 on rate limit (don't reveal which dimension tripped)
  if (emailCount >= EMAIL_RATE_LIMIT_PER_HOUR || ipCount >= IP_RATE_LIMIT_PER_HOUR) {
    return Response.json(
      { ok: true, note: "If an account exists, an email was sent." },
      { status: 200, headers: CORS_HEADERS },
    );
  }

  // Generate random token (plaintext goes in email, hash goes in D1)
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const tokenHash = await sha256Hex(token);
  const tokenId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000);

  try {
    await env.AUTH_DB.prepare(`
      INSERT INTO magic_link_tokens (id, email, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      tokenId,
      email,
      tokenHash,
      expiresAt.toISOString(),
      now.toISOString(),
    ).run();
  } catch (err) {
    console.error("Magic link insert failed:", err);
    return Response.json({ error: "Internal Error" }, { status: 500, headers: CORS_HEADERS });
  }

  // Send email via Resend (if configured)
  const verifyUrl = `https://${host}/api/auth/verify?token=${token}`;
  if (env.RESEND_API_KEY) {
    try {
      await sendMagicLinkEmail(env, email, verifyUrl);
    } catch (err) {
      console.error("Resend send failed:", err);
      // Don't leak the error to the client, but log it
    }
  } else {
    console.warn("RESEND_API_KEY not configured — magic link logged only:", verifyUrl);
  }

  // Increment both rate limit counters (1-hour TTL)
  const ONE_HOUR = 60 * 60;
  try {
    await Promise.all([
      incrementRateCounter(emailKey, ONE_HOUR),
      incrementRateCounter(ipKey, ONE_HOUR),
    ]);
  } catch { /* ignore */
  }

  return Response.json({
    ok: true,
    note: "If an account exists, an email was sent. Check your inbox.",
  }, { status: 200, headers: CORS_HEADERS });
}

// ─── Resend email helper ────────────────────────────────────

async function sendMagicLinkEmail(env: Env, email: string, verifyUrl: string): Promise<void> {
  const from = env.AUTH_EMAIL_FROM || "md.genedai.me <noreply@mail.genedai.me>";
  const subject = "Sign in to md.genedai.me";
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, system-ui, sans-serif; background: #f7f7f4; color: #26251e; padding: 40px 20px; margin: 0;">
  <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 4px; padding: 40px 32px; border: 1px solid rgba(0,0,0,0.06);">
    <h1 style="font-family: Georgia, serif; font-size: 24px; margin: 0 0 16px; font-weight: normal;">
      Sign in to <em>md.genedai.me</em>
    </h1>
    <p style="font-size: 15px; line-height: 1.6; color: rgba(38,37,30,0.7); margin: 0 0 24px;">
      Click the button below to sign in to your Developer Portal. This link expires in 15 minutes.
    </p>
    <a href="${verifyUrl}" style="display: inline-block; background: #22d3ee; color: #0e7490; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: 500; font-size: 15px;">
      Sign in &rarr;
    </a>
    <p style="font-size: 13px; color: rgba(38,37,30,0.45); margin: 32px 0 0;">
      If you didn't request this, you can ignore this email. Someone may have typed your address by mistake.
    </p>
    <p style="font-size: 13px; color: rgba(38,37,30,0.45); margin: 16px 0 0; word-break: break-all;">
      Or copy this link: ${verifyUrl}
    </p>
  </div>
</body>
</html>`.trim();
  const text = `Sign in to md.genedai.me\n\nClick this link to sign in to your Developer Portal:\n${verifyUrl}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: email, subject, html, text }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Resend API ${resp.status}: ${errBody}`);
  }
}

// ─── GET /api/auth/verify?token=xxx ─────────────────────────

export async function handleVerifyMagicLink(
  request: Request,
  env: Env,
  host: string,
): Promise<Response> {
  if (!env.AUTH_DB) {
    return Response.redirect(`https://${host}/portal/?error=service_unavailable`, 302);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return Response.redirect(`https://${host}/portal/?error=invalid_token`, 302);
  }

  const tokenHash = await sha256Hex(token);
  const now = new Date();

  try {
    const row = await env.AUTH_DB.prepare(`
      SELECT id, email, expires_at, used_at
      FROM magic_link_tokens
      WHERE token_hash = ?
      LIMIT 1
    `).bind(tokenHash).first<{
      id: string;
      email: string;
      expires_at: string;
      used_at: string | null;
    }>();

    if (!row) {
      return Response.redirect(`https://${host}/portal/?error=invalid_token`, 302);
    }
    if (row.used_at) {
      return Response.redirect(`https://${host}/portal/?error=link_already_used`, 302);
    }
    if (new Date(row.expires_at) < now) {
      return Response.redirect(`https://${host}/portal/?error=link_expired`, 302);
    }

    // Mark token as used (single-use)
    await env.AUTH_DB.prepare(
      `UPDATE magic_link_tokens SET used_at = ? WHERE id = ?`
    ).bind(now.toISOString(), row.id).run();

    // Find or create account
    const email = row.email;
    let account = await env.AUTH_DB.prepare(
      `SELECT id FROM accounts WHERE email = ? LIMIT 1`
    ).bind(email).first<{ id: string }>();

    let accountId: string;
    if (account) {
      accountId = account.id;
    } else {
      accountId = crypto.randomUUID();
      const nowIso = now.toISOString();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      await env.AUTH_DB.prepare(`
        INSERT INTO accounts (id, email, tier, monthly_credits_used, monthly_credits_reset_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(accountId, email, "free", 0, nextMonth, nowIso, nowIso).run();
    }

    // Create session
    const { token: sessionToken, expiresAt: sessionExpires } = await createSession(env, accountId);

    // Redirect to portal with session cookie set
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://${host}/portal/`,
        "Set-Cookie": buildSessionCookie(sessionToken, sessionExpires),
        "Cache-Control": "no-store, private",
      },
    });
  } catch (err) {
    console.error("Magic link verify failed:", err);
    return Response.redirect(`https://${host}/portal/?error=internal_error`, 302);
  }
}

// ─── POST /api/auth/logout ──────────────────────────────────

export async function handleLogout(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await resolveSession(request, env);
  if (session) {
    await destroySession(env, session.sessionId);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": buildClearCookie(),
      "Cache-Control": "no-store, private",
      ...CORS_HEADERS,
    },
  });
}
