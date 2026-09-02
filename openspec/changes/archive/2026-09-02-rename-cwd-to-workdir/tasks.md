## 1. Rename internal helper

- [x] 1.1 Rename `resolveCwd` to `resolveWorkdir` in `src/lib/helpers.js`, updating its JSDoc (`@param {{ workdir?: string }} args`, priority line) and body to read `args.workdir` instead of `args.cwd`; update the failing `test/helpers.test.js` red-step tests to green (see 4.1)

## 2. Update tool schemas and call sites

- [x] 2.1 In `src/index.js`, update the import/re-export of `resolveWorkdir`, rename the `cwd` arg schema key to `workdir` on `openspec_cli`, and rename the local `cwd` variable and `resolveCwd`/`runOpenspec`/`populateCache` call-site arguments to `workdir`; verify via the failing `test/plugin.test.js` workdir-resolution tests (see 4.2)
- [x] 2.2 Repeat the same schema-key and call-site rename for `openspec_status` in `src/index.js`; verify via the updated `test/plugin.test.js` assertions
- [x] 2.3 Repeat the same schema-key and call-site rename for `openspec_instructions` in `src/index.js`; verify via the updated `test/plugin.test.js` assertions
- [x] 2.4 Confirm `runOpenspec($, cwd, argsArray)`'s own internal parameter name is left unchanged (mirrors Bun's `.cwd()` shell API, not tool-facing) by inspection

## 3. Update documentation

- [x] 3.1 Update `README.md`'s `openspec_cli` section to describe the `workdir` argument instead of `cwd`

## 4. Tests (red-step first, then green)

- [x] 4.1 In `test/helpers.test.js`, before implementing 1.1: update the `resolveCwd` import, `describe` block, and all `it()` titles/bodies to reference `resolveWorkdir`/`args.workdir`/`{workdir: ...}`; confirm the tests fail against the pre-rename `helpers.js`, then confirm they pass after 1.1
- [x] 4.2 In `test/plugin.test.js`, before implementing 2.1-2.3: rename the `describe('cwd resolution in tools', ...)` block and its two tests/comments to `workdir`, and update the one call-site passing `{ change: 'my-change', cwd: '/explicit' }` to `{ workdir: '/explicit' }`; confirm the tests fail against the pre-rename `index.js`, then confirm they pass after 2.1-2.3
- [x] 4.3 Run the full test suite (`npm test`) and confirm all tests pass with no `cwd`-related failures

## 5. Verification

- [x] 5.1 Grep the repository (excluding `node_modules`, `.git`, and archived `openspec/changes/archive/`) for remaining tool-facing `cwd` references and confirm none remain outside the internal `runOpenspec`/Bun `.cwd()` mirror and historical archive docs
