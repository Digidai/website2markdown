# Contributing

Thanks for contributing to `md-genedai` / `website2markdown`.

This project is maintained by a solo maintainer. During the open-source launch period, pull requests are typically reviewed within 1 week.

## Development Setup

Requirements:

- Node.js with npm
- Cloudflare Workers tooling through the repo's local dependencies

Install dependencies:

```bash
npm install
```

Start local development:

```bash
npm run dev
```

Run the test suite:

```bash
npm test
```

Useful extra checks before opening a PR:

```bash
npm run typecheck
npm run test:coverage
```

## Development Principles

- Keep changes focused. Small, well-scoped PRs are easier to review and merge.
- Match the existing architecture and naming patterns instead of introducing parallel abstractions.
- This codebase uses TypeScript `strict` mode. New code should compile cleanly without weakening type safety.
- Follow the existing style in `src/` rather than reformatting unrelated files.

## Adding a New Site Adapter

Site adapters live in `src/browser/adapters/`. Follow the existing adapter shape defined by `SiteAdapter` in `src/types.ts`.

Typical steps:

1. Add a new adapter file in `src/browser/adapters/`.
2. Implement the standard adapter surface:
   - `match(url)`
   - `alwaysBrowser`
   - `configurePage(page, capturedImages?)`
   - `extract(page, capturedImages)`
   - optional `postProcess(html)`
   - optional `transformUrl(url)`
   - optional `fetchDirect(url)`
3. Register the adapter in `src/browser/index.ts`.
4. Keep `genericAdapter` last in the adapter list.
5. Reuse existing patterns from current adapters instead of inventing a new lifecycle.

Guidelines:

- Keep URL matching narrow and deterministic.
- Prefer the simplest working path:
  - use `transformUrl` when a stable alternate URL is enough
  - use `fetchDirect` only when an API-style path is clearly better than browser rendering
  - use `postProcess` for HTML cleanup that should happen before Readability/Turndown
- Avoid adapter-specific behavior in unrelated modules unless it is broadly reusable.
- If the adapter needs browser rendering, keep `configurePage` minimal and site-specific.

### Adapter Tests Are Required

Adapter PRs must include tests.

At minimum, add or update tests in the existing adapter test suites:

- `src/__tests__/adapters.test.ts`
- `src/__tests__/adapters-behavior.test.ts`
- `src/__tests__/adapters-edge.test.ts`

Choose the right coverage for the adapter:

- URL matching and `alwaysBrowser`
- `transformUrl` behavior
- `postProcess` behavior
- `fetchDirect` behavior
- edge cases specific to the target site

## Pull Request Process

1. Fork the repository.
2. Create a topic branch from your fork.
3. Make your changes.
4. Run tests locally.
5. Open a pull request with a clear description of the change and why it is needed.

Recommended branch naming:

- `feat/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`

Before opening a PR, make sure:

- `npm test` passes
- any adapter change includes tests
- the change matches existing patterns
- docs are updated if behavior or supported sites changed

## Code Style

- Use TypeScript idiomatically and keep `strict` compatibility.
- Prefer explicit, readable control flow over clever abstractions.
- Preserve current module boundaries and file responsibilities.
- Avoid unrelated refactors in the same PR.
- Keep comments concise and only where they add real context.

## Reporting Problems and Discussing Changes

- For bugs and feature requests, use GitHub issues.
- For security reports, do not open a public issue. Follow `SECURITY.md`.
