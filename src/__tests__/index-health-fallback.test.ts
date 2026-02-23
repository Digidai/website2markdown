import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getBrowserCapacityStats: vi.fn(),
  getPaywallRuleStats: vi.fn(),
}));

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

vi.mock("../browser", async () => {
  const actual = await vi.importActual<typeof import("../browser")>("../browser");
  return {
    ...actual,
    getBrowserCapacityStats: mocked.getBrowserCapacityStats,
  };
});

vi.mock("../paywall", async () => {
  const actual = await vi.importActual<typeof import("../paywall")>("../paywall");
  return {
    ...actual,
    getPaywallRuleStats: mocked.getPaywallRuleStats,
  };
});

import worker from "../index";
import { createMockEnv } from "./test-helpers";

beforeEach(() => {
  mocked.getBrowserCapacityStats.mockReturnValue({
    active: 0,
    queued: 0,
    maxConcurrent: 2,
    maxQueueLength: 100,
    queueTimeoutMs: 10_000,
  });
  mocked.getPaywallRuleStats.mockReturnValue({
    source: "default",
    ruleCount: 0,
    domainCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("/api/health defensive fallback", () => {
  it("returns 200 even when stats providers throw", async () => {
    mocked.getBrowserCapacityStats.mockImplementation(() => {
      throw new Error("browser stats unavailable");
    });
    mocked.getPaywallRuleStats.mockImplementation(() => {
      throw new Error("paywall stats unavailable");
    });

    const res = await worker.fetch(
      new Request("https://md.example.com/api/health"),
      createMockEnv().env,
    );
    const payload = await res.json() as {
      status?: string;
      browser?: { active?: number; maxConcurrent?: number };
      paywall?: { source?: string; error?: string };
    };

    expect(res.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.browser?.active).toBe(0);
    expect(payload.browser?.maxConcurrent).toBe(0);
    expect(payload.paywall?.source).toBe("unavailable");
    expect(payload.paywall?.error).toContain("paywall stats unavailable");
  });
});
