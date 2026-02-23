import { parseHTML } from "linkedom";
import type {
  ExtractionErrorCode,
  ExtractionFieldSchema,
  ExtractionOptions,
  ExtractionResult,
  ExtractionSchema,
  ExtractionStrategyType,
  RegexExtractionSchema,
  StructuredExtractionSchema,
} from "../types";

const DEFAULT_REGEX_FLAGS = "g";
const MAX_HTML_INPUT_BYTES = 2_000_000;

export class ExtractionStrategyError extends Error {
  code: ExtractionErrorCode;
  details?: Record<string, unknown>;

  constructor(
    code: ExtractionErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExtractionStrategyError";
    this.code = code;
    this.details = details;
  }
}

function ensureHtmlWithinLimit(html: string): void {
  const size = new TextEncoder().encode(html).byteLength;
  if (size > MAX_HTML_INPUT_BYTES) {
    throw new ExtractionStrategyError(
      "INVALID_REQUEST",
      `Input HTML is too large (max ${MAX_HTML_INPUT_BYTES} bytes).`,
      { size, max: MAX_HTML_INPUT_BYTES },
    );
  }
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function escapeCssIdentifier(value: string): string {
  return value.replace(/([^A-Za-z0-9_-])/g, "\\$1");
}

function queryByCss(root: any, selector: string): any[] {
  if (!selector || typeof selector !== "string") return [];
  if (!root?.querySelectorAll) return [];
  return Array.from(root.querySelectorAll(selector) || []);
}

function splitXpath(xpath: string): Array<{ axis: "child" | "descendant"; step: string }> {
  const out: Array<{ axis: "child" | "descendant"; step: string }> = [];
  let rest = xpath.trim();
  let axis: "child" | "descendant" = "child";

  if (rest.startsWith(".")) rest = rest.slice(1);
  while (rest.length > 0) {
    if (rest.startsWith("//")) {
      axis = "descendant";
      rest = rest.slice(2);
      continue;
    }
    if (rest.startsWith("/")) {
      axis = "child";
      rest = rest.slice(1);
      continue;
    }

    let idx = -1;
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === "[") depth += 1;
      if (ch === "]") depth = Math.max(0, depth - 1);
      if (depth === 0 && ch === "/") {
        idx = i;
        break;
      }
    }

    const step = (idx === -1 ? rest : rest.slice(0, idx)).trim();
    if (step) out.push({ axis, step });
    rest = idx === -1 ? "" : rest.slice(idx);
    axis = "child";
  }

  return out;
}

function xpathStepToCss(step: string): string | null {
  if (!step || step === ".") return null;
  if (step === "text()") return null;

  const match = step.match(/^([A-Za-z_][\w:-]*|\*)(?:\[(.+)\])?$/);
  if (!match) return null;

  const tag = match[1];
  const predicate = match[2]?.trim();
  let css = tag === "*" ? "*" : tag;

  if (!predicate) return css;

  const nth = predicate.match(/^(\d+)$/);
  if (nth) {
    return `${css}:nth-of-type(${nth[1]})`;
  }

  const attrEq = predicate.match(/^@([A-Za-z_][\w:-]*)\s*=\s*['"]([^'"]+)['"]$/);
  if (attrEq) {
    const attr = attrEq[1];
    const val = attrEq[2];
    if (attr === "id") return `${css}#${escapeCssIdentifier(val)}`;
    if (attr === "class") {
      const classTokens = val.trim().split(/\s+/).filter(Boolean);
      if (classTokens.length === 1) return `${css}.${escapeCssIdentifier(classTokens[0])}`;
      return `${css}[class="${val.replace(/"/g, '\\"')}"]`;
    }
    return `${css}[${attr}="${val.replace(/"/g, '\\"')}"]`;
  }

  const contains = predicate.match(
    /^contains\(\s*@([A-Za-z_][\w:-]*)\s*,\s*['"]([^'"]+)['"]\s*\)$/,
  );
  if (contains) {
    const attr = contains[1];
    const val = contains[2];
    if (attr === "class") {
      return `${css}[class*="${val.replace(/"/g, '\\"')}"]`;
    }
    return `${css}[${attr}*="${val.replace(/"/g, '\\"')}"]`;
  }

  return null;
}

