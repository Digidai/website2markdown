import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { handleLead } from "../handlers/leads";
import type { Env } from "../types";

function setup(send = vi.fn(async (_message: { to: string; subject: string; text: string }) => undefined)) {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  const d1 = {
    prepare: (sql: string) => {
      let args: unknown[] = [];
      const stmt = {
        bind: (...values: unknown[]) => { args = values; return stmt; },
        run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true }; },
        first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
      };
      return stmt;
    },
  };
  const env = { AUTH_DB: d1, EMAIL: { send }, ADMIN_EMAIL: "owner@example.com" } as unknown as Env;
  return { db, env, send };
}

function post(body: unknown, ip = "203.0.113.5") {
  return new Request("https://mdget.dev/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

describe("pricing leads", () => {
  it("stores the lead and emails it to the owner", async () => {
    const { db, env, send } = setup();
    const res = await handleLead(post({
      email: " Ann@Acme.io ", name: "Ann", company: "Acme", plan: "enterprise", volume: "100k-1m",
      message: "Need WeChat at scale", lang: "zh",
    }), env);
    expect(res.status).toBe(200);
    expect(db.prepare("SELECT email, company, plan, volume, lang, client_ip, emailed FROM leads").all()).toEqual([
      { email: "ann@acme.io", company: "Acme", plan: "enterprise", volume: "100k-1m", lang: "zh", client_ip: "203.0.113.5", emailed: 1 },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toContain("Acme");
    expect(mail.text).toContain("ann@acme.io");
    expect(mail.text).toContain("Need WeChat at scale");
  });

  it("drops unknown plan and volume values instead of storing them", async () => {
    const { db, env } = setup();
    await handleLead(post({ email: "a@b.co", plan: "<script>", volume: "lots" }), env);
    expect(db.prepare("SELECT plan, volume FROM leads").get()).toEqual({ plan: "", volume: "" });
  });

  it("answers bots that fill the hidden field without storing or emailing", async () => {
    const { db, env, send } = setup();
    const res = await handleLead(post({ email: "bot@spam.co", website: "http://spam" }), env);
    expect(res.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM leads").get()).toEqual({ n: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const { env } = setup();
    expect((await handleLead(post({ email: "not an email" }), env)).status).toBe(400);
  });

  it("keeps the lead when the email fails", async () => {
    const { db, env } = setup(vi.fn(async (_message: { to: string; subject: string; text: string }) => { throw new Error("send failed"); }));
    const res = await handleLead(post({ email: "a@b.co" }), env);
    expect(res.status).toBe(200);
    expect(db.prepare("SELECT emailed FROM leads").all()).toEqual([{ emailed: 0 }]);
  });

  it("limits one address to five requests an hour", async () => {
    const { db, env } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await handleLead(post({ email: `u${i}@b.co` }), env)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM leads").get()).toEqual({ n: 5 });
  });
});
