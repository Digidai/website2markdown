import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSuspiciousIps } from "../admin/ip-risk";
import type { Env } from "../types";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const SINCE = new Date(NOW - 24 * 3600 * 1000).toISOString();

function migratedDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  const d1 = {
    prepare: (sql: string) => {
      let args: unknown[] = [];
      const stmt = {
        bind: (...values: unknown[]) => { args = values; return stmt; },
        all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
      };
      return stmt;
    },
  };
  return { db, env: { AUTH_DB: d1, CF_ACCOUNT_ID: "acct", CF_ANALYTICS_TOKEN: "token" } as unknown as Env };
}

function at(hoursAgo: number): string {
  return new Date(NOW - hoursAgo * 3600 * 1000).toISOString();
}

describe("suspicious anonymous IPs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("scores a round-the-clock failing scraper and skips normal and signed callers", async () => {
    const { db, env } = migratedDb();
    const conv = db.prepare(`INSERT INTO conversion_log
      (created_at, route, target_url, target_host, outcome, status_code, auth_tier, client_ip)
      VALUES (?, 'convert', ?, ?, ?, ?, ?, ?)`);

    // Analytics Engine has already filtered and grouped the access side:
    // signed callers, old rows, and IPs under 20 requests never come back.
    const sqls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sqls.push(String(init.body));
      return Response.json({ data: [
        // Scraper: 60 requests over 15 hours from a hosting network.
        { ip: "198.51.100.7", requests: "60", blocked: "0", malformed: "0", probes: "0", active_hours: "15", ua_family: "bot", as_org: "Example Cloud Hosting", asn: 64500, country: "SG" },
        // A person: 25 browser requests within one hour.
        { ip: "203.0.113.20", requests: "25", blocked: "0", malformed: "0", probes: "0", active_hours: "1", ua_family: "browser", as_org: "Home Broadband", asn: 4134, country: "CN" },
      ] });
    });
    for (let i = 0; i < 60; i++) {
      // The busiest host sorts first alphabetically, so a plain MAX(host) would name the wrong one.
      const busy = i < 55;
      conv.run(at(i % 15), "https://x", busy ? "aaa.example" : "zzz.example", busy ? "convert_error" : "success", busy ? 422 : 200, "anonymous", "198.51.100.7");
    }
    for (let i = 0; i < 25; i++) {
      conv.run(at(1), "https://x", "example.com", "success", 200, "anonymous", "203.0.113.20");
    }

    const rows = await loadSuspiciousIps(env, SINCE);
    expect(sqls[0]).toContain("blob9 NOT IN ('bearer', 'both')");
    expect(sqls[0]).toContain(`timestamp >= toDateTime('${SINCE.slice(0, 19).replace("T", " ")}')`);
    expect(rows.map((r) => r.ip)).toEqual(["198.51.100.7"]);
    const [scraper] = rows;
    expect(scraper).toMatchObject({ level: "abuse", score: 8, requests: 60, conversions: 60, failures: 55, hosts: 2, top_host: "aaa.example" });
    expect(scraper.reasons.join(" ")).toContain("aaa.example");
    expect(scraper.reasons.join(" ")).toContain("机房 IP");
  });
});
