# Design system — md.genedai.me

A reading tool, not a launch page. One cool paper and ink palette, one sans for the interface, a serif only in the article you are reading, and a single press blue for actions and links.

## Fonts

| Role | Font | Fallback | Usage |
|------|------|----------|-------|
| UI | Source Sans 3 | PingFang SC, Noto Sans SC, system-ui | All interface text, in both languages |
| Reading | Source Serif 4 | Songti SC, Noto Serif SC, Georgia | Rendered Markdown only |
| Code | IBM Plex Mono | Sarasa Mono SC, ui-monospace | URLs, commands, usage numbers |

Load from Google Fonts. Do not use a display serif in the UI. Chinese and English share the same sans so the rhythm stays even.

## Color

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg` | #f3f4f6 | #14171c | Page background |
| `--bg-surface` | #ffffff | #1c2027 | Inputs, code, panels |
| `--bg-elevated` | #e7eaee | #262b34 | Inset blocks |
| `--text-primary` | #1c2128 | #e7e9ed | Headings and body |
| `--text-secondary` | #3d4654 | #c5cbd4 | Supporting copy |
| `--text-muted` | #5c6573 | #9aa3b2 | Hints. Must stay readable |
| `--accent` | #1b4f8a | #c5d8f5 | Buttons, current nav, links |
| `--border` | #d0d5dc | #3a4250 | Rules and field borders |
| `--danger` | #a3262c | #f0a8a8 | Errors |
| `--success` | #1a6b45 | #8dcea9 | Completed steps, cache hit |
| `--warning` | #8a5a12 | #e6c48a | Fallback methods |

Dark mode follows `prefers-color-scheme`, or `data-theme` when the visitor picks Light or Dark. The choice is stored in `localStorage` under `theme` and applies on the home page, the reader, the loading page, errors, and the portal.

## Layout

- Content width 1120px. Reading column about 44rem.
- Radius 4px. Borders are visible. No blur, no glow, no gradient washes.
- Accent color is for actions and the current section, not for decoration.
- Numbers use tabular figures.

## Interaction

- Every control has a visible `:focus-visible` ring.
- Pressed buttons move down 1px.
- Loading, empty, and error states say what happened and what to do next.
- Motion is the press of a control and the spinner while a conversion runs. The homepage states the API. It does not play a tour.
- Do not hide content until it scrolls into view.

## Do not

- Italicize one word in a headline.
- Use three equal icon cards, pill tags, or fake browser windows.
- Use emoji, star ratings, or made-up success rates.
- Use uppercase tracked labels.
- Use a different palette on the reader, the error page, or the portal.
