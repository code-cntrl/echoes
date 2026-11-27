---
name: play-test
description: Use when asked to play test Echoes, try it like a family would, or have two instances or phones talk to each other. Plays a realistic story across separate phones, notices what a person would notice, and sorts findings into bugs (fixed with a test), judgement calls (reported) and test mistakes.
---

# Play test

Read [AGENTS.md](../../../AGENTS.md). A play test uses the app the way a family would and looks for
what feels wrong, not only what throws. The model is `scripts/conversation-check.mjs`
(`npm run test:conversation`): two iPhones talk through one hub from setup to a finished
conversation. Extend it, or copy its shape, for a new story.

## Set it up like real life

- **Separate devices.** Each person gets their own browser context (separate storage, cookies and
  clock), as separate phones have. Use WebKit with `devices['iPhone 15']` for iPhones (see
  [iphone-simulation](../iphone-simulation/SKILL.md)); Edge at 1366 × 768 for a Chromebook.
- **Join like a person.** The first phone sets the family up through the UI; others join from
  the invite that opens when someone is added, as if they scanned its QR code.
- **No reloads.** Real phones aren't reloaded between messages. Put a phone down and pick it up
  again by changing what the page sees (`document.hidden` plus a `visibilitychange` event); leave
  it open to test what happens while someone is looking at it.
- **Time passes.** Move the hub's clock and every page's clock together for breaks and plan days.
  Let a few seconds pass before each screenshot so toasts from earlier steps have gone.
- **Different people.** Mix a grown-up and a kid; mix light and dark themes; try the hub and, where
  it matters, one shared device or a phone home base with a linked phone (`npm run test:peer`).

## Story

Write the story first as numbered steps in the script's comments: who does what, on which
phone, and what the other person should notice. Cover both directions: sending, noticing it
(badge, list, notification), reading, the break before replying, reacting and replying, making
and cheering a plan, asking and answering, a style that's new to that person. Add a `snap()` after
each step for a side-by-side storyboard of both screens.

## While it runs

Write down, for every step:

- what each phone shows **without being told** (badges, lists, the open screen);
- anything a person would find confusing, slow, hidden or out of date;
- every console error.

## Sort what you found

| Kind | What to do |
|---|---|
| **Bug**: the app is wrong or out of date (a badge that never updates, something counted twice, a message lost) | Fix it, add a check that fails without the fix ([mutation-check](../mutation-check/SKILL.md)), rerun |
| **Judgement call**: works as designed, but the design may be wrong (what counts as "seen") | Don't change it. Report it with what you saw and a recommendation |
| **Test mistake**: the script assumed the wrong screen or wording (kids see "Say it" and "Promises") | Fix the script; look at its saved screenshots first |
| **Flaky**: passes on a re-run | Find the race (two requests, a re-render, a tap read before the screen settled); don't hide it with waits |

A failure is often the script's fault: after sending, the app is on Sent; adding someone opens
their invite (tapping Invite again replaces it). Check the screenshot before blaming the app.

## Finish

Run the play test twice; it must pass both times. Then run the checks around what you fixed
([run-checks](../run-checks/SKILL.md)). Show the storyboard in your reply, list the bugs fixed,
and ask about each judgement call.
