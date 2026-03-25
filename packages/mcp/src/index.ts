#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { convertUrl } from "./convert.js";

const API_URL = process.env.WEBSITE2MARKDOWN_API_URL || "https://md.genedai.me";
const API_TOKEN = process.env.WEBSITE2MARKDOWN_API_TOKEN || "";

const server = new McpServer({
  name: "website2markdown",
  version: "0.1.0",
});

server.tool(
  "convert_url",
  "Convert a web page URL to clean Markdown. Supports any public URL including Chinese platforms (WeChat, Zhihu, CSDN, etc.)",
  {
    url: z.string().url().describe("The URL to convert to Markdown"),
    format: z.enum(["markdown", "html", "text", "json"]).optional().default("markdown").describe("Output format"),
    selector: z.string().optional().describe("CSS selector to extract specific content"),
    force_browser: z.boolean().optional().default(false).describe("Force browser rendering for JS-heavy pages"),
  },
  async ({ url, format, selector, force_browser }) => {
    return convertUrl({
      url,
      format: format ?? "markdown",
      selector,
      force_browser: force_browser ?? false,
      apiUrl: API_URL,
      apiToken: API_TOKEN,
    });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
