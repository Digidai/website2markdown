import { describe, it, expect } from "vitest";
import {
  isSafeUrl,
  isValidUrl,
  needsBrowserRendering,
  extractTargetUrl,
  escapeHtml,
} from "../security";

describe("isSafeUrl", () => {
  it("blocks localhost", () => {
    expect(isSafeUrl("http://localhost/foo")).toBe(false);
    expect(isSafeUrl("http://localhost:3000")).toBe(false);
  });

  it("blocks 127.0.0.1", () => {
    expect(isSafeUrl("http://127.0.0.1")).toBe(false);
    expect(isSafeUrl("http://127.0.0.1:8080/path")).toBe(false);
  });

  it("blocks IPv6 loopback", () => {
    expect(isSafeUrl("http://[::1]")).toBe(false);
    expect(isSafeUrl("http://[::1]:8080")).toBe(false);
  });

  it("blocks IPv6 loopback full form", () => {
    expect(isSafeUrl("http://[0:0:0:0:0:0:0:1]")).toBe(false);
    expect(isSafeUrl("http://[0000:0000:0000:0000:0000:0000:0000:0001]")).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 addresses", () => {
    expect(isSafeUrl("http://[::ffff:127.0.0.1]")).toBe(false);
    expect(isSafeUrl("http://[::ffff:10.0.0.1]")).toBe(false);
    expect(isSafeUrl("http://[::ffff:169.254.169.254]")).toBe(false);
    expect(isSafeUrl("http://[::ffff:192.168.1.1]")).toBe(false);
    expect(isSafeUrl("http://[::ffff:172.16.0.1]")).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 in hex form", () => {
    // ::ffff:7f00:0001 = 127.0.0.1
    expect(isSafeUrl("http://[::ffff:7f00:1]")).toBe(false);
    // ::ffff:0a00:0001 = 10.0.0.1
    expect(isSafeUrl("http://[::ffff:a00:1]")).toBe(false);
    // ::ffff:c0a8:0101 = 192.168.1.1
    expect(isSafeUrl("http://[::ffff:c0a8:101]")).toBe(false);
  });

  it("allows valid IPv4-mapped IPv6 public addresses", () => {
    // ::ffff:8.8.8.8 (Google DNS, public)
    expect(isSafeUrl("http://[::ffff:8.8.8.8]")).toBe(true);
  });

  it("blocks private IPv4 ranges", () => {
    expect(isSafeUrl("http://10.0.0.1")).toBe(false);
    expect(isSafeUrl("http://10.255.255.255")).toBe(false);
    expect(isSafeUrl("http://172.16.0.1")).toBe(false);
    expect(isSafeUrl("http://172.31.255.255")).toBe(false);
    expect(isSafeUrl("http://192.168.0.1")).toBe(false);
    expect(isSafeUrl("http://192.168.255.255")).toBe(false);
  });

  it("blocks AWS metadata endpoint", () => {
    expect(isSafeUrl("http://169.254.169.254")).toBe(false);
    expect(isSafeUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("blocks link-local IPv4", () => {
    expect(isSafeUrl("http://169.254.1.1")).toBe(false);
  });

  it("blocks FQDN trailing dot bypass (localhost.)", () => {
    expect(isSafeUrl("http://localhost.")).toBe(false);
    expect(isSafeUrl("http://localhost.:8080")).toBe(false);
  });

  it("blocks IPv4-compatible IPv6 without ffff (::7f00:1 = 127.0.0.1)", () => {
    expect(isSafeUrl("http://[::7f00:1]")).toBe(false);
    // ::a00:1 = 10.0.0.1
    expect(isSafeUrl("http://[::a00:1]")).toBe(false);
    // ::c0a8:101 = 192.168.1.1
    expect(isSafeUrl("http://[::c0a8:101]")).toBe(false);
  });

  it("blocks .local and .internal domains", () => {
    expect(isSafeUrl("http://myservice.local")).toBe(false);
    expect(isSafeUrl("http://api.internal")).toBe(false);
    expect(isSafeUrl("http://test.localhost")).toBe(false);
  });

  it("allows valid public URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("https://mp.weixin.qq.com/s/abc123")).toBe(true);
    expect(isSafeUrl("https://172.32.0.1")).toBe(true); // not in 172.16-31 range
    expect(isSafeUrl("http://192.169.0.1")).toBe(true); // not 192.168.x.x
  });

  it("blocks non-http protocols", () => {
    expect(isSafeUrl("ftp://example.com")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isSafeUrl("not a url")).toBe(false);
    expect(isSafeUrl("")).toBe(false);
  });
});

describe("isValidUrl", () => {
  it("accepts http and https", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  it("rejects other protocols", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(isValidUrl("not-a-url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });

  it("rejects URLs exceeding max length", () => {
    const longUrl = "https://example.com/" + "a".repeat(5000);
    expect(isValidUrl(longUrl)).toBe(false);
  });
});

describe("needsBrowserRendering", () => {
  it("detects Cloudflare challenges", () => {
    expect(needsBrowserRendering('<div id="cf-challenge">...</div>', "https://example.com")).toBe(true);
    expect(needsBrowserRendering('<script>cf_chl_opt={}</script>', "https://example.com")).toBe(true);
  });

  it("detects CAPTCHA on short pages", () => {
    expect(needsBrowserRendering('<div class="captcha">solve me</div>', "https://example.com")).toBe(true);
  });

  it("does not flag CAPTCHA on long pages", () => {
    const longPage = '<html><body>captcha' + 'x'.repeat(20000) + '</body></html>';
    expect(needsBrowserRendering(longPage, "https://example.com")).toBe(false);
  });

  it("detects JS redirects in script tags on short pages", () => {
    expect(needsBrowserRendering('<script>document.location="/"</script>', "https://example.com")).toBe(true);
    expect(needsBrowserRendering('<script>window.location.href="/"</script>', "https://example.com")).toBe(true);
  });

  it("does not flag normal pages with analytics containing document.location", () => {
    // Longer page with document.location in analytics — should NOT trigger
    const normalPage = '<html><body>' + '<p>content</p>'.repeat(50) +
      '<script>ga("send", document.location.href)</script></body></html>';
    expect(needsBrowserRendering(normalPage, "https://example.com")).toBe(false);
  });

  it("does not flag normal pages", () => {
    const normalPage = '<html><body>' + '<p>content</p>'.repeat(100) + '</body></html>';
    expect(needsBrowserRendering(normalPage, "https://example.com")).toBe(false);
  });
});

describe("extractTargetUrl", () => {
  it("extracts https URL from path", () => {
    expect(extractTargetUrl("/https://example.com/page", "")).toBe("https://example.com/page");
  });

  it("extracts http URL from path", () => {
    expect(extractTargetUrl("/http://example.com", "")).toBe("http://example.com");
  });

  it("auto-prepends https for bare domains", () => {
    expect(extractTargetUrl("/example.com", "")).toBe("https://example.com");
    expect(extractTargetUrl("/example.com/path", "")).toBe("https://example.com/path");
  });

  it("returns null for empty path", () => {
    expect(extractTargetUrl("/", "")).toBeNull();
  });

  it("treats dotted path as domain (favicon.ico has a dot)", () => {
    // favicon.ico has a dot, so it gets treated as a bare domain
    // The main handler checks /favicon.ico separately before calling extractTargetUrl
    expect(extractTargetUrl("/favicon.ico", "")).toBe("https://favicon.ico");
  });

  it("returns null for paths without dots", () => {
    expect(extractTargetUrl("/about", "")).toBeNull();
    expect(extractTargetUrl("/api", "")).toBeNull();
  });

  it("strips our query params but keeps target params", () => {
    const result = extractTargetUrl("/https://example.com", "?raw=true&force_browser=true&foo=bar");
    expect(result).toBe("https://example.com?foo=bar");
  });

  it("also strips no_cache, format, selector params", () => {
    const result = extractTargetUrl("/https://example.com", "?no_cache=true&format=json&selector=.main&key=val");
    expect(result).toBe("https://example.com?key=val");
  });
});

describe("escapeHtml", () => {
  it("escapes all special characters", () => {
    expect(escapeHtml('<script>alert("xss")&</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&amp;&lt;/script&gt;",
    );
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#039;s");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });
});
