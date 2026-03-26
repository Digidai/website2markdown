# @digidai/mcp-website2markdown

MCP (Model Context Protocol) Server for [website2markdown](https://github.com/Digidai/website2markdown) -- convert any web page URL to clean Markdown, optimized for AI agents and LLMs.

## Installation

```bash
npm install -g @digidai/mcp-website2markdown
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "website2markdown": {
      "command": "mcp-website2markdown",
      "env": {
        "WEBSITE2MARKDOWN_API_URL": "https://md.genedai.me",
        "WEBSITE2MARKDOWN_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "website2markdown": {
      "command": "mcp-website2markdown"
    }
  }
}
```

### Claude Code

```bash
claude mcp add website2markdown -- mcp-website2markdown
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `WEBSITE2MARKDOWN_API_URL` | Base URL of the website2markdown API | `https://md.genedai.me` |
| `WEBSITE2MARKDOWN_API_TOKEN` | Bearer token for API authentication | (none) |

## Available Tools

### `convert_url`

Convert a web page URL to clean Markdown.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | The URL to convert to Markdown |
| `format` | string | No | Output format: `markdown` (default), `html`, `text`, `json` |
| `selector` | string | No | CSS selector to extract specific content |
| `force_browser` | boolean | No | Force browser rendering for JS-heavy pages |

**Examples:**

Convert a blog post:
```
convert_url({ url: "https://example.com/blog/post" })
```

Extract only the article content:
```
convert_url({ url: "https://example.com/page", selector: "article.main" })
```

Force browser rendering for a JS-heavy page:
```
convert_url({ url: "https://spa-app.com/page", force_browser: true })
```

Get JSON output with metadata:
```
convert_url({ url: "https://example.com", format: "json" })
```

## Supported Platforms

Works with any public URL, with optimized support for:

- WeChat articles (mp.weixin.qq.com)
- Zhihu (zhihu.com)
- CSDN (csdn.net)
- Feishu/Lark documents
- X/Twitter posts
- And more

## License

Apache-2.0
