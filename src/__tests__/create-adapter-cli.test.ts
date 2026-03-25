import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  validateName,
  buildScaffold,
  toCamelCaseExportName,
  generateAdapterContent,
  generateTestContent,
  toDisplayName,
} from "../../scripts/adapter-scaffold";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const ADAPTERS_DIR = path.join(PROJECT_ROOT, "src", "browser", "adapters");

describe("Adapter scaffold CLI", () => {
  it("generates adapter file with correct content for valid inputs", () => {
    const result = buildScaffold("bilibili", "bilibili.com/video/", PROJECT_ROOT);

    expect(result.adapterContent).toContain('import type { SiteAdapter, ExtractResult }');
    expect(result.adapterContent).toContain('export const bilibiliAdapter: SiteAdapter');
    expect(result.adapterContent).toContain('return url.includes("bilibili.com/video/")');
    expect(result.adapterContent).toContain("alwaysBrowser: true");
    expect(result.adapterContent).toContain("applyStealthAndDesktop");
    expect(result.adapterPath).toContain(path.join("src", "browser", "adapters", "bilibili.ts"));
  });

  it("generates test file with correct content", () => {
    const result = buildScaffold("bilibili", "bilibili.com/video/", PROJECT_ROOT);

    expect(result.testContent).toContain('import { bilibiliAdapter }');
    expect(result.testContent).toContain('from "../browser/adapters/bilibili"');
    expect(result.testContent).toContain('describe("Bilibili adapter"');
    expect(result.testContent).toContain('bilibiliAdapter.match("https://bilibili.com/video/some-post")');
    expect(result.testContent).toContain("toBe(true)");
    expect(result.testContent).toContain("toBe(false)");
    expect(result.testPath).toContain(path.join("src", "__tests__", "adapter-bilibili.test.ts"));
  });

  it("rejects invalid adapter name (spaces, special chars)", () => {
    expect(validateName("my adapter", ADAPTERS_DIR)).toMatch(/Invalid adapter name/);
    expect(validateName("my_adapter", ADAPTERS_DIR)).toMatch(/Invalid adapter name/);
    expect(validateName("My.Adapter", ADAPTERS_DIR)).toMatch(/Invalid adapter name/);
    expect(validateName("test@site", ADAPTERS_DIR)).toMatch(/Invalid adapter name/);
    expect(validateName("", ADAPTERS_DIR)).toMatch(/required/);
  });

  it("rejects duplicate adapter name (already exists in adapters dir)", () => {
    // "juejin" adapter already exists in src/browser/adapters/
    const error = validateName("juejin", ADAPTERS_DIR);
    expect(error).toMatch(/already exists/);
  });

  it("uses correct camelCase export name", () => {
    expect(toCamelCaseExportName("bilibili")).toBe("bilibiliAdapter");
    expect(toCamelCaseExportName("36kr-video")).toBe("kr36VideoAdapter");
    expect(toCamelCaseExportName("my-cool-site")).toBe("myCoolSiteAdapter");
    expect(toCamelCaseExportName("36kr")).toBe("kr36Adapter");
    expect(toCamelCaseExportName("x")).toBe("xAdapter");
  });
});
