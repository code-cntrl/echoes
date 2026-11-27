# Project skills

Agent skills for working on Echoes. Agents load them from here (GitHub Copilot, for
example, reads `.agents/skills/<name>/SKILL.md`; it also looks in `.github/skills` and
`.claude/skills`). Each skill sits directly in this folder, because skills in subfolders aren't
found, so they're grouped by area below. Read [AGENTS.md](../../AGENTS.md) first; UI skills follow
the [design contract](../../docs/design.md).

## Design and UI

| Skill | Use it when |
|---|---|
| [every-screen-size](every-screen-size/SKILL.md) | Building an approved visible change so it works on a phone, a foldable or tablet, and a desktop, in light and dark, without losing anything at any size |
| [design-mocks](design-mocks/SKILL.md) | Asked for mocks, mockups, a redesign or "show me what it could look like": options drawn on fresh screenshots of the real app, every size, dark above light, one comparison per state. Never edits the app |
| [design-options](design-options/SKILL.md) | A visible change nobody has designed yet: three options from `design-mocks`, checked against the design contract, then ask which to build and stop |
| [measure-layout](measure-layout/SKILL.md) | Checking a layout on the rendered page: edges, near misses, sideways scrolling and tap targets with [edges.mjs](measure-layout/scripts/edges.mjs), and the checks that guard each size |

## Testing

| Skill | Use it when |
|---|---|
| [run-checks](run-checks/SKILL.md) | You changed something and need the checks that cover it, how to run them on Windows, and how to read a failure |
| [write-browser-check](write-browser-check/SKILL.md) | A feature needs a new `npm run test:<name>` browser check, or an existing one needs extending; comes with a runnable [template](write-browser-check/templates/check-template.mjs) |
| [play-test](play-test/SKILL.md) | Asked to play test, try it like a family would, or have two phones talk to each other; sorting what you find into bugs, judgement calls and test mistakes |
| [mutation-check](mutation-check/SKILL.md) | After a fix or a new check: prove the test fails without the fix, restoring files safely |
| [iphone-simulation](iphone-simulation/SKILL.md) | Trying or testing it like an iPhone on this PC with Safari's engine, and knowing what still needs a real iPhone |

## Changing the rules

| Skill | Use it when |
|---|---|
| [shared-rules-change](shared-rules-change/SKILL.md) | Changing rules or stored data in `public/shared`: keeping the hub, one shared device and a linked phone apart in step, with migrations, badges and tests |
| [privacy-review](privacy-review/SKILL.md) | A change touches messages, anonymity, questions, plans, sign-in, devices or notifications: check each privacy promise and look for leaks through timing, order or counts |

## Where they come from

All of these were written for Echoes, from its own checks and from what building it taught (play
tests, reviews and mutation checks). The design skills are inspired by design workflows used in
other projects, rewritten here for this app; `measure-layout/scripts/edges.mjs` is this project's
own code.
