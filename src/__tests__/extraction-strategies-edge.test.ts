import { describe, expect, it } from "vitest";

import {
  ExtractionStrategyError,
  extractWithStrategy,
} from "../extraction/strategies";

function expectStrategyErrorCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`Expected strategy error with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExtractionStrategyError);
    expect((error as ExtractionStrategyError).code).toBe(code);
  }
}

describe("extractWithStrategy edge cases", () => {
  it("rejects non-string html input", () => {
    expectStrategyErrorCode(() => {
      extractWithStrategy("css", 42 as unknown as string, {
        fields: [{ name: "title", selector: "h1" }],
      });
    }, "INVALID_REQUEST");
  });

  it("rejects html inputs above the safety size limit", () => {
    const hugeHtml = "x".repeat(2_000_001);
    expectStrategyErrorCode(() => {
      extractWithStrategy("regex", hugeHtml, { patterns: { sample: "x+" } });
    }, "INVALID_REQUEST");
  });

  it("handles regex schema normalization and invalid values", () => {
    const ok = extractWithStrategy("regex", "id=42 id=7", {
      ids: "id=(\\d+)",
    });
    expect(ok.data).toEqual({ ids: ["42", "7"] });

    expectStrategyErrorCode(() => {
      extractWithStrategy("regex", "x", {
        ids: 123 as unknown as string,
      });
    }, "INVALID_SCHEMA");
  });

  it("rejects invalid regex patterns and avoids zero-length loops", () => {
    expectStrategyErrorCode(() => {
      extractWithStrategy("regex", "sample", { patterns: { bad: "(+" } });
    }, "INVALID_SCHEMA");

    const zeroLength = extractWithStrategy("regex", "aaa", {
      patterns: { lookahead: "(?=a)" },
      flags: "g",
    });
    expect(zeroLength.data).toEqual({ lookahead: [] });
  });

  it("rejects empty regex patterns and match explosions", () => {
    expectStrategyErrorCode(() => {
      extractWithStrategy("regex", "x", { patterns: {} });
    }, "INVALID_SCHEMA");

    expectStrategyErrorCode(() => {
      extractWithStrategy("regex", "x", { patterns: { bad: "" } });
    }, "INVALID_SCHEMA");

    const dense = Array.from({ length: 1002 }, () => "x").join(" ");
    expectStrategyErrorCode(() => {
      extractWithStrategy("regex", dense, {
        patterns: { hits: "x" },
        flags: "g",
      });
    }, "INVALID_REQUEST");
  });

  it("maps invalid CSS selectors to INVALID_SCHEMA", () => {
    expectStrategyErrorCode(() => {
      extractWithStrategy("css", "<div><h1>Title</h1></div>", {
        fields: [{ name: "title", selector: "h1[" }],
      });
    }, "INVALID_SCHEMA");
  });

  it("falls back to default root when selector roots are missing", () => {
    const cssResult = extractWithStrategy(
      "css",
      "<article><h1>Alpha</h1></article>",
      {
        fields: [{ name: "title", selector: "h1", type: "text" }],
      },
      undefined,
      ".not-found-root",
    );
    expect(cssResult.data).toEqual({ title: "Alpha" });

    const xpathResult = extractWithStrategy(
      "xpath",
      "<article><h1>Beta</h1></article>",
      {
        baseXPath: "//section[@id='missing']",
        fields: [{ name: "title", selector: "h1", type: "text" }],
      },
    );
    expect(xpathResult.data).toEqual([{ title: "Beta" }]);
  });

  it("supports xpath selector fallback and html/multiple field extraction", () => {
    const result = extractWithStrategy(
      "xpath",
      `
      <section class="root">
        <p><b>One</b></p>
        <p>Two</p>
        <a href="/go">Go</a>
      </section>
      `,
      {
        fields: [
          { name: "paragraphs", selector: "p", type: "html", multiple: true },
          { name: "href", xpath: ".//a", type: "attribute", attribute: "href" },
        ],
      },
      undefined,
      ".root",
    );

    expect(result.data).toEqual({
      paragraphs: ["<b>One</b>", "Two"],
      href: "/go",
    });
    expect(result.meta.matches).toBe(3);
  });

  it("rejects unsupported extraction strategies at runtime", () => {
    expectStrategyErrorCode(() => {
      extractWithStrategy("llm" as unknown as "css", "<h1>x</h1>", {});
    }, "UNSUPPORTED_STRATEGY");
  });
});
