import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
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
  return { db, env: { AUTH_DB: d1 } as unknown as Env };
}

function at(hoursAgo: number): string {
  return new Date(NOW - hoursAgo * 3600 * 1000).toISOString();
}

describe("suspicious anonymous IPs", () => {
  it("scores a round-the-clock failing scraper and skips normal and signed callers", async () => {
    const { db, env } = migratedDb();
    const access = db.prepare(`INSERT INTO access_events
      (created_at, kind, method, path, status, ua_family, auth_present, client_ip, asn, as_org, country)
      VALUES (?, ?, 'GET', '/x', ?, ?, ?, ?, ?, ?, ?)`);
    const conv = db.prepare(`INSERT INTO conversion_log
      (created_at, route, target_url, target_host, outcome, status_code, auth_tier, client_ip)
      VALUES (?, 'convert', ?, ?, ?, ?, ?, ?)`);

    // Scraper: 60 requests over 15 hours from a hosting network, mostly one failing site.
    for (let i = 0; i < 60; i++) {
      access.run(at(i % 15), "api", 200, "bot", "none", "198.51.100.7", 64500, "Example Cloud Hosting", "SG");
      // The busiest host sorts first alphabetically, so a plain MAX(host) would name the wrong one.
      const busy = i < 55;
      conv.run(at(i % 15), "https://x", busy ? "aaa.example" : "zzz.example", busy ? "convert_error" : "success", busy ? 422 : 200, "anonymous", "198.51.100.7");
    }
    // A person: 25 successful browser requests within one hour.
    for (let i = 0; i < 25; i++) {
      access.run(at(1), "api", 200, "browser", "none", "203.0.113.20", 4134, "Home Broadband", "CN");
      conv.run(at(1), "https://x", "example.com", "success", 200, "anonymous", "203.0.113.20");
    }
    // A signed-in heavy user is not judged here.
    for (let i = 0; i < 400; i++) {
      access.run(at(i % 20), "api", 200, "node", "bearer", "192.0.2.5", 64501, "Example Cloud", "US");
    }
    // Yesterday's flood is outside the window.
    for (let i = 0; i < 500; i++) {
      access.run(at(30), "api", 429, "bot", "none", "192.0.2.99", 64502, "Old Host", "DE");
    }

    const rows = await loadSuspiciousIps(env, SINCE);
    expect(rows.map((r) => r.ip)).toEqual(["198.51.100.7"]);
    const [scraper] = rows;
    expect(scraper).toMatchObject({ level: "abuse", score: 8, requests: 60, conversions: 60, failures: 55, hosts: 2, top_host: "aaa.example" });
    expect(scraper.reasons.join(" ")).toContain("aaa.example");
    expect(scraper.reasons.join(" ")).toContain("机房 IP");
  });
});
