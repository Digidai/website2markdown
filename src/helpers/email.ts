import type { Env } from "../types";

/** Sender for sign-in and alert emails. The domain must be onboarded to Cloudflare Email Sending. */
export const DEFAULT_EMAIL_FROM = "mdget.dev <noreply@mdget.dev>";

/** Send through the Cloudflare Email Sending binding. Throws when the binding is missing or the send fails. */
export async function sendEmail(
  env: Env,
  message: { to: string; subject: string; text: string; html?: string },
): Promise<void> {
  if (!env.EMAIL) throw new Error("EMAIL binding not configured");
  await env.EMAIL.send({ from: env.AUTH_EMAIL_FROM || DEFAULT_EMAIL_FROM, ...message });
}
