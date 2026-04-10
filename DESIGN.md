# Design System — md.genedai.me

Style: Cursor/Linear-inspired. Warm neutral tones, not stark white/black. Dense but readable. Utility language.

## Fonts

| Role | Font | Fallback | Usage |
|------|------|----------|-------|
| Display | Instrument Serif | Georgia, serif | Page titles, hero headings |
| Body | DM Sans | system-ui, sans-serif | All UI text, labels, descriptions |
| Code | JetBrains Mono | Fira Code, monospace | API keys, code snippets, usage numbers |

Load via Google Fonts: `Instrument+Serif:ital@0;1`, `DM+Sans:opsz,wght@9..40,300..700`, `JetBrains+Mono:wght@400;500`.

## Color Tokens

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg` | #f7f7f4 | #14120b | Page background |
| `--bg-surface` | #f2f1ed | #1c1a14 | Cards, panels, sidebar |
| `--bg-elevated` | #eae9e4 | #191b22 | Modals, tooltips, dropdowns |
| `--text-primary` | #26251e | #edecec | Headings, body text |
| `--text-secondary` | rgba(38,37,30,0.6) | rgba(237,236,236,0.6) | Labels, metadata |
| `--text-muted` | rgba(38,37,30,0.45) | rgba(237,236,236,0.3) | Hints, placeholders |
| `--accent` | #22d3ee | #22d3ee | Buttons, links, active states |
| `--accent-hover` | #06b6d4 | #06b6d4 | Button hover |
| `--accent-text` | #0e7490 | #22d3ee | Link text |
| `--border` | rgba(0,0,0,0.06) | rgba(255,255,255,0.06) | Dividers, borders |
| `--text-success` | #22c55e | #4ade80 | Active status, success |
| `--text-danger` | #ef4444 | #f87171 | Revoked, errors, quota exceeded |
| `--text-warning` | #f59e0b | #fbbf24 | Quota 80%+ warning |

Dark mode: `prefers-color-scheme: dark` or `data-theme="dark"`.

## Spacing & Layout

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | 4px | All border-radius (not bubbly) |
| `--max-w` | 1280px | Max content width |
| Spacing scale | 4, 8, 12, 16, 24, 32, 48, 64px | Consistent multiples of 4 |

## Component Patterns

### Buttons
- Primary: `--accent` bg, white text, `--radius`, hover `--accent-hover`
- Secondary: transparent bg, `--accent-text` text, `--border` border
- Destructive: `--text-danger` bg, white text
- All buttons: min height 36px, padding 8px 16px, DM Sans 500

### Tables / Lists
- Use `<table>` for data (keys, usage), not card grids
- Row hover: `--bg-surface`
- Zebra striping: not needed (clean enough without)

### Modals
- `--bg-elevated` background
- 480px max width, centered
- Focus trap, Esc to close (except key creation modal)

### Empty States
- Center aligned, max 320px text width
- Illustration optional (simple SVG line art matching `--text-muted`)
- Primary action button below description
- Tone: warm and helpful, not robotic

### Navigation (Portal sidebar)
- Desktop: fixed 240px left sidebar, `--bg-surface`
- Tablet (<1024px): hamburger, slide-over
- Mobile (<768px): hamburger, full-width slide-over
- Active item: `--accent` left border (2px), `--accent-text` label
- Items: text only, no icons (keeps it clean)

## Anti-Patterns (DO NOT)
- No 3-column card grids for features
- No icons in colored circles
- No purple/violet gradients
- No centered everything
- No uniform bubbly border-radius
- No emoji as design elements
- No decorative blobs or wavy SVG dividers
- `--accent` only on interactive elements, never decoration
