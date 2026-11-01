import { adminPageHTML } from "@web/server";
import type { Env } from "../types";
import type { AdminState, AdminTab } from "../../web/contract";
import {
  adminLoginAllowed,
  clearAdminCookie,
  createAdminCookie,
  hasAdminSession,
  passwordMatches,
} from "../admin/auth";
import { listChannels, testChannel } from "../admin/channels";
import {
  loadAdminReport,
  loadConversionDetail,
  parseAdminQuery,
  safeAdminBack,
} from "../admin/dashboard";
import { PORTAL_CSP } from "../helpers/response";

const HTML = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": PORTAL_CSP,
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const TABS: AdminTab[] = ["overview", "channels", "conversions", "requests"];

export async function handleAdmin(request: Request, env: Env, host = new URL(request.url).host): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/admin/logout" && request.method === "POST") {
    return new Response(null, {
      status: 303,
      headers: { ...HTML, Location: "/admin", "Set-Cookie": clearAdminCookie() },
    });
  }
  if (request.method === "POST" && url.pathname === "/admin") {
    if (!(await adminLoginAllowed(env, request))) {
      return page({ mode: "login", error: "尝试次数太多，请 15 分钟后再试。" }, 429);
    }
    const form = await request.formData().catch(() => null);
    const password = String(form?.get("password") || "");
    if (!(await passwordMatches(env, password))) {
      return page({ mode: "login", error: "口令不正确，请重新输入。" }, 401);
    }
    const next = safeAdminBack(String(form?.get("next") || ""));
    return new Response(null, {
      status: 303,
      headers: { ...HTML, Location: next, "Set-Cookie": await createAdminCookie(env) },
    });
  }
  if (request.method === "POST" && url.pathname === "/admin/channels/test") {
    if (!(await hasAdminSession(env, request)) || !sameOrigin(request, url)) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    const result = await testChannel(env, String(body.id || ""), host);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!(await hasAdminSession(env, request))) {
    return page({ mode: "login" }, request.method === "HEAD" ? 401 : 200);
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers: HTML });
  if (url.pathname === "/admin/conversion") {
    const detail = await loadConversionDetail(env, url.searchParams.get("id") || "");
    return page({ mode: "detail", detail, back: safeAdminBack(url.searchParams.get("back")) });
  }
  const report = await loadAdminReport(env, parseAdminQuery(url));
  const requested = url.searchParams.get("tab") as AdminTab | null;
  const tab = requested && TABS.includes(requested) ? requested : "overview";
  return page({ mode: "dashboard", report, channels: listChannels(env, report.providerHealth), tab });
}

/** The test endpoint spends provider credits, so refuse cross-site posts even with a cookie. */
function sameOrigin(request: Request, url: URL): boolean {
  return request.headers.get("Origin") === url.origin;
}

function page(state: AdminState, status = 200): Response {
  return new Response(adminPageHTML(state), { status, headers: HTML });
}
