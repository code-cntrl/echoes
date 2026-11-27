---
name: design-mocks
description: Use when asked for Echoes mocks, mockups, wireframes, a redesign or "show me what it could look like". Proposals only, never edits to the app. Starts from fresh screenshots of the real app with demo data, draws each idea on top of the real screens at every size in light and dark, measures their alignment, and delivers one side-by-side comparison per state with today's screen first.
---

# Design mocks

A mock shows a change to the app as it is today. It is drawn on the real screens, so people
compare like with like. Read [AGENTS.md](../../../AGENTS.md) and
[docs/design.md](../../../docs/design.md) first.

## Ground rules

- **Mocks don't change the app.** Don't edit anything under `public/`, `src/`, the tests or the
  design contract to make a mock. Draw in a separate headless page and keep everything in the
  session's own files folder, not the project.
- **Building waits for an explicit go-ahead** naming an option ("build option 2"). Liking an
  option, earlier approvals or being in autopilot don't count. To ask which one, use
  [design-options](../design-options/SKILL.md).
- **Demo data only.** Never open the family's real data: opening a message starts its break and
  marks it read.

## 1. Capture today's screens

Run the app with demo data: a throwaway hub (`createApp({ dataPath: ':memory:' })` seeded through
the API, as the checks in `scripts/` do), or the demo hub (`$env:DATA_PATH='data\demo.json'; npm start`).
Use headless Edge from `playwright-core`; never a visible browser or the user's own.

Capture each screen in scope at **phone 390 × 844, foldable 744 × 900 and desktop 1440 × 1000**,
in **dark and light**, plus any states the idea touches (a kid's view, an open message, an empty
list). Wait for the real content; a sign-in screen or a spinner isn't a capture. Open and look at
every image.

If the app won't run or a state can't be reached, say exactly what failed and stop. Don't draw
from memory or old screenshots.

## 2. List what's on screen

From the captures, list every part of each screen (header, tabs, headings, rows, cards, chips,
buttons, notices, the reading pane on desktop) and note what each size already does differently.
Every option must say what happens to each part, at each size, in each theme: kept, moved, or
changed on purpose. Nothing may silently disappear on the phone because only the desktop was
looked at.

Measure today's screens with [measure-layout](../measure-layout/SKILL.md) so you know their edges
and any existing near misses before adding your own.

## 3. Draw the options

- Make **three** options unless asked for another number, each clearly different.
- Draw each by changing the real page in the headless browser (its HTML with the app's own
  classes and `public/styles.css`), not by building a new imitation screen. Change only the area
  being redesigned.
- Use the app's own pieces, colours, spacing and 44px touch targets. Keep segmented controls on
  one line at 320px. Keep contrast readable in both themes and in kid mode.
- Render every option at all three sizes in dark and light, open each picture, compare it with
  today's screen and the list from step 2, and fix anything lost, clipped or accidental.
- Measure every option with [measure-layout](../measure-layout/SKILL.md): fix each near miss or
  note why it's right.
- Keep one script for captures and one for drawing, each taking the option, size, theme and state,
  so a fix re-renders only what changed.

## 4. One comparison per state

For each state, make **one picture**: rows for phone, foldable and desktop; in each row, today's
screen on the left and the options to its right in the same order every time; each dark view
directly above its light view. Label everything. Don't send separate pictures of single options.
Look at the finished picture before sending it, and embed it in the reply.

## Done when

- Today's screens were captured fresh at three sizes and two themes, and looked at.
- Every part of every screen has a treatment in every option, size and theme.
- Every option was measured and its near misses fixed or explained.
- Each state has one comparison picture, today's screen first, both themes.
- The reply says what each option changes and what it leaves out, and that nothing is built yet.
