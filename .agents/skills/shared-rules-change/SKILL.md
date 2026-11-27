---
name: shared-rules-change
description: Use when changing the Echoes rules or stored data in public/shared (who can send what, styles, anonymity, questions, plans, counts). Keeps the hub, one shared device and a linked phone apart in step, migrates stored data, updates badges and notifications, and tests each mode.
---

# Change the shared rules

Read [AGENTS.md](../../../AGENTS.md). The same rules run in three places:

- the **home hub** (`src/server.js` runs `public/shared/core.js` over a JSON file);
- **one shared device** and a **phone home base** (`core.js` in the browser over IndexedDB);
- a **linked phone apart**, which checks and queues changes itself in
  `public/shared/peer-client.js` and sends them at the next sync, where `core.js` checks them
  again.

So a rule written once in `core.js` usually needs its twin in `peer-client.js`.

## Checklist

1. **Put the rule where both can use it.** A pure function exported from `core.js` (like
   `checkFeedback`, `checkAsk`, `checkAnswer`) or a small module beside it (`plans.js`,
   `asks.js`, `models.js`). Call it from the route in `core.js` and from the matching offline
   path in `peer-client.js`, with the same inputs.
2. **Stored data.** New collections or fields go in `emptyDoc()` and `normalize()` in
   `public/shared/store.js`, so older files and IndexedDB copies load. Removing a member
   (`deleteMember`) must tidy anything that points at them.
3. **The linked phone's copy.** New routes it may call while apart go in `QUEUEABLE` (and
   `KEEP_IF_REFUSED` if a refused one should stay visible as failed); new data it shows goes in
   `emptyCache`, `remember` and the paths fetched at sync; its answer while apart must match the
   hub's shape (`queued: true`). Answer a 404 from an older home base gracefully.
4. **Counts and badges.** A new thing to notice adds to `state.me` in `core.js`, the badge sum in
   `public/ui/router.js`, the notification count in `public/sw.js`, and `cachedState` in
   `peer-client.js`. Call `onActivity(ids)` so the hub sends its content-free notification.
5. **Order of checks and saves.** Mark something as done *before* the first `await` that saves,
   and undo it if saving fails, or two requests at once both get through.
6. **Privacy.** Run [privacy-review](../privacy-review/SKILL.md) for anything about who sent,
   who answered, or when.
7. **Tests.** Unit tests in `test/<area>.test.js` with `createCore` and an in-memory store; a
   linked-phone test in `test/peer.test.js` (go apart with `phone.client.disconnected()`);
   then the browser check for the feature. Prove each new test with
   [mutation-check](../mutation-check/SKILL.md).
8. **Service worker.** A new file under `public/` or `public/shared/` that the app loads goes in
   `SHELL` in `public/sw.js`; bump `CACHE`.
9. **Docs.** README (what the family sees, privacy, Development), `docs/design.md` if a screen
   changes, the in-app Guide if people need to know.

## Verify

`npm test`, the feature's browser check, `npm run test:peer`, then everything
([run-checks](../run-checks/SKILL.md)). Restart the demo hub so it serves the new rules.
