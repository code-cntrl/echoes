---
name: privacy-review
description: Use when an Echoes change touches messages, anonymity, questions, plans, sign-in, devices, notifications or anything stored or sent, to check it keeps the family's privacy promises. Lists each promise, where the code keeps it and which test proves it, and how to look for leaks through timing, order or counts.
---

# Privacy review

Read [AGENTS.md](../../../AGENTS.md) and the README sections "Anonymity: what it does and doesn't
promise" and "Privacy and permissions". Those are the promises to the family; this skill is how
to check a change keeps them.

## The promises, and where they are kept

| Promise | Kept in | Proved by |
|---|---|---|
| An anonymous message stores no sender | `POST /api/feedback` in `public/shared/core.js` (`fromId: null`) | `npm test`, `npm run test:privacy` |
| Only its date, not its time; a random id and place in the list | `core.js` (`T12:00`), `store.js` (`randomId`, `insertFeedback`) | `test:privacy`, `test:stress` |
| Anonymous messages are held 1 to 3 hours on the hub (1 to 6 after a phone sync) and show with their notification | `core.js` (`visibleAfter`, `isDelivered`), `src/server.js` release timer | `npm test`, `test:push` |
| No replies to, recipients of or reactions reaching an anonymous sender | `core.js` (inbox items, responses) | `test:privacy` |
| A question allowing anonymous answers: 3 or more asked who can still answer (removed members and ended guest passes don't count); every answer anonymous and in one style; the asker sees only how many have **arrived**, never who, never `ask.done` | `core.js` (`checkAsk`, `checkAnswer`, `answerable`, `myAsks`) and the same checks in `peer-client.js` | `test/asks.test.js`, `npm run test:asks` |
| A question for someone else: they aren't told until answers arrive; answers go only to them; the asker sees who answered or how many, never what (one answer to two people counts once) | `core.js` (`checkAsk`, `checkAnswer`, `askFor`, `myAsks`, `inboxItem.askBy`), `peer-client.js` | `test/asks.test.js`, `test/peer.test.js`, `npm run test:asks` |
| Only the recipient reads a message; plans are private unless shared; missed days are never shown | `core.js` routes (`requireMember`, `ownedFeedback`, plan views) | `test:privacy`, `test:plans` |
| A family computer forgets the last person (signed out when idle or closed) | `src/server.js` (shared sessions), `public/app.js` (`shouldAutoSignOut`) | `test:privacy` |
| PINs: hashed, guesses limited and counted before checking; a PIN is needed to add a phone | `core.js` (`verifyPin`, `pinLocks`), `src/server.js` invites | `npm test`, `test:stress` |
| Notifications carry no names or words: only `{"t":"new"}` | `src/push.js` (`PAYLOAD`) | `test:push` |
| The hub answers only to addresses and local names (no DNS rebinding); strict CSP, no inline styles | `src/server.js` (`ALLOWED_HOSTS`), `public/index.html` | `npm test` |
| At most 20 sign-ins per person, none older than a year | `src/server.js` (`MAX_SESSIONS`) | `test:stress` |

## Review a change

1. **Follow the data.** For every new field, list each response it appears in (hub, one shared
   device, and the linked phone's copy in `peer-client.js`) and who receives it. Does the asker,
   a parent or another member get something they shouldn't?
2. **Look for side channels**, not only fields: an id that counts up, the order of a list, a
   timestamp, a count that changes the moment someone acts, a badge or notification that arrives
   right after a send, the one person missing from "everyone", a style only one person uses.
3. **Small families.** Anonymity among two or three people is weak. Check that the app says so,
   or limits it (as questions need 3 people).
4. **Every mode.** The hub, one shared device (IndexedDB, visible to anyone with developer tools)
   and a linked phone apart (its queue sits next to its owner's details until the next sync).
5. **Test it.** Add a check that would fail if the leak came back (`test/*.test.js` for rules,
   `scripts/privacy-check.mjs` for what a person can see), and prove it with
   [mutation-check](../mutation-check/SKILL.md).

For larger changes, also run a security review (the `security-review` agent) and fix or answer
each finding. Never weaken a promise without asking; if one has to change, update the README's
promise text in the same change.
