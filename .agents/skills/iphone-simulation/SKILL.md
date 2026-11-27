---
name: iphone-simulation
description: Use when Echoes needs trying or testing like an iPhone on this Windows PC. Runs Safari's engine (Playwright WebKit) with iPhone screen, touch and user agent, interactively or headless, and says what it can't show and how to test those parts on a real iPhone.
---

# iPhone simulation

Apple's iPhone Simulator needs a Mac. This PC runs **Safari's engine** instead: Playwright's
WebKit with an iPhone's screen size, pixel density, touch and user agent. It catches most layout
and Safari-only problems. The README section "Trying it like an iPhone on this PC" has the same
steps for people.

## Set up once

```powershell
node node_modules/playwright-core/cli.js install webkit   # about 175 MB, in %LOCALAPPDATA%\ms-playwright
```

## Use it

| Command | What it does |
|---|---|
| `npm run iphone` | An iPhone 15 window on the hub at `http://localhost:3000` (start it with `npm start`). Storage is kept in `data/iphone-sim`, like a phone's |
| `npm run iphone dark landscape device "iPhone 15 Pro Max"` | Options are plain words, because PowerShell drops npm's `--` |
| `npm run iphone http://192.168.1.20:3000 fresh` | Another address; `fresh` starts with empty storage |
| `npm run iphone headless screenshot shot.png` | No window: for checks |
| `npm run test:iphone` | Headless journey: hub, a kid, asking, notifications on an iPhone, one shared device (`scripts/iphone-check.mjs`) |
| `npm run test:conversation` | Two iPhones talking through the hub (`scripts/conversation-check.mjs`) |

Agents use the headless forms. Open a window (`npm run iphone` without `headless`) only when the
person asks to try it themselves; it's theirs to run.

In scripts: `import { devices, webkit } from 'playwright-core'`, then
`browser.newContext({ ...devices['iPhone 15'], colorScheme })`. Use `.tap()` for taps.

## What it can't show

- **Add to Home Screen** and the app on its own, so no Web Push: the app shows its "add the app
  to your Home Screen" explanation, as Safari on an iPhone does before it's installed.
- **Phone sync**: the Windows build of WebKit has no WebRTC (`RTCPeerConnection`), so a phone
  home base can't link phones. Use `npm run test:peer` (Edge) for sync.
- iOS itself: the on-screen keyboard pushing the page up, the notch and Home bar (safe areas),
  Apple's fonts and emoji, the camera, touch scrolling and momentum.
- While Playwright takes a screenshot, WebKit logs the app's CSP refusing a stylesheet that
  Playwright adds. It's the tool, not the app; ignore only that message, only then.

## On a real iPhone

- `npm run serve:https`: an https copy of the app on this PC for the phone home base and
  linked phones, with a setup page for the family certificate. The README's "Testing on real
  iPhones" table lists what to try.
- `npm run start:https`: the hub over https, for notifications from the Home Screen app.
- Device clouds (BrowserStack, LambdaTest) run real iPhones, but data passes through their
  servers: only ever made-up demo data.
