# Echoes design contract

How the app looks and adapts across devices. The project skills in
[`.agents/skills`](../.agents/skills/README.md) follow this file. Mock images and old
screenshots are history; this file wins where they differ.

## The look

- **After iOS Messages, Reminders and Settings:** large titles, flat grouped panels with hairline
  separators, small grey section labels, round contact-style pictures and one accent used
  sparingly. No gradients or soft drop shadows in the layout.
- **Three theme families**, each with light and dark: **Messages** (the default), **Graphite** and
  **Paper**. Mode follows the system unless set to Light or Dark in the top-bar picker. All
  colours are tokens in `public/styles.css`: `--bg`, `--surface`, `--surface-2`, `--text`, `--muted`,
  `--border`, `--control-edge`, `--accent`, `--accent-text`, `--accent-soft`, `--good`/`--warn`/`--bad`
  with `-soft` fills, `--radius` and `--radius-control`. Every text pair meets WCAG AA (4.5:1),
  controls and the focus ring 3:1; `test/themes.test.js` checks each pair in every theme.
- **Icons:** thin line icons from `icon()` in `public/ui/dom.js`. Emoji only for people's faces,
  feelings, reactions, feedback styles, kids' picture promises and stickers.
- **Kid mode** (a kid is signed in) is bigger: larger type, tiles, chips and buttons. Same structure.
- **No inline `style` attributes.** The hub's Content-Security-Policy blocks them; use classes.

### Shared components

| Component | Class or helper | Use |
|---|---|---|
| Grouped list | `.list` with `.item` rows | Settings-style rows, members, finished plans, inbox rows (`.list.msgs`) |
| Section label | `.label` | Small uppercase heading above a list or card |
| Card | `.card` | A flat panel; `.stack` spaces its children |
| Segmented control | `.segmented` (buttons or radio labels) | One row of 2 or 3 choices; names stay on one line from 320px up |
| Chips | `.chip`, `.chip.radio` | Reactions, feelings, cheers, quick choices |
| Contact tiles | `.tile` (button or radio label) | Picking people |
| Quiet label | `.pill` | Status words with a hairline, never a coloured blob |
| Notice | `.notice`, `.notice.error` | Messages and errors in the flow |
| Empty state | `emptyState()` | A line icon in a circle, a title, a sentence, one action |

## Form factors

Check every visible change at these three reference viewports, in light and dark. They are
assumptions for testing, not measurements of anyone's device. Also check a 320px-wide phone
for anything that might wrap.

| Form factor | Reference viewport (CSS px) | Layout |
|---|---|---|
| Phone | 390 × 844 | Bottom tab bar, one column, 1rem page padding |
| Unfolded foldable or tablet | 744 × 900 | Bottom tab bar up to 760px wide; from 761px a top navigation bar. One column, up to 720px |
| Laptop or desktop | 1440 × 1000 (a Chromebook is often 1366 × 768) | From 1100px: top navigation, page up to 1200px, two columns |

### What the wide layout does (1100px and up)

| Screen | Left | Right |
|---|---|---|
| Inbox | Questions for you, replies and reactions, then the message list | A reading pane for the selected message or question. Nothing opens by itself, because opening a message starts its break. Narrower screens open a question in place, under its row |
| Give | To, people and style. In **Ask** mode: your question, who to ask, and how they should answer | The composer, which stays in view while you scroll. In Ask mode: Send it (who, style, the anonymous option) and What they'll see |
| Plans | Plan cards in two columns | |
| Sent | Message cards in two columns | |
| Family | Members, the home base or hub, and notifications | Add someone, family settings and your profile |
| Guide | Habits, audiences, anonymity, asking for feedback, getting feedback | Feedback styles |
| Make a plan | The message, and what you'll do | How long, a kid's helper, who can see it, Start |

Sign-in, setup, welcome and sync stay in one narrow column at every size.

### Parity rules

- **Nothing is lost at any size.** Every content item, action and state exists on phone, tablet
  and desktop. A control may move (for example into the reading pane) but never disappear.
- **Same reading order.** Two columns read left column first, then right, which is the same
  order as the one-column layout.
- **Resizing keeps your place.** The open message, reply drafts, the message being written,
  selections and the current screen survive a window or device-orientation change.
- **Touch targets:** on phones and tablets, buttons, list rows and tab-bar items are at least 44px tall;
  chips are 36px and segmented controls 32px, as on iPhone.

## Layout and alignment

- One **content edge** per column: titles, labels' text, cards and lists start on it.
- Rows put their leading glyph (avatar, icon square) in a fixed column, so text starts on a
  shared **text edge**; trailing chevrons, dates and pills end on a shared **trailing edge**.
- Spacing comes from a small scale (4, 8, 12, 16, 20, 24, 32px). An offset under 8px between
  things that should line up reads as a mistake: fix the shared structure, not with a one-off
  margin.
- [edges.mjs](../.agents/skills/measure-layout/scripts/edges.mjs) measures a rendered view: its
  edges, near misses, sideways scrolling and tap targets, drawn over a screenshot; see
  [measure-layout](../.agents/skills/measure-layout/SKILL.md).

## Verifying a visible change

- Use headless Microsoft Edge (`chromium.launch({ channel: 'msedge', headless: true })` with
  `playwright-core`), in a separate automation context. Never the user's own browser or settings.
- Show the result as **one board per affected screen and state**: phone, foldable/tablet and
  desktop, each **dark view directly above its matching light view**.
- `npm test`, `npm run test:browser`, `npm run test:layout`, `npm run test:plans`,
  `npm run test:peer`, `npm run test:asks`, `npm run test:styles`, `npm run test:iphone` and
  `npm run screenshots` must pass; `test:layout` measures the three
  form factors (no sideways scrolling, two columns on desktop, the reading pane, state kept
  across a resize).
