import type { Env } from "../types";
import {
  adminLoginAllowed,
  clearAdminCookie,
  createAdminCookie,
  hasAdminSession,
  passwordMatches,
} from "../admin/auth";
import {
  adminPageHTML,
  conversionDetailHTML,
  loadAdminReport,
  loadConversionDetail,
  parseAdminQuery,
  safeAdminBack,
} from "../admin/dashboard";

const HTML = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/admin/logout" && request.method === "POST") {
    return new Response(null, {
      status: 303,
      headers: { ...HTML, Location: "/admin", "Set-Cookie": clearAdminCookie() },
    });
  }
  if (request.method === "POST" && url.pathname === "/admin") {
    if (!(await adminLoginAllowed(env, request))) {
      return html(adminPageHTML(null, "尝试次数太多，请稍后再试。"), 429);
    }
    const form = await request.formData().catch(() => null);
    const password = String(form?.get("password") || "");
    if (!(await passwordMatches(env, password))) {
      return html(adminPageHTML(null, "口令不正确。"), 401);
    }
    return new Response(null, {
      status: 303,
      headers: { ...HTML, Location: "/admin", "Set-Cookie": await createAdminCookie(env) },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!(await hasAdminSession(env, request))) {
    return html(adminPageHTML(null), request.method === "HEAD" ? 401 : 200);
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers: HTML });
  if (url.pathname === "/admin/conversion") {
    const detail = await loadConversionDetail(env, url.searchParams.get("id") || "");
    return html(conversionDetailHTML(detail, safeAdminBack(url.searchParams.get("back"))));
  }
  return html(adminPageHTML(await loadAdminReport(env, parseAdminQuery(url))));
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: HTML });
}
