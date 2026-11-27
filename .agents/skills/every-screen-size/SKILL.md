---
name: every-screen-size
description: Use when building an approved, visible Echoes change (a screen, a control, a layout) so it works on a phone, an unfolded foldable or tablet, and a desktop or Chromebook, in light and dark, without losing anything a person can see or do at any size.
---

# Build for every screen size

Echoes runs on a family's iPhones, the odd tablet and a Chromebook or laptop. A change is done when
it works on all of them. Read [AGENTS.md](../../../AGENTS.md) and [docs/design.md](../../../docs/design.md)
first: the design contract says what each screen does at each size and wins over old screenshots.

## Before you start

Have an approved design (a chosen mock from [design-options](../design-options/SKILL.md), or a
direct instruction like "make the desktop wider"). Write down, for the screens you're touching:
what's on them, every action, and what a person may have in progress (a draft, an open message,
a selection). That list is what must survive every size.

## While building

- **Start from what's there.** Use the shared pieces in `public/styles.css` (lists and rows, cards,
  chips, segmented controls, tiles, pills, notices) and its colour and spacing variables. If a
  screen needs something new, make it a shared piece and add it to the design contract.
- **One idea, three layouts.** Phone: one column, tab bar at the bottom. Foldable or tablet
  (around 744 wide): one wider column. Desktop (1100 and up): two columns where the contract says,
  such as the Inbox list beside its reading pane. Things may move between them; nothing may
  disappear.
- **Read in the same order.** On two columns, the left one comes first, so the reading order
  matches the phone.
- **Keep people's place.** Turning a phone or resizing a window keeps drafts, the open message,
  selections and the current screen. Layouts drawn by script (the reading pane) re-draw from the
  same state when the breakpoint changes.
- **Touch first.** On phones and tablets, things you tap are at least 44px tall; chips 36px and
  segmented controls 32px. Segmented controls stay on one line down to a 320px-wide phone.
- **Both themes, all three families.** Check light and dark in Messages; spot-check Graphite and
  Paper. Never invert colours to make a dark version.
- **Kids too.** Kid profiles get bigger text and different words (Say it, Promises). Check them.
- **No inline styles.** The Content-Security-Policy blocks `style="…"`; use classes.

## Check it

1. `npm run test:layout` measures all three sizes in both themes: no sideways scrolling, columns,
   the reading pane, 44px targets, state kept across a resize. Extend it when you add a screen.
2. Measure the screens you changed with [measure-layout](../measure-layout/SKILL.md).
3. Run the checks for what you touched ([run-checks](../run-checks/SKILL.md)).
4. Show the result: one picture per changed screen and state, with phone, foldable and desktop
   side by side, each dark view directly above its light view. Look at it before sending it.
