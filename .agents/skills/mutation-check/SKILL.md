---
name: mutation-check
description: Use after fixing an Echoes bug or adding a check, to prove the new test really fails without the fix. Temporarily puts the old behaviour back, runs the test, and restores the file, safely, even if the run stops part-way.
---

# Mutation check

A test that passes before and after a fix proves nothing. For each fix, put the old behaviour
back on purpose (a **mutation**), run the test that should catch it, and expect it to fail.

## Steps

1. Pick the smallest change that undoes the fix: remove the new line, flip the condition, put the
   old call back. One mutation per fix.
2. Back up every file you will change, mutate, run the one test, and **restore in `finally`**,
   so a test that crashes or times out never leaves the mutation behind:

```powershell
$files = 'public\app.js', 'public\ui\sent.js'
foreach ($f in $files) { Copy-Item $f "$env:TEMP\$(Split-Path $f -Leaf).bak" -Force }
function Restore { foreach ($f in $files) { Copy-Item "$env:TEMP\$(Split-Path $f -Leaf).bak" $f -Force } }
function Mutate($file, $from, $to) {
  $p = (Resolve-Path $file).Path; $t = [IO.File]::ReadAllText($p)
  if (-not $t.Contains($from)) { throw "not found in $file" }
  [IO.File]::WriteAllText($p, $t.Replace($from, $to))
}
try {
  Mutate 'public\ui\sent.js' 'if (!ui.quiet && groups' 'if (groups'
  "M1: " + ((node scripts/conversation-check.mjs 2>&1 | Select-Object -Last 3) -join ' | ')
  Restore
  # next mutation...
} finally { Restore }
```

3. Read each result: the test must **fail, on the check that guards the fix**. A failure
   somewhere else (a timeout earlier on) means the test fails for the wrong reason; tighten it.
4. After restoring, run the test once more and confirm it passes, and compare the restored files
   with their backups (`Get-FileHash`) before deleting the backups.

## Notes

- Match text exactly, including line endings: most files use CRLF. `ReadAllText`/`WriteAllText`
  keep them; in a Node script, use `s.replace(a, () => b)` so `$` in `b` isn't special.
- Unit tests (`node --test --test-name-pattern "<name>" test/<file>.test.js`) are fastest; use
  them where the fix is in `public/shared/`.
- For a race (two requests at once), make the store's save slow in the test so the race is
  reliable, then mutate the ordering, as `test/asks.test.js` does for answering twice.
- Report the result: "N mutations, all caught", with what each one was.
