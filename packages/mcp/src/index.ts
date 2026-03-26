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

const paramsSchema = {
  url: z.string().describe("The URL to convert to Markdown"),
  format: z.enum(["markdown", "html", "text", "json"]).optional().default("markdown").describe("Output format"),
  selector: z.string().optional().describe("CSS selector to extract specific content"),
  force_browser: z.boolean().optional().default(false).describe("Force browser rendering for JS-heavy pages"),
};

server.tool(
  "convert_url",
  "Convert a web page URL to clean Markdown. Supports any public URL including Chinese platforms (WeChat, Zhihu, CSDN, etc.)",
  paramsSchema,
  async (args: { url: string; format?: string; selector?: string; force_browser?: boolean }) => {
    return convertUrl({
      url: args.url,
      format: (args.format ?? "markdown") as "markdown" | "html" | "text" | "json",
      selector: args.selector,
      force_browser: args.force_browser ?? false,
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
