## Why

The V2 compatibility audit (`docs/v2-compat-audit.md`, PR #5) found that this
plugin fails to load entirely against `opencode-ai@dev` prereleases with
`command.trim is not a function`. Root cause, confirmed via minimal clean
reproductions: `opencode-ai@dev`'s plugin loader speculatively invokes every
*named* export of a plugin module (not just `default`) using the same single
argument it passes to the real plugin factory. Any named export whose first
parameter is a positional value used unsafely (not destructured from an
object) throws when it receives that mismatched argument, and that throw
crashes the load of the *entire file* — not just that one export.

This affects four of this plugin's named exports today: `isDestructive` and
`runOpenspec` are confirmed to crash; `resolveWorkdir` and `populateCache`
are assessed to crash for the same class of reason (unguarded positional
parameter access) though not independently reproduced in isolation.
`logError` is safe (internally try/caught). The plugin's own factory,
`OpenSpecPlugin`, is confirmed safe on its own (its parameter is destructured
from an object, so a mismatched-shape argument yields `undefined` properties
rather than throwing) — but is *also* an unnecessary named export: no other
plugin in this environment's repo set exports its factory by name, and
nothing evidences that opencode's plugin API actually requires it. Removing
it eliminates a class of future risk (the loader could change how it
constructs the object it passes, invalidating today's "destructuring is
safe" finding) with no functional downside.

## What Changes

- Move `runOpenspec` and `populateCache` out of `src/index.js` into a new
  `src/lib/openspec-runner.js`, imported (not re-exported) by `index.js`.
- Remove the dead `export { resolveWorkdir, isDestructive, logError } from
  './lib/helpers.js'` re-export in `index.js` — `test/helpers.test.js`
  already imports these directly from `src/lib/helpers.js`, so nothing
  depends on the `index.js` re-export.
- Remove `OpenSpecPlugin`'s named export; `index.js` keeps only `export
  default OpenSpecPlugin`.
- Update `test/plugin.test.js` to import `runOpenspec`/`populateCache` from
  the new `src/lib/openspec-runner.js` and `OpenSpecPlugin` only as the
  default export of `src/index.js`.
- Add a regression test asserting `src/index.js`'s only export is `default`
  — this is the actual failing-test-first reproduction of the bug: it fails
  today (multiple named exports present) and passes once the fix lands.
- **MODIFIED capability:** `plugin` — Requirement "Plugin is a valid ESM
  opencode plugin" currently mandates a named-*and*-default factory export;
  this changes it to default-only, and adds an explicit constraint that
  `index.js` must not export anything else by name, to prevent this whole
  class of regression from recurring.

## Impact

- `src/index.js`, `src/lib/openspec-runner.js` (new), `test/plugin.test.js`.
- No change to `client`-facing tool/hook behavior — `openspec_cli`,
  `openspec_status`, `openspec_instructions`, the `event` hook, and the
  `experimental.chat.system.transform` hook all keep their exact current
  runtime behavior. This is a module-export-shape fix only.
- Fixes the plugin's ability to load at all on `opencode-ai@dev` prereleases.
