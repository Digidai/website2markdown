import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import { convertUrl } from "../handlers/convert";
import { detectChallengePage, detectChallengeText } from "../challenge";
import { createMockEnv, mockCtx } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ARTICLE = Array.from({ length: 30 }, (_, i) =>
  `<p>Paragraph ${i + 1}: the lab's robots passed a security check before the demo, and nobody asked whether they were human.</p>`).join("");

describe("detectChallengePage", () => {
  it("names the vendor of real challenge pages", () => {
    // Trimmed from pages these sites served on 2026-11-05.
    expect(detectChallengePage(`<html><head><title>Just a moment...</title></head><body><noscript>Enable JavaScript and cookies to continue</noscript>
      <script>window._cf_chl_opt={cvId:'3'};</script><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=1"></script></body></html>`))
      .toBe("cloudflare");
    expect(detectChallengePage(`<html><head><META NAME="robots" CONTENT="noindex,nofollow"><script src="/_Incapsula_Resource?SWJIYLWA=5074a744e2e3d891814e9a2dace20bd4,719d34d31c8e3a6e6fffd425f7e032f3"></script></head><body></body></html>`))
      .toBe("imperva");
    expect(detectChallengePage(`<html><head><noscript><title>Pardon Our Interruption</title></noscript>
      <script>window.reeseSkipExpirationCheck = true; const isSpa = window.isImpervaSpaSupport;</script>
      <script>window.onProtectionInitialized = function (protection) { if (!isSpa) window.location.reload(true); };</script></head>
      <body><div class="container"><h1>Pardon Our Interruption</h1><p>MSCdirect.com is currently not available for your use.
      If you feel you have received this message in error, please call eCommerce Customer Support.</p><p>Please stand by</p></div></body></html>`))
      .toBe("imperva");
    expect(detectChallengePage(`<html><body>Request unsuccessful. Incapsula incident ID: 395000400344476801-462616682734225973</body></html>`))
      .toBe("imperva");
    expect(detectChallengePage(`<html><head><title>wsj.com</title></head><body><p>Please enable JS and disable any ad blocker</p>
      <script src="https://ct.captcha-delivery.com/c.js"></script></body></html>`))
      .toBe("datadome");
    expect(detectChallengePage(`<html><head><title>Bloomberg - Are you a robot?</title></head><body><h1>Are you a robot?</h1>
      <div id="px-captcha"></div><p>We've detected unusual activity from your computer network.</p></body></html>`))
      .toBe("perimeterx");
    expect(detectChallengePage(`<html><head><title>Security Verification</title></head><body><h2>Invalid connection</h2><h2>Connection invalide</h2></body></html>`))
      .toBe("generic");
    expect(detectChallengePage(`<html><head><title>Robot or human?</title></head><body><h1>Robot or human?</h1>
      <p>Please complete the test below to confirm that you are a human.</p><p>Request ID: nc5HWZxWSgL</p></body></html>`))
      .toBe("generic");
  });

  it("sees vendor tags split by any whitespace, and DataDome's plain notice", () => {
    expect(detectChallengePage(`<html><head><title>news.example.com</title></head><body>
      <script\nsrc="https://ct.captcha-delivery.com/c.js"></script></body></html>`)).toBe("datadome");
    expect(detectChallengeText("", [], "Please enable JS and disable any ad blocker")).toBe("datadome");
    expect(detectChallengeText("Just a moment...", [], "Enable JavaScript and cookies to continue")).toBe("generic");
    expect(detectChallengeText("", ["Security Verification"], "Security Verification Invalid connection")).toBe("generic");
  });

  it("recognises Akamai's denial with its reference number", () => {
    expect(detectChallengePage(`<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>
      You don't have permission to access "http://www.example.com/" on this server.<p>Reference #18.4f2a3b17.1793840000.1a2b3c4d</p></body></html>`))
      .toBe("akamai");
  });

  it("recognises denial pages that browsers get from Akamai-protected stores", () => {
    // Macy's: the heading names the store, the reference has no "#".
    expect(detectChallengePage(`<html><head><title>Access Denied - Macy's</title></head><body><h1>Access Denied - Macy's</h1>
      <p>You don’t have access to this page</p><p>Reference: 0.64a7cb17.1793873586.77c3d7df</p></body></html>`)).toBe("akamai");
    // Newark: an incident number in bold, repeated in three languages.
    const newark = `<p>Thanks for visiting our site. It appear that the our security software has identified something in this session that it is unsure of.</p>
      <p>Otherwise, please call us and quote the following incident number: <b>0.5bc90b17.1793873578.64ebbb98</b></p>`;
    expect(detectChallengePage(`<html><head><title>Farnell | 403 Error</title></head><body><h1>Access Denied (Error 403)</h1>${newark.repeat(3)}</body></html>`))
      .toBe("akamai");
    // Fisher Scientific: no reference, ~1,900 characters of troubleshooting.
    expect(detectChallengePage(`<html><head><title>Error 403 - Request Blocked</title></head><body><h1>Request Blocked</h1>
      <p>We could not complete your request because our security service detected activity from your request that may resemble an automated bot.</p>
      ${"<p>Disable your browser extensions and reload the page to retry Security Validation.</p>".repeat(20)}</body></html>`)).toBe("generic");
    // Home Depot's page for browsers it denies.
    expect(detectChallengePage(`<html><head><title>Error Page</title></head><body><p>#1 Home Improvement Retailer</p>
      <p>Oops!! Something went wrong. Please refresh page</p></body></html>`)).toBe("generic");
  });

  it("does not take pages about 403 errors or access denial for denial pages", () => {
    expect(detectChallengePage(`<html><head><title>Error 403 explained</title></head><body><h1>Error 403 explained</h1>
      <p>A 403 means the server understood the request and refuses it.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Access denied: why stores block bots</title></head><body><h1>Access denied</h1>
      ${"<p>Retailers resemble an automated bot farm in their own scraping. ".repeat(80)}</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>How to fix Error 403</title></head><body><h1>How to fix Error 403</h1>
      <p>Causes include wrong permissions and protection against automated requests. Reference #18.4f2a3b17 explains more.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>How to fix Error 403</title></head><body><h1>How to fix Error 403</h1>
      <p>The site's security service detected a bot? Clear cookies.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Error 403 explained</title></head><body><h1>Error 403 explained</h1>
      <p>If the security service detected automated requests, clear your cookies. Our security service detected nothing here.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Error 403 - How to fix it</title></head><body><h1>Fixing 403s</h1>
      <p>If the site's security service detected automated requests, clear your cookies and retry. Our security service detected nothing here.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Error 403 - How to fix it</title></head><body><h1>Error 403 - How to fix it</h1>
      <p>Fisher Scientific says "our security service detected activity from your request". Clear cookies and retry.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Release notes</title></head><body><h1>Release notes</h1>
      <p>Version 0.5bc90b17.1793873578.64ebbb98 is out.</p></body></html>`)).toBeNull();
  });

  it("recognises a vendor's block-page title with its block wording", () => {
    expect(detectChallengePage(`<html><head><title>Attention Required! | Cloudflare</title></head><body>
      <h1>Sorry, you have been blocked</h1><p>Cloudflare Ray ID: 8f2c</p></body></html>`)).toBe("cloudflare");
    expect(detectChallengePage(`<html><head><title>Vercel Security Checkpoint</title></head><body>
      <p>We're verifying your browser</p></body></html>`)).toBe("vercel");
  });

  it("stays linear on many unclosed comments and script tags", () => {
    for (const html of ["<!--x".repeat(60_000), "<script>x".repeat(60_000), "<textarea>".repeat(60_000),
      "<template>".repeat(60_000), '<p title="'.repeat(60_000), "<p>x".repeat(60_000), `<template>${"<p>".repeat(60_000)}`,
      `<script>${"=/x".repeat(60_000)}</script>`, `<script>${"/*x".repeat(60_000)}</script>`, `<script>${"'x".repeat(60_000)}</script>`]) {
      const started = performance.now();
      detectChallengePage(html);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });

  it("leaves real pages alone, including short ones that load a vendor script", () => {
    // An article about robots and security checks, on a Cloudflare site.
    expect(detectChallengePage(`<html><head><title>Are you a robot?</title></head><body><h1>Are you a robot?</h1>${ARTICLE}
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`)).toBeNull();
    // A short real page on an Imperva-protected shop.
    expect(detectChallengePage(`<html><head><title>Contact us</title><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></head>
      <body><h1>Contact us</h1><p>Call our sales team on 1-888-978-7759, Monday to Friday, or write to sales@example.com and we will reply within a day.</p></body></html>`))
      .toBeNull();
    expect(detectChallengePage(`<html><head><title>Short note</title></head><body><p>Back on Monday.</p></body></html>`)).toBeNull();
    // A short page titled like a block notice, but with no block wording.
    expect(detectChallengePage(`<html><head><title>Are you a robot?</title></head><body><h1>Are you a robot?</h1>
      <p>Our new exhibit lets visitors talk to six humanoid machines and guess which answers were scripted.</p></body></html>`)).toBeNull();
    // A tiny contact page on an Imperva site still has text.
    expect(detectChallengePage(`<html><head><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></head>
      <body><h1>Contact</h1><p>sales@example.com</p></body></html>`)).toBeNull();
    // Vendor names in the text a reader sees are not markup.
    expect(detectChallengePage(`<html><head><title>cf_chl_opt explained</title></head><body>
      <p>The <code>window._cf_chl_opt</code> object configures a Cloudflare challenge; DataDome loads from captcha-delivery.com.</p></body></html>`)).toBeNull();
    // Vendor names in anchors, links, and ids are not the vendor's scripts.
    expect(detectChallengePage(`<html><head><title>Notes</title></head><body><h1 id="cf_chl_opt">Notes</h1><div id="px-captcha-docs"></div>
      <p><a href="https://captcha-delivery.com/docs">DataDome docs</a></p></body></html>`)).toBeNull();
    // Nor scripts shown in a textarea or held in a template.
    expect(detectChallengePage(`<html><head><title>Example</title></head><body><h1>Example</h1>
      <textarea><script>window._cf_chl_opt={};</script></textarea><template><script>window._cf_chl_opt={};</script></template></body></html>`)).toBeNull();
    // A section heading and a technical term are not a page-level block.
    expect(detectChallengePage(`<html><head><title>API authentication guide</title></head><body><h1>API authentication guide</h1>
      <h2>Security check</h2><p>Every response carries a Request ID for support.</p></body></html>`)).toBeNull();
    // Nor script comments, nested templates, longer ids, or a vendor's title without its block wording.
    expect(detectChallengePage(`<html><head><title>Notes</title><script>/* window._cf_chl_opt = {} */ // window.gokuProps = {}
      var x = 1;</script></head><body><h1>Notes</h1><p>Back on Monday.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Notes</title></head><body><h1>Notes</h1>
      <template><template></template><script>window._cf_chl_opt={}</script></template></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Notes</title></head><body><h1>Notes</h1>
      <template><script>const end = '</template>';</script><script>window._cf_chl_opt={}</script></template></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Notes</title><script src="https://client.px-cloud.net/x/main.min.js"></script></head>
      <body><div id="px-captcha-docs"></div><p>How our captcha container works.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Vercel Security Checkpoint</title></head><body><h1>Vercel Security Checkpoint</h1>
      <p>Turn it on under Project Settings, then Firewall.</p></body></html>`)).toBeNull();
    // Nor a script in an attribute value, or the term "Request ID" without an ID.
    expect(detectChallengePage(`<html><head><title>Notes</title></head><body><h1>Notes</h1>
      <input value="<script>window._cf_chl_opt={};</script>"></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Security check</title></head><body><h1>Security check</h1>
      <p>Use the Request ID returned by the API when contacting support.</p></body></html>`)).toBeNull();
    // Nor a tag quoted in an attribute value, or Akamai's wording without a reference number.
    expect(detectChallengePage(`<html><head><title>Notes</title></head><body><h1>Notes</h1>
      <input value="<iframe src='https://geo.captcha-delivery.com/captcha/'>"></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Troubleshooting</title></head><body><h1>Troubleshooting</h1>
      <p>If you see "You don't have permission to access" with a Reference #, copy both into your ticket.</p></body></html>`)).toBeNull();
    // Nor a regex literal, or a "</template>" in a template's comment or attribute.
    expect(detectChallengePage(`<html><head><title>Rules</title><script>const pattern = /gokuProps =/; const re = /_cf_chl_opt = /i;</script></head>
      <body><h1>Rules</h1><p>Our detector rules.</p></body></html>`)).toBeNull();
    // Nor a page that only reads or describes Imperva's globals.
    expect(detectChallengePage(`<html><head><title>Bot notes</title><script>if (window.reeseSkipAutoLoad) log("reese"); const doc = "window.onProtectionInitialized = fn";</script></head>
      <body><h1>Bot notes</h1><p>Imperva sets window.reeseSkipExpirationCheck = true on its interstitial.</p></body></html>`)).toBeNull();
    // Including one after a keyword, a comment, or a condition, while a division stays a division.
    expect(detectChallengePage(`<html><head><title>Rules</title><script>if (enabled) /_cf_chl_opt =/.test(input)</script></head>
      <body><h1>Rules</h1><p>Our detector rules.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Rules</title><script>function f(b) { return /_cf_chl_opt =/.test(b) } const g = x => /* re */ /gokuProps =/;</script></head>
      <body><h1>Rules</h1><p>Our detector rules.</p></body></html>`)).toBeNull();
    expect(detectChallengePage(`<html><head><title>Just a moment...</title><script>var ratio = width / 2; window._cf_chl_opt = {cvId: '3'};</script></head>
      <body><h1>Just a moment...</h1></body></html>`)).toBe("cloudflare");
    for (const quoted of ["<!-- </template> -->", '<p title="</template>"></p>']) {
      expect(detectChallengePage(`<html><head><title>Notes</title></head><body><h1>Notes</h1>
        <template>${quoted}<script>window._cf_chl_opt={}</script></template></body></html>`)).toBeNull();
    }
    // Nor a script that only tests for the name.
    expect(detectChallengePage(`<html><head><title>Contact</title><script>if (/_cf_chl_opt/.test(body)) retry(); if (window._cf_chl_opt == null) go();</script></head>
      <body><h1>Contact</h1><p>sales@example.com</p></body></html>`)).toBeNull();
    // Nor a src quoted inside another attribute.
    expect(detectChallengePage(`<html><head><title>Notes</title><script data-example=" src='https://captcha-delivery.com/' " src="/app.js"></script></head>
      <body><h1>Notes</h1><p>Back on Monday.</p></body></html>`)).toBeNull();
    // Nor an article serialised into a hydration string.
    expect(detectChallengePage(`<html><head><title>How bot walls work</title></head><body><h1>How bot walls work</h1>
      <script>self.__next_f.push([1,"Cloudflare sets window._cf_chl_opt = {}; DataDome loads geo.captcha-delivery.com and AWS sets gokuProps."])</script></body></html>`)).toBeNull();
    // Nor does a commented-out script.
    expect(detectChallengePage(`<html><head><title>Notes</title><!-- <script>window._cf_chl_opt = {};</script> --></head>
      <body><h1>Notes</h1><p>Back on Monday.</p></body></html>`)).toBeNull();
    // A data script (JSON-LD) quoting vendor names does not run.
    expect(detectChallengePage(`<html><head><title>Bot walls</title><script type="application/ld+json">{"articleBody":"window._cf_chl_opt and captcha-delivery.com"}</script></head>
      <body><h1>Bot walls</h1><p>A short note on how challenge pages work.</p></body></html>`)).toBeNull();
    // An image-only page on an Imperva site.
    expect(detectChallengePage(`<html><head><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></head>
      <body><img src="/poster.jpg" alt=""></body></html>`)).toBeNull();
  });
});

describe("challenge pages in conversion", () => {
  it("fails a 200 challenge page instead of returning and caching it", async () => {
    const fetchMock = vi.fn(async () => new Response(
      `<html><head><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></head><body></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createMockEnv();
    const request = () => worker.fetch(new Request("https://md.example.com/https://shop.example.com/item/42", {
      headers: { Accept: "application/json" },
    }), env, mockCtx());

    const first = await request();
    const payload = await first.json() as { error?: string; message?: string; code?: string; cause?: string };
    expect(first.status).toBe(502);
    expect(payload.error).toBe("Fetch Failed");
    expect(payload).toMatchObject({ code: "target_blocked", cause: "target" });
    expect(payload.message).toContain("refuses automated access");

    // Nothing was cached: the next request goes back to the origin.
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect((await request()).status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("does not use Context.dev's browser for a caller without browser allowance", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://api.context.dev/")) return Response.json({ html: "<html><body><p>rendered</p></body></html>" });
      return new Response(`<html><head><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></head><body></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createMockEnv({ CONTEXT_DEV_API_KEY: "ctx-key" });

    await expect(convertUrl("https://shop.example.com/item/43", env, "md.example.com", "markdown", undefined, false, true,
      undefined, undefined, undefined, false, true)).rejects.toMatchObject({ statusCode: 502 });
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("https://api.context.dev/"))).toBe(false);
  });

  it("tries Jina when Firecrawl was shown the challenge too", async () => {
    const story = "The council approved the harbour plan after a long night of debate. ".repeat(4);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("firecrawl")) {
        return Response.json({ success: true, data: { markdown: "# news.example.com\n\n**Please enable JS and disable any ad blocker**", metadata: { title: "news.example.com" } } });
      }
      if (url.includes("r.jina.ai")) return Response.json({ code: 200, data: { content: `# Harbour plan\n\n${story}`, title: "Harbour plan" } });
      return new Response(`<html><head><title>Just a moment...</title></head><body>
        <script>window._cf_chl_opt={cvId:'3'};</script></body></html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }));
    const { env } = createMockEnv({ API_TOKEN: "test-token" });
    const res = await worker.fetch(new Request("https://md.example.com/https://news.example.com/harbour-plan-jina?raw=true", {
      headers: { Accept: "text/markdown", Authorization: "Bearer test-token" },
    }), env, mockCtx());

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("readability+turndown");
    expect(await res.text()).toContain("approved the harbour plan");
  });

  it("tries Jina when Firecrawl got a block page with no title", async () => {
    const story = "The council approved the harbour plan after a long night of debate. ".repeat(4);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("firecrawl")) {
        return Response.json({ success: true, data: { markdown: "You don't have permission to access \"http://news.example.com/\" on this server.\n\nReference #18.4f2a3b17.1793840000.1a2b3c4d", metadata: {} } });
      }
      if (url.includes("r.jina.ai")) return Response.json({ code: 200, data: { content: `# Harbour plan\n\n${story}`, title: "Harbour plan" } });
      return new Response(`<html><head><title>Just a moment...</title></head><body>
        <script>window._cf_chl_opt={cvId:'3'};</script></body></html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }));
    // Provider outcomes, as logged for the health stats: [path, ok].
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { env } = createMockEnv({ API_TOKEN: "test-token" });
    const res = await worker.fetch(new Request("https://md.example.com/https://news.example.com/harbour-plan-akamai?raw=true", {
      headers: { Accept: "text/markdown", Authorization: "Bearer test-token" },
    }), env, mockCtx());

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("readability+turndown");
    // Firecrawl's block page counts as its failure.
    const attempts = log.mock.calls.map(([line]) => { try { return JSON.parse(String(line)); } catch { return {}; } })
      .filter((m) => m.event === "provider.attempt").map((m) => [m.path, m.ok]);
    log.mockRestore();
    expect(attempts).toContainEqual(["firecrawl", false]);
    expect(attempts).toContainEqual(["jina", true]);
    expect(await res.text()).toContain("approved the harbour plan");
  });

  it("still lets a keyed caller's external providers read a challenged page", async () => {
    // Shorter than the challenge page's wording, and still the content.
    const story = "The council approved the harbour plan after a long night of debate. ".repeat(4);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("firecrawl")) {
        return Response.json({ success: true, data: { markdown: `# Harbour plan\n\n${story}`, metadata: { title: "Harbour plan" } } });
      }
      // DataDome's page with enough wording to convert to more than 500 characters.
      return new Response(`<html><head><title>news.example.com</title></head><body>
        <p>${"Please enable JavaScript and disable any ad blocker to continue reading. ".repeat(9)}</p>
        <script>var dd={'host':'geo.captcha-delivery.com'}</script><script src="https://ct.captcha-delivery.com/c.js"></script></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }));
    const { env } = createMockEnv({ API_TOKEN: "test-token" });
    const res = await worker.fetch(new Request("https://md.example.com/https://news.example.com/harbour-plan?raw=true", {
      headers: { Accept: "text/markdown", Authorization: "Bearer test-token" },
    }), env, mockCtx());

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Markdown-Method")).toBe("readability+turndown");
    expect(await res.text()).toContain("approved the harbour plan");
  });
});
