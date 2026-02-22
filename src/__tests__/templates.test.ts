import { describe, expect, it } from "vitest";
import { landingPageHTML } from "../templates/landing";
import { renderedPageHTML } from "../templates/rendered";
import { loadingPageHTML } from "../templates/loading";
import { errorPageHTML } from "../templates/error";

describe("templates", () => {
  it("escapes host in landing page", () => {
    const html = landingPageHTML('md.example.com"><script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes title and message in error page", () => {
    const html = errorPageHTML("Oops <b>x</b>", 'Bad "msg" <img src=x>');
    expect(html).toContain("Oops &lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("Bad &quot;msg&quot; &lt;img src=x&gt;");
    expect(html).not.toContain("<img src=x>");
  });

  it("renders loading page with encoded stream URL config", () => {
    const html = loadingPageHTML(
      "md.example.com",
      "https://example.com/path?q=<x>",
      "&selector=.main",
    );
    expect(html).toContain("/api/stream?url=");
    expect(html).toContain('/https%3A%2F%2Fexample.com%2Fpath%3Fq%3D%3Cx%3E?raw=true');
    expect(html).toContain("\\u003c");
    expect(html).toContain("selector=.main");
  });

  it("escapes rendered content and metadata", () => {
    const html = renderedPageHTML(
      "md.example.com",
      '# title\n\n<script>alert("x")</script>',
      'https://example.com/"x"',
      "123",
      "fallback",
      true,
      'Art "Title"',
    );
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("Art &quot;Title&quot;");
    expect(html).toContain("CACHED");
    expect(html).toContain('/https%3A%2F%2Fexample.com%2F%22x%22?raw=true');
    expect(html).not.toContain('<script>alert("x")</script>');
  });
});
