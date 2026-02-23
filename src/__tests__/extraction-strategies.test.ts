import { describe, expect, it } from "vitest";
import {
  extractWithStrategy,
  ExtractionStrategyError,
} from "../extraction/strategies";

describe("extractWithStrategy", () => {
  it("extracts structured data with css schema", () => {
    const html = `
      <div class="card"><h2>Alpha</h2><a href="/a">Read A</a></div>
      <div class="card"><h2>Beta</h2><a href="/b">Read B</a></div>
    `;

    const result = extractWithStrategy("css", html, {
      baseSelector: ".card",
      fields: [
        { name: "title", selector: "h2", type: "text" },
        { name: "url", selector: "a", type: "attribute", attribute: "href" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.strategy).toBe("css");
    expect(result.meta.itemCount).toBe(2);
    expect(result.data).toEqual([
      { title: "Alpha", url: "/a" },
      { title: "Beta", url: "/b" },
    ]);
  });

  it("extracts structured data with xpath schema", () => {
    const html = `
      <section>
        <article class="post"><h1>One</h1><a href="/one">x</a></article>
        <article class="post"><h1>Two</h1><a href="/two">y</a></article>
      </section>
    `;

    const result = extractWithStrategy("xpath", html, {
      baseXPath: "//article[@class='post']",
      fields: [
        { name: "title", xpath: ".//h1", type: "text" },
        { name: "href", xpath: ".//a", type: "attribute", attribute: "href" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.strategy).toBe("xpath");
    expect(result.meta.itemCount).toBe(2);
    expect(result.data).toEqual([
      { title: "One", href: "/one" },
      { title: "Two", href: "/two" },
    ]);
  });

  it("extracts regex matches with dedupe option", () => {
    const html = `
      Contact us at team@example.com or team@example.com.
      Backup: support@example.org
    `;

    const result = extractWithStrategy(
      "regex",
      html,
      {
        patterns: {
          emails: "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}",
        },
        flags: "gi",
      },
      { dedupe: true },
    );

    expect(result.success).toBe(true);
    expect(result.strategy).toBe("regex");
    expect(result.data).toEqual({
      emails: ["team@example.com", "support@example.org"],
    });
  });

  it("throws for unsupported xpath expression", () => {
    expect(() =>
      extractWithStrategy("xpath", "<div>ok</div>", {
        fields: [{ name: "x", xpath: "//div[@id='a' and @class='b']" }],
      }),
    ).toThrowError(ExtractionStrategyError);
  });
});

