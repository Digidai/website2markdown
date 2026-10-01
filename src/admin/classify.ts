import { extractTargetUrl } from "../security";

export const ACCESS_SURFACES = ["page", "api", "account", "asset", "probe", "admin", "other"] as const;
export type AccessSurface = (typeof ACCESS_SURFACES)[number];

/**
 * Reclassifies a stored path. New writes store the same surface directly.
 * Keep migrations/0005_reclassify_nested_probes.sql in lockstep with this string.
 * Probe is first so /portal/.env is not counted as a portal page view.
 */
export const ACCESS_SURFACE_SQL = `CASE
  WHEN path LIKE '/.env%'
    OR path LIKE '/.git%'
    OR path LIKE '/.aws%'
    OR path LIKE '/.ssh%'
    OR path LIKE '/@fs%'
    OR path LIKE '%phpunit%'
    OR path LIKE '/wp-admin%'
    OR path LIKE '/wp-login%'
    OR path LIKE '/wp-content%'
    OR path LIKE '/xmlrpc%'
    OR path LIKE '/cgi-bin%'
    OR path LIKE '/actuator%'
    OR path LIKE '/server-status%'
    OR path LIKE '/api/config%'
    OR path LIKE '/api/proc%'
    OR path LIKE '/api/env%'
    OR path LIKE '/api/.env%'
    OR (
      path NOT LIKE '/http%'
      AND instr(substr(path, 2), '/') > 0
      AND instr(substr(path, 2, instr(substr(path, 2), '/') - 1), '.') = 0
      AND (
        path LIKE '%/.env%'
        OR path LIKE '%/.git%'
        OR path LIKE '%/.aws%'
        OR path LIKE '%/.ssh%'
        OR path LIKE '%/wp-admin%'
        OR path LIKE '%/wp-login%'
        OR path LIKE '%/wp-content%'
        OR path LIKE '%/xmlrpc%'
        OR path LIKE '%/cgi-bin%'
        OR path LIKE '%/actuator%'
        OR path LIKE '%/server-status%'
        OR path LIKE '%/@fs%'
        OR path LIKE '%phpunit%'
      )
    ) THEN 'probe'
  WHEN path = '/admin' OR path LIKE '/admin/%' THEN 'admin'
  WHEN path IN ('/', '/examples', '/docs', '/integrations', '/integration', '/portal', '/portal/') OR path LIKE '/portal/%' THEN 'page'
  WHEN path IN ('/favicon.ico', '/robots.txt', '/sitemap.xml', '/llms.txt', '/.well-known/llms.txt')
    OR path LIKE '/.well-known/%'
    OR path LIKE '/img/%'
    OR path LIKE '/r2img/%' THEN 'asset'
  WHEN path = '/api/me' OR path = '/api/keys' OR path LIKE '/api/keys/%' OR path = '/api/auth' OR path LIKE '/api/auth/%' THEN 'account'
  WHEN path IN ('/api/batch', '/api/extract', '/api/deepcrawl', '/api/stream', '/api/jobs', '/api/health', '/api/usage', '/api/og')
    OR path LIKE '/api/jobs/%' THEN 'api'
  WHEN path LIKE '/api/%' THEN 'other'
  WHEN path LIKE '/http%' OR (instr(substr(path, 2), '.') > 0 AND substr(path, 2, 1) != '.') THEN 'api'
  ELSE 'other'
END`;

const PAGE_ROUTES: Record<string, string> = {
  "/": "home",
  "/examples": "examples",
  "/docs": "docs",
  "/integrations": "integration",
  "/integration": "integration",
};

const PRODUCT_API_ROUTES: Record<string, string> = {
  "/api/batch": "batch",
  "/api/extract": "extract",
  "/api/deepcrawl": "deepcrawl",
  "/api/stream": "stream",
  "/api/jobs": "jobs",
  "/api/health": "health",
  "/api/usage": "usage",
  "/api/og": "og",
};

export function classifyAccessPath(pathname: string): { surface: AccessSurface; route: string } {
  const path = pathname || "/";
  if (isProbe(path)) return { surface: "probe", route: "probe" };
  if (path === "/admin" || path.startsWith("/admin/")) return { surface: "admin", route: "admin" };
  if (PAGE_ROUTES[path]) return { surface: "page", route: PAGE_ROUTES[path] };
  if (path === "/portal" || path.startsWith("/portal/")) return { surface: "page", route: "portal" };
  if (isAsset(path)) return { surface: "asset", route: assetRoute(path) };
  if (path === "/api/me") return { surface: "account", route: "me" };
  if (path === "/api/keys" || path.startsWith("/api/keys/")) return { surface: "account", route: "keys" };
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return { surface: "account", route: "auth" };
  if (PRODUCT_API_ROUTES[path]) return { surface: "api", route: PRODUCT_API_ROUTES[path] };
  if (path.startsWith("/api/jobs/")) return { surface: "api", route: "jobs" };
  if (path.startsWith("/api/")) return { surface: "other", route: "other" };
  if (path.startsWith("/http") || (path.slice(1).includes(".") && !path.startsWith("/."))) {
    return { surface: "api", route: "convert" };
  }
  if (extractTargetUrl(path, "")) return { surface: "api", route: "convert" };
  return { surface: "other", route: "other" };
}

function isAsset(path: string): boolean {
  return path === "/favicon.ico"
    || path === "/robots.txt"
    || path === "/sitemap.xml"
    || path === "/llms.txt"
    || path === "/.well-known/llms.txt"
    || path.startsWith("/.well-known/")
    || path.startsWith("/img/")
    || path.startsWith("/r2img/");
}

function assetRoute(path: string): string {
  if (path === "/favicon.ico") return "favicon";
  if (path === "/robots.txt") return "robots";
  if (path === "/sitemap.xml") return "sitemap";
  if (path === "/llms.txt" || path.startsWith("/.well-known/")) return "llms";
  if (path.startsWith("/img/") || path.startsWith("/r2img/")) return "image";
  return "asset";
}

function isProbe(path: string): boolean {
  if (path.startsWith("/.env")
    || path.startsWith("/.git")
    || path.startsWith("/.aws")
    || path.startsWith("/.ssh")
    || path.startsWith("/@fs")
    || path.includes("phpunit")
    || path.startsWith("/wp-admin")
    || path.startsWith("/wp-login")
    || path.startsWith("/wp-content")
    || path.startsWith("/xmlrpc")
    || path.startsWith("/cgi-bin")
    || path.startsWith("/actuator")
    || path.startsWith("/server-status")
    || path.startsWith("/api/config")
    || path.startsWith("/api/proc")
    || path.startsWith("/api/env")
    || path.startsWith("/api/.env")) {
    return true;
  }
  if (isHostnamePath(path)) return false;
  return path.includes("/.env")
    || path.includes("/.git")
    || path.includes("/.aws")
    || path.includes("/.ssh")
    || path.includes("/wp-admin")
    || path.includes("/wp-login")
    || path.includes("/wp-content")
    || path.includes("/xmlrpc")
    || path.includes("/cgi-bin")
    || path.includes("/actuator")
    || path.includes("/server-status")
    || path.includes("/@fs");
}

function isHostnamePath(path: string): boolean {
  if (path.startsWith("/http")) return true;
  const first = path.replace(/^\//, "").split("/")[0] || "";
  return first.includes(".") && !first.startsWith(".");
}
