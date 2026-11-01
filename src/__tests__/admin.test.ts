import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));

import worker from "../index";
import { recordConversionLog } from "../admin/analytics";
import { adminPageHTML } from "@web/server";
import { conversionFlag } from "../../web/contract";
import {
  loadAdminReport,
  parseAdminQuery,
  safeAdminBack,
  type AdminReport,
  type ConversionRow,
} from "../admin/dashboard";
import { listChannels } from "../admin/channels";
import type { Env } from "../types";
import { createMockEnv, mockCtx } from "./test-helpers";

const TEST_ADMIN_PASSWORD = "test-admin-pass";

function adminTestEnv(overrides?: Partial<Env>): Env {
  return createMockEnv({ ADMIN_PASSWORD: TEST_ADMIN_PASSWORD, ...overrides }).env;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("/admin", () => {
  it("shows the passphrase form and does not treat /admin as a conversion", async () => {
    const res = await worker.fetch(new Request("https://md.example.com/admin"), adminTestEnv(), mockCtx());
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("运营后台");
    expect(html).toContain('name="password"');
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("rejects a wrong passphrase", async () => {
    const res = await worker.fetch(new Request("https://md.example.com/admin", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=nope",
    }), adminTestEnv(), mockCtx());
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("口令不正确");
  });

  it("opens the dashboard for the operator passphrase", async () => {
    const login = await worker.fetch(new Request("https://md.example.com/admin", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${TEST_ADMIN_PASSWORD}`,
      redirect: "manual",
    }), adminTestEnv(), mockCtx());
    expect(login.status).toBe(303);
    const cookie = login.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("md_admin=");
    expect(cookie).toContain("HttpOnly");

    const page = await worker.fetch(new Request("https://md.example.com/admin", {
      headers: { Cookie: cookie.split(";")[0] },
    }), adminTestEnv(), mockCtx());
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("运营统计");
    expect(html).toContain("API 访问");
    expect(html).toContain("渠道");
    expect(html).toContain("转换记录");
    expect(html).toContain("退出");
    expect(html).not.toContain('name="password"');
  });

  it("runs channel tests only for a same-origin admin session", async () => {
    const env = adminTestEnv();
    const login = await worker.fetch(new Request("https://md.example.com/admin", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${TEST_ADMIN_PASSWORD}`,
      redirect: "manual",
    }), env, mockCtx());
    const cookie = (login.headers.get("Set-Cookie") || "").split(";")[0];
    const probe = (headers: Record<string, string>) => worker.fetch(new Request("https://md.example.com/admin/channels/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ id: "browser_use" }),
    }), env, mockCtx());

    expect((await probe({ Origin: "https://md.example.com" })).status).toBe(401);
    expect((await probe({ Cookie: cookie, Origin: "https://evil.example" })).status).toBe(401);
    const ok = await probe({ Cookie: cookie, Origin: "https://md.example.com" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: false, summary: "这个渠道不能测试。" });
  });

  it("keeps conversion detail behind the passphrase", async () => {
    const locked = await worker.fetch(
      new Request("https://md.example.com/admin/conversion?id=11111111-1111-4111-8111-111111111111"),
      adminTestEnv(),
      mockCtx(),
    );
    const lockedHtml = await locked.text();
    expect(lockedHtml).toContain('name="password"');
    expect(lockedHtml).not.toContain("mp.weixin.qq.com");
  });

  it("shows the original link and saved markdown for one conversion", async () => {
    const row = sampleRow();
    const env = adminTestEnv({ AUTH_DB: detailDb(row) });
    const login = await worker.fetch(new Request("https://md.example.com/admin", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${TEST_ADMIN_PASSWORD}`,
      redirect: "manual",
    }), env, mockCtx());
    const cookie = (login.headers.get("Set-Cookie") || "").split(";")[0];
    const page = await worker.fetch(new Request(`https://md.example.com/admin/conversion?id=${row.id}`, {
      headers: { Cookie: cookie },
    }), env, mockCtx());
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("https://mp.weixin.qq.com/s/abc");
    expect(html).toContain("# 标题");
    expect(html).toContain("login wall");
    expect(html).toContain("失败");
    expect(html).not.toContain("<script>alert");
  });
});

