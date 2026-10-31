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

// Language-tagged code blocks — handles <pre data-lang="xxx"> from WeChat adapter
turndown.addRule("langCodeBlock", {
  filter: (node: any) => {
    return node.nodeName === "PRE" && node.getAttribute?.("data-lang");
  },
  replacement: (_content: string, node: any) => {
    const lang = node.getAttribute("data-lang") || "";
    const code = node.querySelector?.("code");
    const text = (code ? code.textContent : node.textContent) || "";
    return `\n\n\`\`\`${lang}\n${text.replace(/\n+$/, "")}\n\`\`\`\n\n`;
  },
});

const CELL_BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "DL", "DT", "DD", "TABLE", "TR", "H1", "H2", "H3", "H4", "H5", "H6"]);

// Cell text where <br> and block boundaries become "\n" and other whitespace collapses.
function cellLines(node: any): string {
  let out = "";
  node.childNodes?.forEach((child: any) => {
    if (child.nodeType === 3) {
      out += (child.textContent || "").replace(/\s+/g, " ");
    } else if (child.nodeType === 1) {
      const tag = child.nodeName;
      if (tag === "BR") out += "\n";
      else if (tag === "SCRIPT" || tag === "STYLE") return;
      else if (CELL_BLOCK_TAGS.has(tag)) out += `\n${cellLines(child)}\n`;
      else out += cellLines(child);
    }
  });
  return out;
}

// Table support. A line break inside a cell is written as <br>, the GFM
// convention, since a raw newline would end the row. A colspan cell is
// followed by empty cells, and every row is padded to the widest row,
// because GFM drops cells beyond the header width.
turndown.addRule("simpleTable", {
  filter: "table",
  replacement: (_content: string, node: any) => {
    const rows = node.querySelectorAll?.("tr");
    if (!rows || rows.length === 0) return "";

    const table: string[][] = [];
    rows.forEach((row: any) => {
      const cells = row.querySelectorAll?.("th, td") || [];
      const cellTexts: string[] = [];
      cells.forEach((cell: any) => {
        cellTexts.push(
          cellLines(cell)
            .split("\n")
            .map((part) => part.trim())
            .filter(Boolean)
            .join("<br>")
            .replace(/\|/g, "\\|"),
        );
        const span = Math.min(Math.max(Number(cell.getAttribute?.("colspan")) || 1, 1), 50);
        for (let i = 1; i < span; i++) cellTexts.push("");
      });
      // Skip rows whose cells are all empty, such as image-only infobox rows.
      if (cellTexts.some(Boolean)) table.push(cellTexts);
    });
    if (table.length === 0) return "";

    const width = table.reduce((max, cells) => Math.max(max, cells.length), 1);
    const line = (cells: string[]) =>
      "| " + [...cells, ...Array(width - cells.length).fill("")].join(" | ") + " |";
    const result = table.map(line);
    result.splice(1, 0, line(Array(width).fill("---")));

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
export function htmlToText(
  html: string,
  url: string,
  selector?: string,
): string {
  const { markdown } = htmlToMarkdown(html, url, selector);
  const boundedMarkdown = clampRegexInput(markdown);
  if (!boundedMarkdown.trim()) return "";
  // Strip markdown formatting (use negated character classes to avoid ReDoS)
  return boundedMarkdown
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s/gm, "")
    .replace(/^\d+\.\s/gm, "")
    .replace(/^>\s/gm, "");
}

/** Rewrite hotlink-protected image URLs in Markdown or HTML to go through our /img/ proxy. */
export function proxyImageUrls(
  content: string,
  proxyHost: string,
): string {
  // Markdown images: ![alt](https://mmbiz.qpic.cn/...)
  let result = content.replace(
    /!\[([^\]]*)\]\((https?:\/\/mmbiz\.qpic\.cn\/[^)]+)\)/g,
    (_match, alt, imgUrl) =>
      `![${alt}](https://${proxyHost}/img/${encodeURIComponent(imgUrl)})`,
  );
  // HTML img tags: <img ... src="https://mmbiz.qpic.cn/..." ...>
  result = result.replace(
    /(<img\b[^>]*\bsrc=["'])(https?:\/\/mmbiz\.qpic\.cn\/[^"']+)(["'][^>]*>)/gi,
    (_match, prefix, imgUrl, suffix) =>
      `${prefix}https://${proxyHost}/img/${encodeURIComponent(imgUrl)}${suffix}`,
  );
  return result;
}
