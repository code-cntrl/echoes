# Echoes: notes for agents

- **What it is and how to run it:** [README.md](README.md). **How it looks and adapts to phone,
  tablet and desktop:** [docs/design.md](docs/design.md); read it before any UI change.
- **Skills** are in [.agents/skills](.agents/skills/README.md), grouped there by area.
  Design and UI: `every-screen-size` (build a change for every size), `design-mocks` and
  `design-options` (proposals only, never edits), `measure-layout` (measure the real page). Testing: `run-checks` (which checks for which change), `write-browser-check`,
  `play-test`, `mutation-check` (prove a test catches its bug), `iphone-simulation`.
  Changing the rules: `shared-rules-change` (hub, shared device and linked phone in step),
  `privacy-review`.
- **The rules live in `public/shared/`** (`core.js`, `plans.js`, `asks.js`, `store.js`). The hub, a shared
  device and a linked phone all run them; `peer-client.js` repeats each check for changes made
  apart, so change both together. Anonymous messages never store a sender. When a question allows
  anonymous answers, every answer is anonymous and in one style, and its asker sees only how many
  have arrived: never `ask.done`, who answered, or held answers.
- **No inline `style` attributes**: the hub's Content-Security-Policy blocks them.
- **Styles** (`public/shared/models.js`) are open to everyone, kids included; `EXAMPLES` holds the
  ghost-text examples, at least two for kids and two for grown-ups per style, covering every text field.
- **The UI** starts in `public/app.js` (listeners, timers, boot) and lives in `public/ui/`, one
  module per screen plus `state.js`, `dom.js`, `actions.js` and `forms.js`. Modules can't assign an
  imported binding, so change `S`, `api` and `compose` with `setS`, `setApi` and `setCompose`.
  Keep start-up side effects in `app.js`, so modules only declare things. A new file under
  `public/ui/` also goes in the service worker's `SHELL` list (and bump `CACHE`). Put ids and
  counts from the hub or a home base into markup through `Number()`, and text through `esc()`.
- **Older Safari.** The app's modules need iOS 14 (they use `??=`). `public/boot.js` is a classic
  ES5 script that runs first: it fills in `structuredClone`, `Object.hasOwn` and `.at()` (iOS
  15.4) and, if the app can't start, replaces **Loading…** with a message that names the system.
  `app.js` calls `echoesBoot.started()` after the first screen. Don't use newer syntax, or an API
  newer than iOS 14 while starting, without a fallback there or a feature check. Keep
  `theme-init.js` to old-Safari syntax. Linking phones needs compression streams (iOS 16.4):
  `syncUnsupported()` in `shared/signal.js` says so. README, "Which iPhones and iPads", has the table.
- **Questions can be for someone else.** An ask has `forIds` (the asker by default; older saved
  questions load that way). Answers go to exactly those people, together. The asker sees who
  answered or how many, never the answers (`myAsks` counts delivered messages across them, one per
  group). Keep `checkAsk`/`checkAnswer` in `core.js` and their twins in `peer-client.js` in step.
- **Line endings:** most files use CRLF. Keep them when editing.
- **The old name.** The app was called Family Feedback. Names nobody sees keep it so existing data
  keeps working: the IndexedDB database (`family-feedback`), the backup file's `app` marker, the
  tab lock (`family-feedback-data`), the phone-sync data channel, and the `ff-` storage keys and
  cache names. Don't rename them without a migration. Family certificates made before the rename
  are still called "Family Feedback test CA"; the https setup page reads the real name.
- **Never test with the family's real data** (`data/family.json`). Use
  `$env:DATA_PATH='data\demo.json'` or `createApp({ dataPath: ':memory:' })`.
- **Checks** (browser ones use headless Microsoft Edge):
  `npm test`, `npm run test:browser`, `npm run test:layout`, `npm run test:plans`,
  `npm run test:peer`, `npm run test:push`, `npm run test:privacy`, `npm run test:stress`, `npm run test:asks`, `npm run test:styles`,
  `npm run test:get-echoes`, `npm run test:boot` (Edge and WebKit), `npm run test:iphone` and `npm run test:conversation` (WebKit; install it once with
  `node node_modules/playwright-core/cli.js install webkit`),
  `npm run screenshots`.
- **Notifications** (`src/push.js`) only ever say "You have something new."; the encrypted
  payload is `{"t":"new"}`. Never put names or message text in a push. On the hub, anonymous
  messages are held (`visibleAfter`, set in `core.js`) and released with their ping by the
  server's release timer; ordinary pings must never show or bring them forward.
- Don't publish, push or deploy without being asked.
