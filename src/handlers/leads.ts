import type { Env } from "../types";
import { CORS_HEADERS } from "../config";
import { bumpLimit } from "../middleware/rate-limit-d1";
import { sendEmail } from "../helpers/email";

/** Pricing-page plans and monthly volumes the form offers; anything else is stored as "". */
export const LEAD_PLANS = ["pro", "enterprise"] as const;
export const LEAD_VOLUMES = ["<10k", "10k-100k", "100k-1m", ">1m"] as const;

const MAX_BODY_BYTES = 8 * 1024;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IP_LIMIT_PER_HOUR = 5;
const EMAIL_LIMIT_PER_DAY = 3;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function field(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\0\r]/g, "").trim().slice(0, max);
}

/** POST /api/leads: store a pricing contact request and email it to ADMIN_EMAIL. */
export async function handleLead(request: Request, env: Env): Promise<Response> {
  if (!env.AUTH_DB) return json({ error: "Service Unavailable" }, 503);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  // Hidden field a person never fills in. Answer as if accepted so bots learn nothing.
  if (field(body.website, 200)) return json({ ok: true });

  const email = field(body.email, 254).toLowerCase();
  if (!EMAIL_REGEX.test(email) || /\s/.test(email)) return json({ error: "Invalid email address" }, 400);
  const plan = (LEAD_PLANS as readonly string[]).includes(String(body.plan)) ? String(body.plan) : "";
  const volume = (LEAD_VOLUMES as readonly string[]).includes(String(body.volume)) ? String(body.volume) : "";
  const lead = {
    email,
    name: field(body.name, 120).replace(/\n/g, " "),
    company: field(body.company, 160).replace(/\n/g, " "),
    plan,
    volume,
    message: field(body.message, 2000),
    lang: body.lang === "zh" ? "zh" : "en",
  };

  const ip = (request.headers.get("cf-connecting-ip") || "").trim().slice(0, 64);
  const [ipLimit, emailLimit] = await Promise.all([
    bumpLimit(env, `lead:ip:${ip || "unknown"}`, IP_LIMIT_PER_HOUR, 3600),
    bumpLimit(env, `lead:email:${email}`, EMAIL_LIMIT_PER_DAY, 86_400),
  ]);
  if (ipLimit.blocked || emailLimit.blocked) {
    return json({ error: "Too Many Requests", message: "Too many requests. Email us directly instead." }, 429);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const country = String((request as Request & { cf?: { country?: unknown } }).cf?.country || "").slice(0, 8);
  try {
    await env.AUTH_DB.prepare(`
      INSERT INTO leads (id, created_at, email, name, company, plan, volume, message, lang, client_ip, country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, createdAt, lead.email, lead.name, lead.company, lead.plan, lead.volume, lead.message, lead.lang, ip, country).run();
  } catch (error) {
    console.error("lead insert failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Internal Error" }, 500);
  }

  if (env.EMAIL && env.ADMIN_EMAIL) {
    try {
      const lines = [
        `Email: ${lead.email}`,
        `Name: ${lead.name || "-"}`,
        `Company: ${lead.company || "-"}`,
        `Plan: ${lead.plan || "-"}`,
        `Monthly volume: ${lead.volume || "-"}`,
        `Language: ${lead.lang}`,
        `Country: ${country || "-"}`,
        `Time: ${createdAt}`,
        "",
        lead.message || "(no message)",
      ];
      await sendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: `[mdget.dev] Pricing lead: ${lead.company || lead.email}${lead.plan ? ` (${lead.plan})` : ""}`,
        text: lines.join("\n"),
      });
      await env.AUTH_DB.prepare("UPDATE leads SET emailed = 1 WHERE id = ?").bind(id).run();
    } catch (error) {
      // The lead is already stored; a failed email must not fail the form.
      console.error("lead email failed:", error instanceof Error ? error.message : "unknown");
    }
  } else {
    console.warn("Lead email skipped: configure the EMAIL binding and the ADMIN_EMAIL secret.");
  }
  return json({ ok: true });
}
