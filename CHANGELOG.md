# Changelog

## [1.0.0] - 2026-03-26

### Added
- **Modular architecture**: refactored monolithic index.ts (4995 lines) into 14 focused modules
- **MCP Server**: `@digidai/mcp-website2markdown` npm package with `convert_url` tool
- **Agent Skills**: [website2markdown-skills](https://github.com/Digidai/website2markdown-skills) repo for Claude Code, OpenClaw, and other agents
- **llms.txt**: AI discoverability at `/llms.txt` and `/.well-known/llms.txt` with KV cache
- **Adapter scaffold CLI**: `scripts/create-adapter.ts` generates adapter + test boilerplate
- **robots.txt + sitemap.xml**: SEO endpoints
- **Landing page redesign**: 3-tab architecture (Home/Docs/Integration), Cursor-style design, dark mode, bilingual EN/ZH, Schema.org FAQPage/HowTo/SoftwareApplication
- **npm publish workflow**: GitHub Actions on `mcp-v*` tag

### Fixed
- 3 pre-existing test failures (deepcrawl checkpoint, jobs idempotency, stale task)
- SSRF protection in `fetchTargetLlmsTxt` (redirect: error)
- Adapter scaffold URL pattern injection (JSON.stringify escaping)
- MCP SDK version compatibility (zod 4 alignment)
- Dark mode CSS variable leak via `data-theme` attribute on theme toggle buttons

### Changed
- `formatOutput()` consolidated from 4 scattered switch blocks into single helper
- Deep crawl checkpoint config no longer includes `maxDepth`/`maxPages` (operational limits)

### Security
- wrangler.toml KV namespace ID replaced with placeholder for open source
- MCP response body size limit (10MB)
- Negative llms.txt cache uses 1h TTL (vs 24h for positive) to recover from transient errors

## [0.x] - Pre-release

All development prior to open source launch. See [git history](https://github.com/Digidai/website2markdown/commits/main) for details.
