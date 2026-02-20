import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

// Module-level singleton — avoids re-creating on every request
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

const MAX_REGEX_INPUT_CHARS = 2_000_000;
const MAX_REGEX_LINE_LENGTH = 20_000;

// Strikethrough support
turndown.addRule("strikethrough", {
  filter: ["del", "s"],
  replacement: (content) => `~~${content}~~`,
});

// Better table handling — preserve HTML tables that Turndown can't convert well
turndown.addRule("complexTable", {
  filter: (node: any) => {
    if (node.nodeName !== "TABLE") return false;
    const html = node.innerHTML || "";
    return (
      html.includes("colspan") ||
      html.includes("rowspan") ||
      html.includes("<table")
    );
  },
  replacement: (_content: string, node: any) => {
    return "\n\n" + (node.outerHTML || "") + "\n\n";
  },
});

// Simple table support
turndown.addRule("simpleTable", {
  filter: "table",
  replacement: (_content: string, node: any) => {
    const rows = node.querySelectorAll?.("tr");
    if (!rows || rows.length === 0) return "";

    const result: string[] = [];
    let headerDone = false;

    rows.forEach((row: any) => {
      const cells = row.querySelectorAll?.("th, td") || [];
      const cellTexts: string[] = [];
      cells.forEach((cell: any) => {
        cellTexts.push(
          (cell.textContent || "").trim().replace(/\|/g, "\\|").replace(/\n/g, " "),
        );
      });
      result.push("| " + cellTexts.join(" | ") + " |");

      if (!headerDone) {
        const sep = cellTexts.map(() => "---").join(" | ");
        result.push("| " + sep + " |");
        headerDone = true;
      }
    });

    return "\n\n" + result.join("\n") + "\n\n";
  },
});

function fallbackMarkdownFromHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";

  try {
    const wrapped = trimmed.includes("<html")
      ? trimmed
      : `<html><head></head><body>${trimmed}</body></html>`;
    const { document } = parseHTML(wrapped);
    const text = (document.body?.textContent || "")
      .replace(/\r\n?/g, "\n")
      .trim();
    if (text) return text;
  } catch {
    // Fall through to raw trimmed input
  }

  return trimmed;
}

function clampRegexInput(input: string): string {
  if (!input) return "";
  const bounded =
    input.length > MAX_REGEX_INPUT_CHARS
      ? input.slice(0, MAX_REGEX_INPUT_CHARS)
      : input;
  const lines = bounded.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_REGEX_LINE_LENGTH) {
      lines[i] = lines[i].slice(0, MAX_REGEX_LINE_LENGTH);
    }
  }
  return lines.join("\n");
}

/**
 * Convert HTML to Markdown using Readability + Turndown.
 * Optionally scope extraction to a CSS selector.
 */
export function htmlToMarkdown(
  html: string,
  url: string,
  selector?: string,
): { markdown: string; title: string; contentHtml: string } {
  const sourceHtml = html || "";
  if (!sourceHtml.trim()) {
    return { markdown: "", title: "", contentHtml: "" };
  }

  // Ensure full document structure
  const wrappedHtml = sourceHtml.includes("<html")
    ? sourceHtml
    : `<html><head></head><body>${sourceHtml}</body></html>`;

  let document: any;
  try {
    ({ document } = parseHTML(wrappedHtml));
  } catch {
    return {
      markdown: fallbackMarkdownFromHtml(sourceHtml),
      title: "",
      contentHtml: sourceHtml,
    };
  }

  // Set <base> for Readability to resolve relative links
  try {
    const existingBase = document.querySelector("base");
    if (existingBase) {
      existingBase.href = url;
    } else if (document.head) {
      const base = document.createElement("base");
      base.href = url;
      document.head.appendChild(base);
    }
  } catch {
    // Ignore if head is not available
  }

  let contentHtml = sourceHtml;
  let title = "";
  try {
    title = document.title || "";
  } catch {
    /* no title */
  }

  // If a CSS selector is specified, extract only that element
  if (selector) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        contentHtml = (el as any).innerHTML || (el as any).outerHTML || html;
      }
    } catch {
      // Invalid selector — fall through to full page
    }
  }

  // Try Readability to extract main content (skip if selector was used)
  if (!selector) {
    try {
      const reader = new Readability(document.cloneNode(true) as any);
      const article = reader.parse();
      if (article && article.content) {
        contentHtml = article.content;
        title = article.title || title;
      }
    } catch {
      // Readability failed, fall through to convert full HTML
    }
  }

  if (!contentHtml.trim()) {
    const cleanEmptyTitle = title.replace(/[\r\n]+/g, " ").trim();
    return {
      markdown: cleanEmptyTitle ? `# ${cleanEmptyTitle}` : "",
      title,
      contentHtml: "",
    };
  }

  // Parse content into DOM so Turndown receives a node (not a string)
  let markdown = "";
  try {
    const { document: contentDoc } = parseHTML(
      `<html><body>${contentHtml}</body></html>`,
    );
    markdown = turndown.turndown(contentDoc.body as any);
  } catch {
    markdown = fallbackMarkdownFromHtml(contentHtml);
  }

  if (!markdown.trim()) {
    markdown = fallbackMarkdownFromHtml(contentHtml);
  }

  // Prepend title as H1 if available and not already present
  const cleanTitle = title.replace(/[\r\n]+/g, " ").trim();
  if (cleanTitle && !markdown.startsWith(`# ${cleanTitle}\n`)) {
    markdown = `# ${cleanTitle}\n\n${markdown}`;
  }

  return { markdown, title, contentHtml };
}

/**
 * Convert HTML to plain text (strip all formatting).
 */
export function htmlToText(html: string, url: string): string {
  const { markdown } = htmlToMarkdown(html, url);
  const boundedMarkdown = clampRegexInput(markdown);
  if (!boundedMarkdown.trim()) return "";
  // Strip markdown formatting
  return boundedMarkdown
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s/gm, "")
    .replace(/^\d+\.\s/gm, "")
    .replace(/^>\s/gm, "");
}

/** Rewrite hotlink-protected image URLs to go through our /img/ proxy. */
export function proxyImageUrls(
  markdown: string,
  proxyHost: string,
): string {
  return markdown.replace(
    /!\[([^\]]*)\]\((https?:\/\/mmbiz\.qpic\.cn\/[^)]+)\)/g,
    (_match, alt, imgUrl) =>
      `![${alt}](https://${proxyHost}/img/${encodeURIComponent(imgUrl)})`,
  );
}
