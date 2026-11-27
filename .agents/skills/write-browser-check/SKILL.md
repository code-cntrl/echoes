---
name: write-browser-check
description: Use when an Echoes feature needs a new headless browser check (npm run test:<name>), or an existing one needs extending. Covers the in-memory hub, signing people in, moving time, dark-above-light boards at three sizes, console errors, and registering and documenting the check. Comes with a runnable template.
---

# Write a browser check

Read [AGENTS.md](../../../AGENTS.md) and
[the design contract](../../../docs/design.md#verifying-a-visible-change). Extend the check that
already owns the behaviour when there is one ([run-checks](../run-checks/SKILL.md) lists them);
add a new one only for a new feature or journey.

Start from [templates/check-template.mjs](templates/check-template.mjs): copy it to
`scripts/<name>-check.mjs`, then replace the example journey. It runs as it is.

## Rules the template follows

- **Throwaway hub.** `createApp({ dataPath: ':memory:', now })` from `src/server.js`, listening
  on `127.0.0.1:0`. Never `data/family.json`.
- **Seed through the API**, not the UI, unless the UI is what you are testing: a small `client()`
  keeps a cookie per person. Each person keeps at most **20 sign-ins**; a check that opens many
  pages for one person must sign its API client in again when told "Please sign in" (the
  template's `as()` does).
- **Signing in on a page.** Tapping a person on the hub is a family-computer sign-in that ends
  after 3 idle minutes, so tick **Keep me signed in on this device** first, as the template does.
  Phones that join with an invite stay signed in anyway.
- **Time.** Start the hub's clock at 10:00 today (`skew`), install the page clock with
  `page.clock.install({ time })`, and move both together (`skew += ms; page.clock.fastForward(ms)`).
- **Checks, not throws.** `check(ok, what)` records each expectation and the run continues; a
  missing element still throws, so make the step that fails obvious. Fail the run on any
  `console` error or `pageerror`; allow only what the check explains (for example `/api/` 404s
  when there is no hub).
- **Screens that differ for kids.** Kids see "Say it", "Promises" and "Answers to what you said"
  where grown-ups see "Give", "Plans" and "Replies and reactions".
- **After sending**, the app goes to Sent and shows a toast (`#toast.show`). Adding a member on
  the hub opens their invite straight away; tapping Invite again makes a new one and the old link
  stops working.
- **Boards.** One per affected state: phone (390 × 844), foldable (744 × 900) and desktop
  (1440 × 1000), each dark view directly above its light view, written to
  `screenshots/<name>/board-<state>.png`. Move the mouse away (`page.mouse.move(0, 0)`) before a
  screenshot, and check `scrollWidth <= innerWidth` for each.
- **Headless only**, in its own browser contexts. Never the user's browser or settings.

For an iPhone check, use `webkit` and `devices['iPhone 15']` from `playwright-core` instead of
Edge (see [iphone-simulation](../iphone-simulation/SKILL.md)). WebKit reports the app's
Content-Security-Policy refusing a stylesheet *while Playwright takes a screenshot*; ignore only
that message, only during screenshots, as `scripts/iphone-check.mjs` does.

## Finish

1. Add `"test:<name>": "node scripts/<name>-check.mjs"` to `package.json`.
2. Run it twice; it must pass both times. Then run the checks around it.
3. Prove the new checks catch what they guard: [mutation-check](../mutation-check/SKILL.md).
4. Add it to README "Development" (one line in the command list, a short paragraph on what it
   covers), the checks list in [AGENTS.md](../../../AGENTS.md), and the table in
   [run-checks](../run-checks/SKILL.md).
