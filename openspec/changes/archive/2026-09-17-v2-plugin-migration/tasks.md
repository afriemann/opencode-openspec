## 1. Dependency and packaging setup

- [x] 1.1 Add `@opencode/plugin` as a devDependency and optional peerDependency alongside the existing `@opencode-ai/plugin` peer; verify `npm install` resolves cleanly
- [x] 1.2 Update `package.json`: `main`/`"."` and `"./v1"` resolve to `plugin.v1.js`, `"./v2"` to `plugin.v2.js`

## 2. Extract the runtime-agnostic core (design.md D-1 through D-4)

- [x] 2.1 Create `src/core.js`: `runOpenspec`, cache population/lookup keyed by directory, a `sessionDirs` map (design.md D-4), `resolveWorkdir(args, {sessionID, defaultDir, sessionDirs})`, `isDestructive` (re-exported from `src/lib/helpers.js`, unchanged), the three tools' shared argument-handling/result-shaping logic (as functions taking injected `{$, log, confirm}` capabilities), `composeSystemParts(dir, cache)`, and the `V2_TOOL_OPTIONS = Object.freeze({codemode: false})` constant; core imports nothing from either host SDK
- [x] 2.2 Implement the `confirm` capability seam (design.md's confirmation-gating decision): core's destructive-verb path calls an injected `confirm(command)` function when non-null (resolves on approval, rejects on denial → `{cancelled:true}`), and returns `{cancelled:true, reason:'confirmation-unavailable', hint:...}` without spawning when `confirm` is `null`
- [x] 2.3 Verify `node --check src/core.js`

## 3. V1 adapter (`src/plugin.v1.js`)

- [x] 3.1 `git mv src/index.js src/plugin.v1.js`; reduce it to a thin adapter supplying `{$: PluginInput.$, log: client.app.log-based, confirm: cmd => context.ask({...}), defaultDir: context.worktree ?? context.directory}` to core's tool/event/transform logic; update all test imports; verify the existing V1 test suite passes unchanged in behavior (53/53 pre-existing tests pass unmodified in assertions, only import paths and the internal `populateCache` log-injection signature were adapted)

## 4. V2 adapter (`src/plugin.v2.js`)

- [x] 4.1 Export a plain `{id, setup}` object literal (no runtime import of `@opencode/plugin`, matching the established pattern from all three sibling ports)
- [x] 4.2 In `setup(ctx)`: resolve `globalThis.Bun.$`, throwing a named error if absent (design.md D-3); register the three tools via `ctx.tool.transform(editor => {...})` using JSON Schema `input` definitions and `V2_TOOL_OPTIONS`; after registration, re-read the descriptors via `editor.list()`/`editor.get(id)` and throw if any of the three is missing `codemode === false` (design.md D-2)
- [x] 4.3 Implement the event-subscription loop: `ctx.event.subscribe({signal})` on an `AbortController`, started detached; track `sessionID → directory` in a `Map` from `session.created` events (design.md D-4) and populate the cache the same way V1's handler does; unmapped/high-frequency event types return before any `await`; a per-event `try/catch` (including the raw-event handling step itself, not just a nested call — apply the lesson learned in the `opencode-notify` port where a normalization step placed outside the inner try/catch killed the whole loop on one bad event) logs and continues; `AbortError` after cleanup is not logged as an error
- [x] 4.3a **Correction from live verification**: `session.created` was found NOT to fire for single-shot `opencode run` invocations against the real V2 host (confirmed by instrumenting the event loop and logging every observed event type — the stream goes straight from setup/catalog events to `session.inbox.enqueued`/`session.execution.started`, no `session.created`). Fixed by populating the cache **eagerly at `setup()`** using `ctx.location.directory` (already known and stable at setup time), with the `session.created` subscription kept as defense-in-depth for other possible hosting modes. See design.md D-4's correction note.
- [x] 4.4 Implement `ctx.session.hook("context", event => { ... })`: resolve the directory for `event.sessionID` via the tracked map (falling back to `ctx.location.directory`), look up the cache, and push `{type:'text', text}` parts (design.md F13) rather than bare strings, using the same `composeSystemParts` logic core.js provides
- [x] 4.5 Pass `confirm: null` into core for the V2 adapter (design.md's confirmation-gating decision) so destructive `openspec_cli` commands are refused with the structured `confirmation-unavailable` result rather than silently executing unconfirmed
- [x] 4.6 Implement stderr-only logging (V2's `Context.app` has no `log` method)
- [x] 4.7 Return a cleanup that disposes every registration (tool transform, session hook) and aborts the event controller
- [x] 4.8 Verify `node --check src/plugin.v2.js` and confirm no default-export-adjacent named exports (single `export default`, matching the `fix-v2-loader-named-export-crash` lesson from the `opencode-use` port)

## 5. Spec compliance

- [x] 5.1 Confirm the delta specs (already drafted in `specs/plugin/`, `specs/tools/`, `specs/system-prompt/`) match the implementation; verify `openspec validate v2-plugin-migration --strict` passes

## 6. Test suite (design.md D-7)

- [x] 6.1 Layer 2 — shared adapter-conformance suite (`test/adapter-conformance.test.js`): a fake V1 `PluginInput` and a fake V2 `ctx` (fake `tool.transform` editor, fake `event.subscribe` async iterable, fake `session.hook`, fake `Bun.$` recording invocations); asserts identical CLI invocations (argv + cwd) for all three tools across both adapters, identical returned content (success, non-zero exit, spawn failure, unparseable JSON), identical cache population from a `session.created`-equivalent event, and identical injected content (unwrapping V2's `{type:'text', text}` envelope) for present/absent/cache-miss cases
- [x] 6.2 The one asserted divergence: the destructive-verb path — V1 prompts and returns `{cancelled:true}` on denial, V2 returns `{cancelled:true, reason:'confirmation-unavailable'}` with no spawn; both assert no subprocess was spawned
- [x] 6.3 V2-specific lifecycle tests (`test/plugin.v2.test.js`): `setup()` throws when `globalThis.Bun.$` is absent; all three descriptors carry `codemode:false` and the post-registration assertion throws when tampered with; cleanup disposes every registration and aborts the controller, and a second cleanup call is a no-op; a throwing raw-event handler does not terminate the subscription loop (a real bug class already caught once in the `opencode-notify` port — verified this repo doesn't repeat it); `resolveWorkdir` prefers `args.workdir`, then the session-scoped directory, then `ctx.location.directory`; eager cache population at `setup()` with no event required, and the absent-`openspec/`-folder case

Test suite: 77/77 passing (38 `test/plugin.test.js` + 17 `test/helpers.test.js` pre-existing V1 + 13 V2-specific lifecycle + 9 adapter-conformance).

## 7. Real V2 host verification (design.md OQ-1, OQ-2 — release gate)

- [x] 7.1 In a scratch project against the real, installed `@opencode/cli` (2.0.3), loaded `src/plugin.v2.js` via `.opencode/plugins/` auto-discovery (with `src/core.js`/`src/lib/helpers.js` in a sibling `.opencode/lib/` directory) — confirmed it loads without error (unlike all 6 sibling V1-shape plugins present in the same run, which correctly failed to load under V2's loader with `Plugin must export a default definition with an id and an effect or setup function`)
- [x] 7.2 OQ-1: from inside a tool's `execute`, logged `Object.keys(context)` — confirmed exactly `["sessionID","agent","messageID","id","progress"]`, with `'ask'`, `'permission'`, `'confirm'`, `'directory'` all absent (`in` checks all `false`). Confirms the confirmation-gating decision's premise.
- [ ] 7.3 OQ-1 (continued): register a tool with `options.permission: "openspec"` and a matching `{action:"openspec", resource:"*", effect:"ask"}` rule; confirm no prompt appears (only deny-filtering, per design.md F9) — **not verified this session**; the destructive-verb refusal path (7.4) was verified live and behaves correctly regardless, but the specific permission-config prompt-suppression claim from F9 was not independently re-confirmed here. Flagged as an open follow-up, not assumed.
- [x] 7.4 Triggered a real, non-destructive `openspec_status` call (returned correct canonical `order` and full `raw` CLI JSON) and a real `openspec_cli` destructive-verb call (`archive my-feature --yes`) — confirmed the refusal payload `{cancelled:true, reason:'confirmation-unavailable', hint:...}` was returned with no subprocess spawned (the change directory was not moved to `archive/`) and the model correctly reported this refusal to the user
- [x] 7.5 OQ-2: confirmed the packaged `.opencode/lib/` layout resolves correctly for a plain-copied (not symlinked) plugin install, exercised across three separate live scratch-project runs
- [x] 7.6 Recorded all OQ-1/OQ-2 answers in `docs/v2-compat-audit.md` (section 8.1), including the 4.3a correction and the still-open 7.3 follow-up

## 8. Documentation

- [x] 8.1 Rewrite `docs/v2-compat-audit.md`: retract the prior `opencode-ai@dev`-audit's conclusion (already partially corrected in the merged `fix-v2-loader-named-export-crash` change), document the real hook/event mapping, the confirmation-gating decision and its rationale, the `session.created` non-firing correction, and verification results from section 7
- [x] 8.2 Update `README.md` to describe both V1 and V2 installation/entry points and the V2 destructive-command-refusal behavior

## 9. Final verification and review

- [x] 9.1 Run the full test suite and verify it is green (77/77 passing)
- [x] 9.2 Run `openspec validate v2-plugin-migration --strict`; verify it passes
- [x] 9.3 Commissioned `code-reviewer` (full diff, proposal → specs → design → diff) and `security` (confirmation-gating decision specifically) in parallel. Zero `[BLOCKER]`s from either. Dispositions:
  - `[WARNING]` dead, differently-shaped `resolveWorkdir` left in `src/lib/helpers.js` (superseded by `core.js`'s version) — **accepted, fixed**: deleted the dead function and its test block from `test/helpers.test.js`.
  - `[WARNING]` `isDestructive`'s tokenizer misses a leading zero-width/invisible Unicode character (reproduced: `\u200Barchive ...` evaded detection) — **accepted, fixed**: added `normalizeCommand()` to `src/lib/helpers.js`, applied identically in `isDestructive` and in `core.js`'s own tokenization (so the check and the actual spawned argv can never disagree); added 3 regression tests.
  - `[WARNING]` eager cache population in `plugin.v2.js`'s `setup()` awaits with no timeout, so a hung `openspec` subprocess could block plugin load indefinitely — **accepted, fixed**: wrapped in a `Promise.race` against a 5s timeout (`EAGER_CACHE_TIMEOUT_MS`), with the timer cleared on whichever side wins.
  - `[WARNING]` missing test coverage for two concurrent sessions in different directories each seeing only their own project's injected content (design.md's "more correct than V1" claim) — **accepted, fixed**: added `test/plugin.v2.test.js`'s "per-session directory isolation" test.
  - `[SUGGESTION]` unused `withFakeBun`/`pushedEvent` in `test/adapter-conformance.test.js` — **accepted, fixed**: removed both.
  - `[SUGGESTION]` repo lacks a `.pre-commit-config.yaml` — **rejected**: pre-existing, repo-wide gap unrelated to this diff; out of scope.
  - Security review's two flagged unverified assumptions were independently checked and resolved as safe: Bun's `$` array-interpolation does not shell-reinterpret its elements (verified with a throwaway script — metacharacters print literally, no injection); the real `openspec` CLI is case-sensitive on subcommand names (verified directly — `Archive`/`ARCHIVE` both rejected as unknown commands), closing the case-variation bypass concern.
  - The residual denylist-completeness risk (`isDestructive` only knows today's two destructive verb shapes; a future CLI release adding a new one would need a manual update) is a genuine, accepted, monitored risk — documented explicitly in design.md rather than silently assumed complete.
  - Security review's verdict: "the confirmation-gating decision itself... is the correct, safe posture, and its control-flow implementation... is sound."
