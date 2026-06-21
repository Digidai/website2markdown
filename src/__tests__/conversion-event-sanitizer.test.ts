import { describe, expect, it } from "vitest";

import {
  buildSanitizedConversionEvent,
  buildDebugTraceDecision,
  detectTargetPlatform,
  resolveRequestId,
  sanitizeErrorMessage,
  userAgentFamily,
} from "../observability/conversion-events";
import type { AuthContext, Env } from "../types";

describe("conversion event sanitizer", () => {
  it("resolves debug trace decisions by request source, auth, and D1 availability", () => {
    const auth: AuthContext = {
      tier: "pro",
      accountId: "acct_123",
      keyId: "key_123",
      quotaLimit: 50_000,
      quotaUsed: 0,
    };
    const anonymous: AuthContext = {
      tier: "anonymous",
      accountId: null,
      keyId: null,
      quotaLimit: 0,
      quotaUsed: 0,
    };
    const envWithD1 = { AUTH_DB: {} as D1Database } as Env;

    expect(buildDebugTraceDecision(
      new Request("https://md.example.com/?debug_trace=true"),
      auth,
      envWithD1,
    )).toMatchObject({ requested: true, allowed: true, source: "query", headerValue: "accepted" });

    expect(buildDebugTraceDecision(
      new Request("https://md.example.com/", { headers: { "X-Debug-Trace": "true" } }),
      anonymous,
      envWithD1,
    )).toMatchObject({ requested: true, allowed: false, source: "header", headerValue: "not-authorized" });

    expect(buildDebugTraceDecision(
      new Request("https://md.example.com/?debug_trace=true", { headers: { "X-Debug-Trace": "true" } }),
      auth,
      {} as Env,
    )).toMatchObject({ requested: true, allowed: false, source: "both", headerValue: "not-available" });
  });

  it("classifies platforms and user agents without retaining raw user agent text", () => {
    expect(detectTargetPlatform("https://mp.weixin.qq.com/s/abc")).toBe("wechat");
    expect(detectTargetPlatform("https://zhuanlan.zhihu.com/p/123")).toBe("zhihu");
    expect(detectTargetPlatform("https://example.com/report.pdf")).toBe("pdf");
    expect(detectTargetPlatform("https://example.com/article")).toBe("generic");

    expect(userAgentFamily("curl/8.0.1")).toBe("curl");
    expect(userAgentFamily("python-requests/2.31")).toBe("python");
    expect(userAgentFamily("Mozilla/5.0 Chrome/120 Safari/537.36")).toBe("browser");
  });

  it("sanitizes errors and normalizes caller supplied request ids", () => {
    expect(sanitizeErrorMessage(
      "failed https://example.com/a?token=t Bearer mk_secret password=p",
    )).toBe("failed [url] Bearer [redacted] password=[redacted]");

    const req = new Request("https://md.example.com/", {
      headers: { "X-Request-ID": " req-1234567890<script> " },
    });
    expect(resolveRequestId(req)).toBe("req-1234567890script");
  });

  it("replaces sensitive caller supplied request ids", () => {
    const sensitiveIds = [
      "user@example.com",
      "Bearer mk_secret_request_token",
      "mk_secret_request_token",
      "session_abcdefghijklmnopqrstuvwxyz",
    ];

    for (const id of sensitiveIds) {
      const req = new Request("https://md.example.com/", {
        headers: { "X-Request-ID": id },
      });
      const resolved = resolveRequestId(req);
      expect(resolved).not.toBe(id);
      expect(resolved).not.toContain("example.com");
      expect(resolved).not.toContain("mk_secret_request_token");
      expect(resolved).not.toContain("session_abcdefghijklmnopqrstuvwxyz");
      expect(resolved.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("builds a sanitized event without raw url, auth, cookie, or selector data", async () => {
    const auth: AuthContext = {
      tier: "pro",
      accountId: "acct_raw_123",
      keyId: "key_raw_456",
      quotaLimit: 50000,
      quotaUsed: 10,
    };
    const request = new Request(
      "https://md.example.com/https://example.com/private?raw=true",
      {
        headers: {
          Authorization: "Bearer mk_secret",
          Cookie: "md_session=session_secret",
          "User-Agent": "curl/8.0.1",
        },
      },
    );

    const event = await buildSanitizedConversionEvent(
      { ANALYTICS_SALT: "test-salt" } as Env,
      {
        request,
        requestId: "req-12345678",
        route: "convert",
        targetUrl: "https://example.com/private?access_token=target_secret#frag",
        auth,
        format: "markdown",
        engineRequested: "jina",
        outcome: "success",
        statusCode: 200,
        latencyMs: 1234,
        methodUsed: "jina",
        cacheHit: false,
        outputChars: 2048,
        selector: ".private-profile",
        forceBrowser: false,
        noCache: false,
        creditCost: 1,
        quotaRemaining: 49989,
      },
    );

    expect(event.auth_tier).toBe("pro");
    expect(event.has_account).toBe(true);
    expect(event.has_key).toBe(true);
    expect(event.account_hash).toHaveLength(32);
    expect(event.key_hash).toHaveLength(32);
    expect(event.target_host_hash).toHaveLength(32);
    expect(event.target_url_hash).toHaveLength(32);
    expect(event.selector_present).toBe(true);
    expect(event.selector_length_bucket).toBe("1_32");

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("acct_raw_123");
    expect(serialized).not.toContain("key_raw_456");
    expect(serialized).not.toContain("mk_secret");
    expect(serialized).not.toContain("session_secret");
    expect(serialized).not.toContain("target_secret");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain(".private-profile");
  });

  it("records only allow-listed engine labels in sanitized events", async () => {
    const baseInput = {
      request: new Request("https://md.example.com/"),
      requestId: "req-engine-123",
      route: "convert" as const,
      targetUrl: "https://example.com/a",
      outcome: "success" as const,
      statusCode: 200,
      latencyMs: 10,
    };

    await expect(
      buildSanitizedConversionEvent({ ANALYTICS_SALT: "test-salt" } as Env, {
        ...baseInput,
        engineRequested: "firecrawl",
      }),
    ).resolves.toMatchObject({ engine_requested: "firecrawl" });

    await expect(
      buildSanitizedConversionEvent({ ANALYTICS_SALT: "test-salt" } as Env, {
        ...baseInput,
        engineRequested: "sk_live_secret_engine",
      }),
    ).resolves.toMatchObject({ engine_requested: "custom" });
  });

  it("does not compute durable hashes without ANALYTICS_SALT", async () => {
    const event = await buildSanitizedConversionEvent(
      {} as Env,
      {
        request: new Request("https://md.example.com/"),
        requestId: "req-12345678",
        route: "convert",
        targetUrl: "https://example.com/a?secret=s",
        outcome: "success",
        statusCode: 200,
        latencyMs: 10,
      },
    );

    expect(event.account_hash).toBe("");
    expect(event.key_hash).toBe("");
    expect(event.target_host_hash).toBe("");
    expect(event.target_url_hash).toBe("");
  });
});
