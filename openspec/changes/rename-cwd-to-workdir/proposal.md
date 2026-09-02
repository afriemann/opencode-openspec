## Why

The three plugin tools (`openspec_cli`, `openspec_status`, `openspec_instructions`) currently
expose an optional `cwd` argument for overriding the resolved working directory. The user has
requested this parameter be renamed to `workdir` for clarity and naming consistency across the
plugin's tool surface, its internal helper (`resolveCwd` → `resolveWorkdir`), tests, README, and
the `tools` spec. This is a clean breaking rename — no backward-compatible `cwd` alias is kept,
since the plugin has minimal external usage today.

## What Changes

- **BREAKING**: Rename the `cwd` argument to `workdir` on all three tool schemas:
  `openspec_cli`, `openspec_status`, `openspec_instructions`. Callers passing `cwd` will no
  longer have it honored.
- Rename the internal helper `resolveCwd(args, context)` to `resolveWorkdir(args, context)` in
  `src/lib/helpers.js`, updating its JSDoc to reference `args.workdir`.
- Update `src/index.js`: schema key `cwd` → `workdir` on all three tools; local variable and
  function-call renames (`resolveCwd` → `resolveWorkdir`) at each of the three call sites. The
  internal `runOpenspec($, cwd, argsArray)` helper's own `cwd` parameter is **not** renamed — it
  mirrors Bun's own `.cwd()` shell API and is not part of the tool-facing argument surface.
- Update `test/helpers.test.js` and `test/plugin.test.js` to reference `workdir` instead of
  `cwd` wherever the tool-facing argument or the `resolveWorkdir` helper is exercised. Internal
  mock-`$`-chain `.cwd()` method names (mirroring the real Bun API) are unaffected.
- Update `README.md`'s description of the `openspec_cli` tool's optional argument.
- Update the `tools` capability spec (delta) to rename every mention of `cwd` to `workdir`,
  including renaming the requirement titled "Tools resolve cwd from context when not explicitly
  provided" to "Tools resolve workdir from context when not explicitly provided" and its two
  scenario titles.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `tools`: The `cwd` argument on all three tools, and the requirement describing working-directory
  resolution, are renamed to `workdir`. No change in resolution behavior (`args.workdir` →
  `context.worktree` → `context.directory` — same precedence as before, only the argument name
  changes).

## Impact

- **Affected code**: `src/index.js`, `src/lib/helpers.js`.
- **Affected tests**: `test/helpers.test.js`, `test/plugin.test.js`.
- **Affected docs**: `README.md`, `openspec/specs/tools/spec.md` (via delta + archive).
- **Breaking change**: any external caller passing `cwd` to one of these three tools must switch
  to `workdir`. No compatibility shim is provided (confirmed by user).
- **No new dependencies, no infrastructure or configuration changes.**
