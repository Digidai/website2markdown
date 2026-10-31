# Design system — md.genedai.me

The public pages use [HeroUI v3](https://heroui.com) with its default theme. Do not add a custom palette, fonts, or radius scale. When something looks off, first check whether a HeroUI component or token already covers it.

## Stack

- Pages are React components in `web/`. The Worker renders them with `renderToString` (`web/server.tsx`). Each page family has its own browser entry in `web/entries/` (landing, portal, reader), which hydrates only its own views through `web/client.tsx`. Shared code goes into common chunks.
- Vite builds the client bundle to `web-dist/_app/` (served as static assets) and the SSR module to `web-server-dist/server.js`. Wrangler runs `npm run build:web` before `dev` and `deploy`.
- Styles: `web/styles.css` imports Tailwind CSS 4 and `@heroui/styles`. Icons come from `@gravity-ui/icons`.
- Copy for both languages lives in `web/copy.ts`.
- The `/admin` dashboard still uses `src/templates/theme.ts`.

## Rules

- Use HeroUI compound components (`Card`, `Tabs`, `Accordion`, `Table`, `TextField`, `Dropdown`, `Modal`, `Meter`) instead of hand-built equivalents. Links that look like buttons use `buttonVariants` on an `<a>`.
- Use semantic tokens only: `bg-background`, `bg-surface`, `bg-surface-secondary`, `text-foreground`, `text-muted`, `border-border`, `border-separator`, `bg-accent`, `text-accent-foreground`, `text-success`, `text-danger`, `text-warning`. Never use raw hex values or Tailwind palette colors.
- Keep HeroUI's default component padding and radius.
- Rendered Markdown uses `Typography.Prose`. The reader adds vertical rhythm with `flex flex-col gap-4` (as in the HeroUI docs) and bordered table cells, since Prose has no table styles.
- Content width is `max-w-6xl`. The reading column is `max-w-3xl`.

## Theme

`THEME_BOOT_SCRIPT` in `web/contract.ts` runs before paint. It reads `localStorage["heroui-theme"]` (`light`, `dark`, or unset for system) and sets the `dark` class and `data-theme` on `<html>`. The theme switcher in the header writes the same key through HeroUI's `useTheme`.

## Accessibility

- Icon-only buttons need an `aria-label` that says what they do, for example `Theme: System`.
- The current language link carries `aria-current="true"`.
- Every page must work at 375px wide with no horizontal scroll.
