---
name: measure-layout
description: Use when an Echoes layout needs checking on the real rendered page rather than by reading code - after a visible change, while drawing mocks, or when something "looks a bit off". Measures edges, near misses, sideways scrolling and tap-target sizes with scripts/edges.mjs, and points to the browser checks that guard each size.
---

# Measure the layout

A layout is right when the rendered page is, not when the CSS looks plausible. Measure the real
page in headless Edge. Read [the design contract](../../../docs/design.md#layout-and-alignment)
for the rules being measured.

## Quick measurement: `edges.mjs`

[scripts/edges.mjs](scripts/edges.mjs) opens a view and reports:

- the **left and right edges** its text and boxes line up on (a tidy view uses only a few: the
  content edge, the text edge after avatars and icons, the trailing edge);
- **near misses**: two edges 1 to 6px apart that overlap vertically, which nearly always should
  be one edge;
- **sideways scrolling**;
- **small tap targets**: under 44px, or 36px for chips and 32px for segmented controls.

It also saves a picture with shared edges in blue and near misses in red.

```powershell
node .agents/skills/measure-layout/scripts/edges.mjs http://localhost:3000 --size phone --theme dark
node .agents/skills/measure-layout/scripts/edges.mjs <url> --size desk --scope main --out <folder> --strict
```

Options: `--size phone|fold|desk|<width>x<height>`, `--theme light|dark`, `--scope` (the CSS selector
to measure, default `main`), `--tolerance` (px, default 6), `--wait <selector>`, `--name`, `--out`
(default a temp folder), `--strict` (exit code 1 on a near miss or sideways scrolling).

The command line reaches what a URL shows (usually sign-in). For a signed-in screen, set the view
up in a script and call it there:

```js
import { measureEdges, drawEdges, summarize, SIZES } from './.agents/skills/measure-layout/scripts/edges.mjs';
const report = await measureEdges(page, { scope: 'main' });
console.log(summarize(report, 'Inbox, phone, dark'));
await drawEdges(page, report, 'inbox.edges.png');
```

## Reading the report

- **Look at the picture.** The numbers say where; the picture says whether it matters.
- **A near miss** is fixed in the shared structure (the row, list or card padding), not with a
  one-off margin on one element. If two edges really should differ (a nested list), say why.
- **Several edges close together** in one column usually mean two kinds of row that should share
  a glyph column. Compare the rows.
- **Small targets** matter on phones and tablets; on desktop they are a note.
- Glyphs centred in circles, pills and chips are measured by their box, and wrapped paragraphs
  don't count as right edges, so those don't show up as noise.

## The checks that guard layouts

| Check | Measures |
|---|---|
| `npm run test:layout` | Phone, foldable and desktop, both themes: sideways scrolling, page width, columns, the reading pane, 44px targets, state kept across a resize |
| `npm run test:browser` | Every theme family and mode, the browser bar colour, focus rings, selected states |
| `npm run test:iphone` | Safari's engine at iPhone size |
| `npm run screenshots` | The main walkthrough at iPhone and Chromebook sizes |

When a measurement finds something a check should have caught, add it to the check that owns the
screen ([write-browser-check](../write-browser-check/SKILL.md)). Measuring headlessly never
authorizes publishing anything.
