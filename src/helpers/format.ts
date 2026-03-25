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
