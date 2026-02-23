import { describe, expect, it } from "vitest";
import {
  consumeProxyRetryCookies,
  createProxyRetrySignal,
  extractLegacyProxyRetryCookies,
  extractProxyRetryToken,
  redactLegacyProxyRetryMessage,
} from "../browser/proxy-retry";

describe("proxy retry token store", () => {
  it("creates tokenized retry signals and allows one-time cookie consumption", () => {
    const signal = createProxyRetrySignal([
      { name: "SID", value: "abc" },
      { name: "token", value: "xyz" },
    ]);

    expect(signal).toBeTruthy();
    expect(signal).toMatch(/^PROXY_RETRY_TOKEN:/);
    expect(signal).not.toContain("SID=abc");

    const token = extractProxyRetryToken(signal!);
    expect(token).toBeTruthy();

    const cookieHeader = consumeProxyRetryCookies(token!);
    expect(cookieHeader).toBe("SID=abc; token=xyz");
    expect(consumeProxyRetryCookies(token!)).toBeNull();
  });

  it("parses and redacts legacy retry messages safely", () => {
    const legacy = "Browser rendering failed: PROXY_RETRY:SID=abc; token=xyz";
    expect(extractLegacyProxyRetryCookies(legacy)).toBe("SID=abc; token=xyz");
    expect(redactLegacyProxyRetryMessage(legacy)).toBe(
      "Browser rendering failed: PROXY_RETRY:<redacted>",
    );
  });

  it("returns null for malformed retry signals", () => {
    expect(extractProxyRetryToken("no retry marker")).toBeNull();
    expect(extractLegacyProxyRetryCookies("PROXY_RETRY:<redacted>")).toBeNull();
  });
});