function xpathToCss(xpath: string): string | null {
  const trimmed = xpath.trim();
  if (!trimmed) return null;

  const steps = splitXpath(trimmed);
  if (steps.length === 0) return null;

  let css = "";
  for (let i = 0; i < steps.length; i++) {
    const converted = xpathStepToCss(steps[i].step);
    if (!converted) {
      if (steps[i].step === "text()") continue;
      return null;
    }
    if (!css) {
      css = converted;
      continue;
    }
    css += steps[i].axis === "descendant" ? ` ${converted}` : ` > ${converted}`;
  }

  return css || null;
}

function queryByXpath(root: any, xpath: string): any[] {
  const css = xpathToCss(xpath);
  if (!css) {
    throw new ExtractionStrategyError(
      "UNSUPPORTED_XPATH",
      "Unsupported XPath expression. Use a simpler path with tag/predicate steps.",
      { xpath },
    );
  }
  return queryByCss(root, css);
}

function readFieldValue(node: any, field: ExtractionFieldSchema): string {
  const fieldType = field.type || "text";
  if (fieldType === "html") {
    return (node?.innerHTML || node?.outerHTML || "").trim();
  }
  if (fieldType === "attribute") {
    const attr = field.attribute || "href";
    const raw = node?.getAttribute?.(attr);
    return typeof raw === "string" ? raw.trim() : "";
  }
  return normalizeWhitespace(String(node?.textContent || ""));
}

function normalizeStructuredSchema(schema: ExtractionSchema): StructuredExtractionSchema {
  if (!schema || typeof schema !== "object") {
    throw new ExtractionStrategyError(
      "INVALID_SCHEMA",
      "Schema must be an object for css/xpath extraction.",
    );
  }
  const casted = schema as Partial<StructuredExtractionSchema>;
  if (!Array.isArray(casted.fields) || casted.fields.length === 0) {
    throw new ExtractionStrategyError(
      "INVALID_SCHEMA",
      "Schema.fields must be a non-empty array.",
    );
  }
  for (const field of casted.fields) {
    if (!field || typeof field !== "object" || typeof field.name !== "string" || !field.name) {
      throw new ExtractionStrategyError(
        "INVALID_SCHEMA",
        "Each schema field must include a non-empty name.",
      );
    }
  }
  return casted as StructuredExtractionSchema;
}

function countMatches(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.length > 0 ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((acc, v) => acc + countMatches(v), 0);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .reduce<number>((acc, v) => acc + countMatches(v), 0);
  }
  return 1;
}

function extractStructured(
  strategy: ExtractionStrategyType,
  html: string,
  schema: StructuredExtractionSchema,
  requestSelector?: string,
): unknown {
  const wrapped = html.includes("<html")
    ? html
    : `<html><head></head><body>${html}</body></html>`;
  const { document } = parseHTML(wrapped);

  const defaultRoot = document.body || document.documentElement || document;
  let roots: any[] = [defaultRoot];

  if (strategy === "css") {
    const rootSelector = schema.baseSelector || requestSelector;
    if (rootSelector) {
      const matched = queryByCss(document, rootSelector);
      roots = matched.length > 0 ? matched : [defaultRoot];
    }
  } else if (strategy === "xpath") {
    if (schema.baseXPath) {
      const matched = queryByXpath(document, schema.baseXPath);
      roots = matched.length > 0 ? matched : [defaultRoot];
    } else if (requestSelector) {
      const matched = queryByCss(document, requestSelector);
      roots = matched.length > 0 ? matched : [defaultRoot];
    }
  }

  const rows = roots.map((rootNode) => {
    const row: Record<string, unknown> = {};
    for (const field of schema.fields) {
      let nodes: any[] = [];
      if (strategy === "css") {
        if (field.selector) {
          nodes = queryByCss(rootNode, field.selector);
        } else if (field.xpath) {
          nodes = queryByXpath(rootNode, field.xpath);
        } else {
          nodes = [rootNode];
        }
      } else {
        if (field.xpath) {
          nodes = queryByXpath(rootNode, field.xpath);
        } else if (field.selector) {
          nodes = queryByCss(rootNode, field.selector);
        } else {
          nodes = [rootNode];
        }
      }

      if (field.multiple) {
        row[field.name] = nodes.map((node) => readFieldValue(node, field)).filter(Boolean);
      } else {
        row[field.name] = nodes.length > 0 ? readFieldValue(nodes[0], field) : "";
      }
    }
    return row;
  });

  if (rows.length === 1 && !schema.baseSelector && !schema.baseXPath) {
    return rows[0];
  }
  return rows;
}

