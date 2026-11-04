// 格式转换辅助函数

import type { ConvertMethod, OutputFormat } from "../types";
import { escapeHtml } from "../security";

/** Convert native markdown to a minimal safe HTML response. */
export function markdownToBasicHtml(markdown: string): string {
  return `<pre>${escapeHtml(markdown)}</pre>`;
}

/** Convert markdown to plain text while preserving the final extracted content. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```[\t ]*[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Offset just past the title: a leading ATX "# " heading line or a Setext "===" heading. */
function titleEnd(text: string): number {
  let start = 0;
  while (start < text.length && text[start].trim() === "") start++;
  const lineEnd = text.indexOf("\n", start);
  const end = lineEnd === -1 ? text.length : lineEnd;
  if (text[start] === "#" && (text[start + 1] === " " || text[start + 1] === "\t")) return end;
  if (lineEnd === -1 || text[lineEnd + 1] !== "=") return 0;
  let next = lineEnd + 1;
  while (text[next] === "=") next++;
  return text[next] === undefined || text[next] === "\n" || text[next].trim() === "" ? next : 0;
}

/**
 * Non-whitespace characters in a converted markdown body, not counting its
 * title or the URLs of links and images. The empty-result rule in
 * chargedCreditCost uses it. It is measured on the markdown before
 * formatting, so every output format gets the same count, and it is a single
 * linear scan because the body is untrusted. Counting stops at `stopAt`.
 */
export function markdownBodyChars(markdown: string, stopAt = 10_000): number {
  let count = 0;
  let inFence = false;
  let inCode = false;
  let unclosedTarget = false;
  for (let i = titleEnd(markdown); i < markdown.length; i++) {
    const ch = markdown[i];
    if (ch === "`" && markdown[i + 1] === "`" && markdown[i + 2] === "`") {
      inFence = !inFence;
      count += 3;
      i += 2;
      continue;
    }
    if (ch === "`" && !inFence) inCode = !inCode;
    // Skip a link or image target, with balanced and escaped parentheses, but
    // not in code. Once a target never closes, none after it can either, so
    // the scan stays linear.
    if (ch === "]" && markdown[i + 1] === "(" && !inFence && !inCode && !unclosedTarget) {
      let depth = 0;
      let j = i + 1;
      for (; j < markdown.length; j++) {
        if (markdown[j] === "\\") j++;
        else if (markdown[j] === "(") depth++;
        else if (markdown[j] === ")" && --depth === 0) break;
      }
      if (j < markdown.length) { i = j; continue; }
      unclosedTarget = true;
    }
    if (ch.trim() === "") continue;
    if (++count >= stopAt) return count;
  }
  return count;
}

/**
 * 统一的格式输出函数，合并原来散布在多处的 switch(format) 逻辑。
 * 将 markdown 内容按指定 format 转换为最终输出字符串。
 */
export function formatOutput(
  markdown: string,
  format: OutputFormat,
  url: string,
  title: string,
  method: ConvertMethod,
  timestamp?: string,
): string {
  const ts = timestamp || new Date().toISOString();
  switch (format) {
    case "html":
      return markdownToBasicHtml(markdown);
    case "text":
      return markdownToPlainText(markdown);
    case "json":
      return JSON.stringify({
        url, title, markdown, method,
        timestamp: ts,
      });
    default:
      return markdown;
  }
}