describe("admin report", () => {
  it("drops unsafe filters", () => {
    const query = parseAdminQuery(new URL("https://md.example.com/admin?days=2&platform=WeChat!&view=nope&page=0&status=99&q=%3Cscript%3E"));
    expect(query.days).toBe(14);
    expect(query.platform).toBe("");
    expect(query.view).toBe("all");
    expect(query.page).toBe(1);
    expect(query.status).toBeNull();
    expect(query.q).toBe("<script>");
    expect(safeAdminBack("https://evil.example/admin")).toBe("/admin");
    expect(safeAdminBack("/admin?view=failures")).toBe("/admin?view=failures");
    expect(safeAdminBack("/admin?q=https://example.com/a")).toBe("/admin?q=https://example.com/a");
    expect(safeAdminBack("/admin//evil")).toBe("/admin");
  });

  it("marks failed and degraded conversions", () => {
    expect(conversionFlag(sampleRow())).toBe("fail");
    expect(conversionFlag({ ...sampleRow(), outcome: "success", status_code: 200, output_chars: 0, fallbacks: "", paywall: 0, duration_ms: 10 })).toBe("warn");
    expect(conversionFlag({ ...sampleRow(), outcome: "success", status_code: 200, output_chars: null, duration_ms: 10, fallbacks: "", paywall: 0 })).toBe("ok");
  });

  it("renders the overview counts and the metric definitions", () => {
    const html = adminPageHTML({ mode: "dashboard", report: sampleReport([sampleRow()]), channels: [], tab: "overview" });
    expect(html).toContain("运营统计");
    expect(html).toContain("API 访问");
    expect(html).toContain("其他请求");
    expect(html).toContain("有效结果");
    expect(html).toContain("login_wall");
    expect(html).toContain("指标口径");
  });

  it("renders the failure and the source link in the conversion list", () => {
    const row = sampleRow();
    const html = adminPageHTML({ mode: "dashboard", report: sampleReport([row]), channels: [], tab: "conversions" });
    expect(html).toContain("https://mp.weixin.qq.com/s/abc");
    expect(html).toContain(`/admin/conversion?id=${row.id}`);
    expect(html).toContain("login wall");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("筛选");
  });

  it("lists channels by configuration and merges path health", () => {
    const { env } = createMockEnv({ PROXY_URL: "http://user1:pw@204.0.0.1:3000" });
    delete (env as Partial<Env>).CF_API_TOKEN;
    delete (env as Partial<Env>).BROWSER_USE_API_KEY;
    const channels = listChannels(env, [
      { path: "proxy_pool", attempts: 30, failures: 28, lastError: "Proxy pool exhausted", lastFailureAt: "2026-09-29T08:00:00.000Z" },
      { path: "proxy", attempts: 10, failures: 1, lastError: "407 client_10000", lastFailureAt: "2026-09-29T09:00:00.000Z" },
      { path: "substack_proxy", attempts: 5, failures: 0, lastError: "", lastFailureAt: "" },
    ]);
    const byId = new Map(channels.map((c) => [c.id, c]));
    expect(byId.get("cf_markdown")?.status).toBe("missing");
    expect(byId.get("browser_use")?.status).toBe("disabled");
    expect(byId.get("browser_use")?.testable).toBe(false);
    expect(byId.get("proxy")?.status).toBe("active");
    // Both proxy paths roll up into one channel, and the newest failure wins.
    expect(byId.get("proxy")?.health).toMatchObject({ attempts: 40, failures: 29, lastError: "407 client_10000" });
    // Substack's retry has its own card and does not roll into the proxy card.
    expect(byId.get("substack_proxy")?.health).toMatchObject({ attempts: 5, failures: 0 });
    expect(byId.get("jina")?.health).toBeNull();
    // Status comes from presence only; secret values never reach the page model.
    expect(JSON.stringify(channels)).not.toContain(":pw@");

    const html = adminPageHTML({ mode: "dashboard", report: sampleReport([]), channels, tab: "channels" });
    expect(html).toContain("Swiftproxy 代理");
    expect(html).toContain("Substack 代理重试");
    expect(html).toContain("407 client_10000");
    expect(html).not.toContain(":pw@");
  });


  it("counts useful results as substantial successes without a paywall", async () => {
    const { env, sqls } = captureDb();
    await loadAdminReport(env, parseAdminQuery(new URL("https://md.example.com/admin")));
    const totals = sqls.find((sql) => sql.includes("useful_today"));
    expect(totals).toBeTruthy();
    expect(totals).toContain("output_chars >= 800");
    expect(totals).toContain("paywall = 0");
    expect(totals).toContain("useful_window");
    expect(totals).toContain("AS useful_today");
  });

  it("asks for every matching conversion when the failure filter is on", async () => {
    const { env, sqls } = captureDb();
    await loadAdminReport(env, parseAdminQuery(new URL("https://md.example.com/admin?view=failures&days=30&q=weixin")));
    const lists = sqls.filter((sql) => sql.includes("FROM conversion_log") && sql.includes("LIMIT ?"));
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((sql) => sql.includes("outcome != 'success'") && sql.includes("output_chars"))).toBe(true);
    expect(sqls.some((sql) => sql.includes("LIMIT 8"))).toBe(false);
  });

  it("keeps the full list query separate from the failure strip", async () => {
    const { env, sqls } = captureDb();
    await loadAdminReport(env, parseAdminQuery(new URL("https://md.example.com/admin")));
    const lists = sqls.filter((sql) => sql.includes("FROM conversion_log") && sql.includes("LIMIT ? OFFSET ?"));
    expect(lists.some((sql) => sql.includes("outcome != 'success'"))).toBe(false);
    expect(sqls.some((sql) => sql.includes("LIMIT 8") && sql.includes("outcome != 'success'"))).toBe(true);
  });

  it("stores a redacted excerpt and keeps the article link", async () => {
    const bound: unknown[][] = [];
    const prepare = vi.fn((sql: string) => {
      const stmt = {
        bind: vi.fn((...args: unknown[]) => {
          if (sql.includes("INSERT INTO conversion_log")) bound.push(args);
          return stmt;
        }),
        run: vi.fn(async () => ({ success: true })),
      };
      return stmt;
    });
    const { env } = createMockEnv({ AUTH_DB: { prepare } as unknown as Env["AUTH_DB"] });
    await recordConversionLog(env, {
      request: new Request("https://md.example.com/"),
      route: "convert",
      targetUrl: "https://example.com/post?token=secret-token",
      platform: "generic",
      outcome: "convert_error",
      statusCode: 422,
      methodUsed: "browser",
      cacheStatus: "miss",
      durationMs: 1200,
      format: "markdown",
      authTier: "anonymous",
      errorCode: "timeout",
      outputContent: "# Hello\n\nSee https://example.com/post\nAuthorization: Bearer abcdefghijklmnop\n",
      outputChars: 40,
      errorMessage: "token=supersecret blew up",
      fallbacks: ["jina"],
      paywall: true,
      browserRendered: true,
    });
    const flat = bound.flat().map(String).join("\n");
    expect(flat).toContain("https://example.com/post");
    expect(flat).toContain("token=redacted");
    expect(flat).not.toContain("abcdefghijklmnop");
    expect(flat).not.toContain("supersecret");
    expect(flat).not.toContain("secret-token");
  });

  it("stores caller IP, network and account on the migrated schema", async () => {
    const db = new DatabaseSync(":memory:");
    for (const file of readdirSync("migrations").sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"));
    const d1 = {
      prepare: (sql: string) => {
        let args: unknown[] = [];
        const stmt = {
          bind: (...values: unknown[]) => { args = values; return stmt; },
          run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true }; },
        };
        return stmt;
      },
    };
    const { env } = createMockEnv({ AUTH_DB: d1 as unknown as Env["AUTH_DB"] });
    const request = new Request("https://md.example.com/", {
      headers: { "cf-connecting-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 ExampleBot/2.1" },
    });
    Object.defineProperty(request, "cf", { value: { asn: 64500, asOrganization: "Example Cloud", city: "Singapore" } });
    await recordConversionLog(env, {
      request,
      route: "convert",
      targetUrl: "https://example.com/post",
      platform: "generic",
      outcome: "success",
      statusCode: 200,
      methodUsed: "native",
      cacheStatus: "miss",
      durationMs: 300,
      format: "markdown",
      authTier: "free",
      errorCode: "",
      outputContent: "# Hi",
      outputChars: 4,
      errorMessage: "",
      fallbacks: [],
      paywall: false,
      browserRendered: false,
      accountId: "acct_123",
      keyId: "key_456",
    });
    const row = db.prepare("SELECT client_ip, user_agent, asn, as_org, city, account_id, key_id FROM conversion_log").get();
    expect(row).toEqual({
      client_ip: "203.0.113.7",
      user_agent: "Mozilla/5.0 ExampleBot/2.1",
      asn: 64500,
      as_org: "Example Cloud",
      city: "Singapore",
      account_id: "acct_123",
      key_id: "key_456",
    });
  });
});

