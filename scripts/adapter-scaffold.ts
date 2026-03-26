/**
 * Adapter scaffold — pure logic for generating adapter + test files.
 * Importable for testing; used by create-adapter.ts CLI entry point.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Valid adapter name: lowercase alphanumeric and hyphens, starting with a letter or digit. */
const VALID_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface ScaffoldResult {
  adapterPath: string;
  testPath: string;
  adapterContent: string;
  testContent: string;
  exportName: string;
  registrationHint: string;
}

/**
 * Convert a kebab-case adapter name to a camelCase export name.
 *
 * Special handling:
 * - Names starting with digits: digits are moved after the first alpha segment
 *   e.g. "36kr-video" → "kr36VideoAdapter"
 * - Normal names: standard camelCase e.g. "bilibili" → "bilibiliAdapter"
 */
export function toCamelCaseExportName(name: string): string {
  // Handle names starting with digits (e.g. "36kr" → "kr36", "36kr-video" → "kr36Video")
  const leadingDigitMatch = name.match(/^(\d+)(.+)$/);
  let normalized: string;
  if (leadingDigitMatch) {
    const digits = leadingDigitMatch[1];
    const rest = leadingDigitMatch[2];
    // Remove leading hyphen if present after digits
    const cleanRest = rest.replace(/^-/, "");
    // Split on hyphens
    const parts = cleanRest.split("-");
    // First part stays lowercase, digits appended
    parts[0] = parts[0] + digits;
    normalized = parts
      .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join("");
  } else {
    const parts = name.split("-");
    normalized = parts
      .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join("");
  }

  return normalized + "Adapter";
}

/**
 * Convert a kebab-case adapter name to a PascalCase display name.
 * e.g. "bilibili" → "Bilibili", "36kr-video" → "36krVideo"
 */
export function toDisplayName(name: string): string {
  const parts = name.split("-");
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

/**
 * Validate an adapter name.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateName(name: string, adaptersDir: string): string | null {
  if (!name) {
    return "Adapter name is required.";
  }

  if (!VALID_NAME_RE.test(name)) {
    return `Invalid adapter name "${name}". Use lowercase alphanumeric characters and hyphens only (e.g. "bilibili", "36kr-video").`;
  }

  // Check for existing adapter file
  const adapterFile = path.join(adaptersDir, `${name}.ts`);
  if (fs.existsSync(adapterFile)) {
    return `Adapter "${name}" already exists at ${adapterFile}.`;
  }

  return null;
}

/**
 * Generate the adapter source file content.
 */
export function generateAdapterContent(
  exportName: string,
  urlPattern: string,
): string {
  const safePattern = JSON.stringify(urlPattern);
  return `import type { SiteAdapter, ExtractResult } from "../../types";
import { applyStealthAndDesktop } from "../stealth";

const CONTENT_SELECTOR = "article, .article-content, .post-content, main";

export const ${exportName}: SiteAdapter = {
  match(url: string): boolean {
    return url.includes(${safePattern});
  },

  alwaysBrowser: true,

  async configurePage(page: any): Promise<void> {
    await applyStealthAndDesktop(page);
  },

  async extract(page: any): Promise<ExtractResult | null> {
    try {
      await page.waitForSelector(CONTENT_SELECTOR, { timeout: 12_000 });
    } catch {
      return null;
    }
    await new Promise((r) => setTimeout(r, 2000));
    const html = await page.content();
    return { html };
  },
};
`;
}

/**
 * Generate the test file content.
 */
export function generateTestContent(
  name: string,
  exportName: string,
  displayName: string,
  urlPattern: string,
): string {
  const safePattern = JSON.stringify(urlPattern);
  const safeTestUrl = JSON.stringify(`https://${urlPattern}some-post`);
  return `import { describe, it, expect } from "vitest";
import { ${exportName} } from "../browser/adapters/${name}";

describe("${displayName} adapter", () => {
  it("matches ${urlPattern} URLs", () => {
    expect(${exportName}.match(${safeTestUrl})).toBe(true);
  });

  it("does not match unrelated URLs", () => {
    expect(${exportName}.match("https://example.com")).toBe(false);
  });
});
`;
}

/**
 * Build the full scaffold result without writing to disk.
 * Useful for testing or dry-run mode.
 */
export function buildScaffold(
  name: string,
  urlPattern: string,
  projectRoot: string,
): ScaffoldResult {
  const exportName = toCamelCaseExportName(name);
  const displayName = toDisplayName(name);

  const adapterPath = path.join(
    projectRoot,
    "src",
    "browser",
    "adapters",
    `${name}.ts`,
  );
  const testPath = path.join(
    projectRoot,
    "src",
    "__tests__",
    `adapter-${name}.test.ts`,
  );

  const adapterContent = generateAdapterContent(exportName, urlPattern);
  const testContent = generateTestContent(
    name,
    exportName,
    displayName,
    urlPattern,
  );

  const registrationHint = [
    "",
    "Next steps — register the adapter in src/browser/index.ts:",
    "",
    `  1. Add import:  import { ${exportName} } from "./adapters/${name}";`,
    `  2. Add to the adapters array (before genericAdapter).`,
    "",
  ].join("\n");

  return {
    adapterPath,
    testPath,
    adapterContent,
    testContent,
    exportName,
    registrationHint,
  };
}

/**
 * Write scaffold files to disk.
 */
export function writeScaffold(result: ScaffoldResult): void {
  fs.writeFileSync(result.adapterPath, result.adapterContent, "utf-8");
  fs.writeFileSync(result.testPath, result.testContent, "utf-8");
}
