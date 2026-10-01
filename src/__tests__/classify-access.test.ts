import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { recordAccess } from "../admin/analytics";
import { ACCESS_SURFACE_SQL, classifyAccessPath } from "../admin/classify";
import { createMockEnv } from "./test-helpers";
import type { Env } from "../types";

const FIXTURES: Array<[string, string, string]> = [
  ["/", "page", "home"],
  ["/docs", "page", "docs"],
  ["/examples", "page", "examples"],
  ["/integrations", "page", "integration"],
  ["/integration", "page", "integration"],
  ["/portal", "page", "portal"],
  ["/portal/keys", "page", "portal"],
  ["/portal/.env", "probe", "probe"],
  ["/https://example.com/.env", "api", "convert"],
  ["/favicon.ico", "asset", "favicon"],
  ["/robots.txt", "asset", "robots"],
  ["/llms.txt", "asset", "llms"],
  ["/img/a.png", "asset", "image"],
  ["/admin", "admin", "admin"],
  ["/admin/conversion", "admin", "admin"],
  ["/.env", "probe", "probe"],
  ["/.env.local", "probe", "probe"],
  ["/@fs/.env", "probe", "probe"],
  ["/api/config", "probe", "probe"],
  ["/api/proc/self/environ", "probe", "probe"],
  ["/api/batch", "api", "batch"],
  ["/api/stream", "api", "stream"],
  ["/api/jobs/abc", "api", "jobs"],
  ["/api/health", "api", "health"],
  ["/api/me", "account", "me"],
  ["/api/keys", "account", "keys"],
  ["/api/auth/magic-link", "account", "auth"],
  ["/https://pubs.usgs.gov/p", "api", "convert"],
  ["/example.com/path", "api", "convert"],
  ["/about", "other", "other"],
  ["/api/unknown", "other", "other"],
];

describe("access surfaces", () => {
  it("names pages, API calls, probes, and assets separately", () => {
    for (const [path, surface, route] of FIXTURES) {
      expect(classifyAccessPath(path), path).toEqual({ surface, route });
    }
  });

  it("classifies a percent-encoded convert URL as API access", () => {
    expect(classifyAccessPath("/https%3A%2F%2Fexample.com%2Fpage").surface).toBe("api");
  });

  it("uses the same path rules in the migration backfill", () => {
    const migration = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations/0005_reclassify_nested_probes.sql"), "utf8");
    expect(migration).toContain(ACCESS_SURFACE_SQL);
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE access_events (path TEXT, surface TEXT)");
    const insert = db.prepare("INSERT INTO access_events (path, surface) VALUES (?, '')");
    for (const [path] of FIXTURES) insert.run(path);
    const rows = db.prepare(`SELECT path, ${ACCESS_SURFACE_SQL} AS surface FROM access_events`).all() as Array<{ path: string; surface: string }>;
    for (const row of rows) {
      const expected = FIXTURES.find((item) => item[0] === row.path);
      expect(row.surface, row.path).toBe(expected?.[1]);
    }
  });

  it("stores the surface, route, and redacted query on a request", async () => {
    const bound: unknown[][] = [];
    const prepare = viPrepare(bound);
    const { env } = createMockEnv({ AUTH_DB: { prepare } as unknown as Env["AUTH_DB"] });
    await recordAccess(env, new Request("https://md.example.com/https://example.com/a?format=text&token=secret"), new Response("ok"), 42);
    const flat = bound.flat().map(String);
    expect(flat).toContain("api");
    expect(flat).toContain("convert");
    expect(flat).toContain("text");
    expect(flat.join("\n")).toContain("token=redacted");
    expect(flat.join("\n")).not.toContain("secret");
    expect(flat).toContain("42");
  });

  it("redacts a secret-shaped query value when the parameter name is ordinary", async () => {
    const bound: unknown[][] = [];
    const prepare = viPrepare(bound);
    const { env } = createMockEnv({ AUTH_DB: { prepare } as unknown as Env["AUTH_DB"] });
    await recordAccess(
      env,
      new Request("https://md.example.com/api/stream?url=https%3A%2F%2Fexample.com%2Fstream&engine=sk_live_secret_value&debug_trace=true&selector=.article%20%3E%20p"),
      new Response(null, { status: 401 }),
    );
    const flat = bound.flat().map(String).join("\n");
    expect(flat).not.toContain("sk_live_secret_value");
    expect(flat).toContain("engine=redacted");
    expect(flat).toContain("debug_trace=true");
    expect(flat).toContain("selector=.article");
  });
});

function viPrepare(bound: unknown[][]) {
  return (sql: string) => {
    const stmt = {
      bind: (...args: unknown[]) => {
        if (sql.includes("INSERT INTO access_events")) bound.push(args);
        return stmt;
      },
      run: async () => ({ success: true }),
    };
    return stmt;
  };
}