function sampleRow(): ConversionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-09-29T01:02:03.000Z",
    route: "convert",
    target_url: "https://mp.weixin.qq.com/s/abc",
    target_host: "mp.weixin.qq.com",
    platform: "wechat",
    outcome: "convert_error",
    status_code: 422,
    method_used: "browser",
    cache_status: "miss",
    duration_ms: 1800,
    format: "markdown",
    country: "CN",
    auth_tier: "anonymous",
    error_code: "login_wall",
    output_excerpt: "# 标题\n\n正文 <b>x</b>",
    output_chars: 12,
    error_message: "login wall",
    fallbacks: "jina",
    paywall: 1,
    browser_rendered: 1,
  };
}

function sampleReport(rows: ConversionRow[]): AdminReport {
  const query = parseAdminQuery(new URL("https://md.example.com/admin?view=failures&days=7"));
  return {
    error: "",
    query,
    pagesToday: 4,
    pagesWindow: 10,
    pageErrors: 0,
    apiToday: 8,
    apiWindow: 20,
    apiErrors: 1,
    accountWindow: 1,
    probeWindow: 3,
    assetWindow: 2,
    conversionsToday: 2,
    conversionsWindow: 6,
    usefulToday: 1,
    usefulWindow: 3,
    successRate: 50,
    failures: 1,
    anomalies: 1,
    anonUsage: 5,
    signedUsage: 1,
    creditSum: 1,
    ledgerRequests: 2,
    ledgerCredits: 2,
    ledgerRequestsAll: 9,
    ledgerCreditsAll: 9,
    aggregateRequests: 30,
    accounts: 1,
    keys: 1,
    conversionDays: [{ day: "2026-09-29", ok: 2, warn: 1, bad: 1 }],
    pageDays: [{ day: "2026-09-29", n: 4 }],
    apiDays: [{ day: "2026-09-29", n: 8 }],
    pagePaths: [{ label: "/", n: 4 }],
    apiPaths: [{ label: "/https://example.com", n: 8 }],
    authTiers: [{ label: "anonymous", n: 5 }],
    topIps: [{ label: "203.0.113.9 · Example Cloud", n: 5 }],
    countries: [{ label: "CN", n: 4 }],
    outcomes: [{ label: "convert_error", n: 1 }],
    platforms: [{ label: "wechat", n: 1 }],
    errorCodes: [{ label: "login_wall", n: 1 }],
    conversions: rows,
    conversionTotal: rows.length,
    accesses: [],
    accessTotal: 0,
    failurePreview: [],
    suspiciousIps: [{
      ip: "203.0.113.9", asn: 64500, as_org: "Example Cloud", country: "SG", ua_family: "bot",
      requests: 420, conversions: 400, failures: 380, hosts: 2, top_host: "priv.au",
      score: 9, level: "abuse", reasons: ["请求很多（420 次）", "失败率高（95%）"],
    }],
    providerHealth: [
      { path: "proxy_pool", attempts: 30, failures: 28, lastError: "Proxy pool exhausted", lastFailureAt: "2026-09-29T08:00:00.000Z" },
      { path: "jina", attempts: 5, failures: 4, lastError: "HTTP 451", lastFailureAt: "2026-09-29T07:00:00.000Z" },
    ],
  };
}

function captureDb(): { env: Env; sqls: string[] } {
  const sqls: string[] = [];
  const prepare = vi.fn((sql: string) => {
    sqls.push(sql);
    const stmt = {
      bind: vi.fn(() => stmt),
      first: vi.fn(async () => ({
        n: 0,
        views_today: 0,
        views_window: 0,
        access_errors: 0,
        today_n: 0,
        window_n: 0,
        success_n: 0,
        fail_n: 0,
        anomaly_n: 0,
      })),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ success: true })),
    };
    return stmt;
  });
  const { env } = createMockEnv({ AUTH_DB: { prepare } as unknown as Env["AUTH_DB"] });
  return { env, sqls };
}

function detailDb(row: ConversionRow): D1Database {
  const prepare = vi.fn((sql: string) => {
    const stmt = {
      bind: vi.fn(() => stmt),
      first: vi.fn(async () => {
        if (sql.includes("conversion_log") && sql.includes("WHERE id")) return row;
        if (sql.includes("rate_limits")) return { count: 1, expires_at: "2099-01-01T00:00:00.000Z" };
        return null;
      }),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ success: true })),
    };
    return stmt;
  });
  return { prepare } as unknown as D1Database;
}
