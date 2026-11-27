---
name: run-checks
description: Use when you have changed Echoes and need to know which checks to run, how to run them on Windows, and how to read a failure. Maps each part of the app to the npm checks that cover it, smallest set first, everything before calling work done.
---

# Run the checks

Read [AGENTS.md](../../../AGENTS.md) first. Every check uses throwaway data (an in-memory hub or a
temporary copy); none touches `data/family.json`. Browser checks run **headless** Microsoft Edge
through `playwright-core`; the iPhone ones run Playwright's WebKit, installed once with
`node node_modules/playwright-core/cli.js install webkit`.

## What covers what

| You changed | Run first | Then |
|---|---|---|
| `public/shared/*` (rules, store, styles, plans, asks) | `npm test` | the browser check for that feature, then `npm run test:peer` (linked phones repeat the rules) |
| `public/shared/peer-*.js`, `public/peer-*.js` | `npm test` (includes `test/peer.test.js`) | `npm run test:peer` (real WebRTC between two Edge profiles) |
| `public/ui/sync.js`, linking, `#/link`, the setup screen | `npm run test:get-echoes` | `npm run test:peer` |
| `src/server.js`, `src/push.js` | `npm test` | `npm run test:privacy`, `npm run test:stress`, `npm run test:push` |
| `public/ui/give.js`, `models.js` examples | `npm run test:styles` | `npm run test:asks`, `npm run test:layout` |
| `public/ui/inbox.js`, `sent.js`, asking | `npm run test:asks` | `npm run test:conversation`, `npm run test:layout` |
| `public/ui/plans.js`, `shared/plans.js` | `npm run test:plans` | `npm run test:conversation` |
| `public/app.js`, `router.js` (refresh, badges, sign-out) | `npm run test:conversation` | `npm run test:privacy`, `npm run test:push` |
| `public/styles.css`, any layout | `npm run test:layout` | `npm run test:browser` (themes), `npm run test:iphone` |
| `public/ui/push.js`, `public/sw.js` | `npm run test:push` | `npm run screenshots` |
| Invites, sign-in, PINs, shared devices | `npm run test:privacy` | `npm test`, `npm run screenshots` |
| Anything a person sees on an iPhone | `npm run test:iphone` | `npm run test:conversation` |

Before saying the work is done, run all of them:

```powershell
foreach ($s in 'test','test:privacy','test:stress','test:push','test:plans','test:peer','test:layout',
  'test:browser','test:asks','test:styles','test:get-echoes','test:iphone','test:conversation','screenshots') {
  $out = npm run $s 2>&1 | Out-String
  "[$s] exit=$LASTEXITCODE :: " + (($out.Trim() -split "`n" | Select-Object -Last 2) -join ' | ')
}
```

All together take about ten minutes; `test:stress` is the slowest (about a minute). `npm run
test:push-live` is optional and needs the internet.

## Reading a failure

- Each browser check prints `N passed, M failed:` and a list. A line starting `console:` is a
  browser console error or page error: the app threw, or a request failed. Treat it as a real
  failure unless the check documents why it is expected.
- A Playwright `Timeout ... waiting for locator(...)` means the screen wasn't what the check
  expected. Look at the screenshots the check saved (under `screenshots/<check>/`) before
  changing the check: often the app is right and the check assumed the wrong screen.
- Checks that move time (`test:plans`, `test:asks`, `test:conversation`) start the hub's day at
  10:00 so they never cross midnight. If one fails only late at night, look for a check that
  uses the real clock.
- A flaky failure (passes on a re-run) is still a finding: look for two requests racing, or a
  check reading the screen before it settles.

## Windows notes

- PowerShell drops npm's `--`: `npm run iphone -- --dark` loses `--dark`. Scripts that take
  options also accept plain words (`npm run iphone dark`); otherwise call `node scripts/x.mjs`.
- Run checks one at a time in one shell; several Edge or WebKit runs at once can starve each
  other and time out.
- The demo hub (`npm start` with `$env:DATA_PATH='data\demo.json'`) is separate from the checks;
  restart it after changing `src/` or `public/shared/` so it serves the new rules.

To add a check, use [write-browser-check](../write-browser-check/SKILL.md). To prove a new
test really catches its bug, use [mutation-check](../mutation-check/SKILL.md).
