## 1. Red — encode the failing regression test first

- [x] 1.1 Add the export-surface test to `test/plugin.test.js`:
  `expect(Object.keys(await import('../src/index.js'))).toEqual(['default'])`
  — run the suite and confirm this test fails on the current tree (it should
  report six keys, not one), for the right reason (extra keys present, not
  an import/syntax error).

## 2. Green — move code and reduce the export surface

- [x] 2.1 Create `src/lib/openspec-runner.js` containing `runOpenspec` and
  `populateCache`, moved verbatim from `src/index.js`, importing `logError`
  from `./helpers.js` — verify the new file has no syntax errors (`node
  --check src/lib/openspec-runner.js`).
- [x] 2.2 In `src/index.js`: remove the `export { resolveWorkdir,
  isDestructive, logError } from './lib/helpers.js'` line; import
  `runOpenspec`/`populateCache` from `./lib/openspec-runner.js` instead of
  defining them; remove the `export` keyword from `async function
  OpenSpecPlugin`, keeping only the trailing `export default OpenSpecPlugin`
  — verify by re-running task 1.1's test and confirming it now passes.
- [x] 2.3 Add a one-line file-top comment in `src/index.js` stating the
  module is intentionally default-export-only (per this change) — verify by
  reading the file.

## 3. Fix consequential test breakage

- [x] 3.1 Update `test/plugin.test.js`'s import on line 8 to `import
  OpenSpecPlugin from '../src/index.js'` plus `import { runOpenspec,
  populateCache } from '../src/lib/openspec-runner.js'` — verify the
  `runOpenspec`/`populateCache` describe blocks still pass.
- [x] 3.2 Update the `console.*`-free source scan in `test/plugin.test.js`
  (or wherever it's implemented) to enumerate `src/**/*.js` by walking the
  directory rather than a hardcoded two-path list — verify it now also
  covers `src/lib/openspec-runner.js`, and the scan's own test still passes.

## 4. Full verification

- [x] 4.1 Run the full test suite (`npm test` or equivalent) and confirm
  everything passes, including `test/helpers.test.js` (unaffected) and the
  new export-surface test.
- [x] 4.2 Empirically re-test against the `opencode2` sandbox
  (`opencode-ai@dev`) using the same reproduction steps as the audit
  (`docs/v2-compat-audit.md`) and confirm the plugin now loads without the
  `command.trim is not a function` error.