function normalizeRegexSchema(schema: ExtractionSchema): RegexExtractionSchema {
  if (!schema || typeof schema !== "object") {
    throw new ExtractionStrategyError("INVALID_SCHEMA", "Regex schema must be an object.");
  }

  const maybeRegexSchema = schema as Partial<RegexExtractionSchema>;
  if (maybeRegexSchema.patterns && typeof maybeRegexSchema.patterns === "object") {
    return {
      patterns: maybeRegexSchema.patterns,
      flags: maybeRegexSchema.flags,
    };
  }

  const record = schema as Record<string, unknown>;
  const patterns: Record<string, string> = {};
  for (const [label, pattern] of Object.entries(record)) {
    if (typeof pattern !== "string") {
      throw new ExtractionStrategyError(
        "INVALID_SCHEMA",
        "Regex schema values must be strings.",
        { label },
      );
    }
    patterns[label] = pattern;
  }

  return { patterns };
}

function extractRegex(
  html: string,
  schema: RegexExtractionSchema,
  options?: ExtractionOptions,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const dedupe = options?.dedupe === true;
  const flagsBase = options?.regexFlags || schema.flags || DEFAULT_REGEX_FLAGS;
  const flags = flagsBase.includes("g") ? flagsBase : `${flagsBase}g`;

  for (const [label, pattern] of Object.entries(schema.patterns)) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (error) {
      throw new ExtractionStrategyError(
        "INVALID_SCHEMA",
        "Regex pattern could not be compiled.",
        { label, pattern, error: error instanceof Error ? error.message : String(error) },
      );
    }

    const hits: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const captured = match.slice(1).find((item) => typeof item === "string" && item.length > 0);
      const value = normalizeWhitespace((captured || match[0] || "").trim());
      if (value) hits.push(value);
      if (match[0] === "") regex.lastIndex += 1;
    }

    result[label] = dedupe ? Array.from(new Set(hits)) : hits;
  }

  return result;
}

export function extractWithStrategy(
  strategy: ExtractionStrategyType,
  html: string,
  schema: ExtractionSchema,
  options?: ExtractionOptions,
  selector?: string,
): ExtractionResult {
  const startedAt = Date.now();
  if (!html || typeof html !== "string") {
    throw new ExtractionStrategyError("INVALID_REQUEST", "Extraction input html must be a string.");
  }
  ensureHtmlWithinLimit(html);

  let data: unknown;
  if (strategy === "css" || strategy === "xpath") {
    const normalized = normalizeStructuredSchema(schema);
    data = extractStructured(strategy, html, normalized, selector);
  } else if (strategy === "regex") {
    const normalized = normalizeRegexSchema(schema);
    data = extractRegex(html, normalized, options);
  } else {
    throw new ExtractionStrategyError(
      "UNSUPPORTED_STRATEGY",
      `Unsupported extraction strategy: ${String(strategy)}`,
      { strategy },
    );
  }

  const durationMs = Date.now() - startedAt;
  const itemCount = Array.isArray(data) ? data.length : 1;
  return {
    success: true,
    strategy,
    data,
    meta: {
      itemCount,
      matches: countMatches(data),
      durationMs,
    },
  };
}
