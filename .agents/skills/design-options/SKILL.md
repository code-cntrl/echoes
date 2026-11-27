---
name: design-options
description: Use when a visible Echoes change hasn't been designed yet (a new screen, a redesign, "how should this look?"). Makes three options with design-mocks, checks each against the design contract, asks which one to build, and stops until someone picks one.
---

# Design options

Use this before building something people will see when nobody has chosen how it looks. Skip it
when the request already says how ("put Sent's questions at the top") or an option was already
picked.

## Steps

1. Make three options with [design-mocks](../design-mocks/SKILL.md), following it fully: real
   screens with demo data, every size, dark and light, one comparison picture per state.
2. Check each option against [docs/design.md](../../../docs/design.md) and
   [every-screen-size](../every-screen-size/SKILL.md): nothing lost at any size, the app's own
   pieces and colours, kid mode, readable contrast, privacy (an option must not show who sent an
   anonymous message, even by hint). Fix an option that breaks a rule, or label the break and why.
3. Send the comparison pictures with one line per option: what it changes, what it costs, and
   which one you'd build and why.
4. Ask which to build. If the agent can show a multiple-choice question, use it, with one choice
   per option (each with its picture), plus "change the options" and "stop here".
5. **Stop.** Don't touch the app while the question is open.

## When the answer comes

| Answer | Do |
|---|---|
| "Build option N" | Build that option with [every-screen-size](../every-screen-size/SKILL.md); its comparison picture is the target |
| "Change the options" | Revise as asked, then ask again |
| "Stop here" | Finish; nothing is built |
| Praise without a choice ("nice!") | Not a go-ahead. Ask once more which to build |
