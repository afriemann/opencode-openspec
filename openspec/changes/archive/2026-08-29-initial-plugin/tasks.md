## 1. Project scaffolding

- [x] 1.1 Create `package.json` with `"type":"module"`, `"main":"src/index.js"`, `engines.node>=22.5`, `@opencode-ai/plugin` in `peerDependencies`, `jest` in `devDependencies`; verify `npm install` succeeds
- [x] 1.2 Create `.gitignore` covering `node_modules/`, `.worktrees/`; verify file exists and patterns are present
- [x] 1.3 Initialise `jest.config.js` with `testEnvironment:"node"` and `transform:{}`; verify `npm test` runs (zero tests initially, exit 0)
- [x] 1.4 Create `src/index.js` skeleton exporting an empty plugin factory (named + default); verify `node --check src/index.js` passes

## 2. Core helpers

- [x] 2.1 Implement `resolveCwd(args, context)` helper: (1) `args.cwd` if non-empty, (2) `context.worktree` if truthy, (3) `context.directory`; verify three-branch test in `test/helpers.test.js` all pass
- [x] 2.2 Implement `runOpenspec($, cwd, args)` helper that runs `openspec <args>` via Bun `$` with `.nothrow().quiet()`; verify it returns `{stdout, stderr, exitCode}` for both zero and non-zero exits using a mock `$` in tests
- [x] 2.3 Implement `logError(client, message, err)` helper: logs via `client.app.log` service `"opencode-openspec"`, falls back to `process.stderr.write`; verify fallback is called when `client.app.log` throws in test
- [x] 2.4 Implement `isDestructive(command)` using leading-token match (tokens[0]==="archive" OR tokens[0]==="new" && tokens[1]==="change"); verify true for `"archive foo"`, `"new change bar"`, false for `"status --change archive-x"` in test

## 3. Injection cache

- [x] 3.1 Implement module-scoped `cacheByDir: Map<string, Entry>` and `populateCache(dir, $, client)` function that runs `openspec list --json`, parses the response, and stores `{present, changes, at}`; verify with mock `$` in `test/plugin.test.js`
- [x] 3.2 Wire `event` hook: on `session.created`, extract `directory`, run `existsSync(join(dir,'openspec'))` once, call `populateCache` if present else store `{present:false}`; wrap in try/catch (swallow + log); verify populated and absent cases in test

## 4. System-prompt transform

- [x] 4.1 Implement `experimental.chat.system.transform` hook: reads `cacheByDir` by `directory`, pushes static tools notice + changes summary when present, static notice only on cache miss, nothing when `present===false`; verify via test that `$` and `existsSync` are NOT called during transform
- [x] 4.2 Verify inject-nothing scenario: cache `{present:false}` → `output.system` unchanged; verify in test

## 5. openspec_cli tool

- [x] 5.1 Implement `openspec_cli` tool registration: args `command: string`, `cwd?: string`; call `resolveCwd`, call `isDestructive`; if destructive call `context.ask` then spawn; if non-destructive spawn immediately; return JSON-stringified `{stdout,stderr,exitCode}`; verify read-only command passes through in `test/plugin.test.js`
- [x] 5.2 Verify destructive-verb gate: `archive` and `new change` call `context.ask` before spawn; test mock `ask` approve path and reject path (`{cancelled:true}`) with spawn-not-called assertion
- [x] 5.3 Verify false-positive guard: `"status --change archive-foo --json"` does NOT trigger `context.ask`; verify in test
- [x] 5.4 Implement post-mutation cache refresh: after a successful destructive command, call `populateCache(dir, $, client)`; verify cache is refreshed in test

## 6. openspec_status tool

- [x] 6.1 Implement `openspec_status` tool: args `change: string`, `cwd?: string`; run `openspec status --change <change> --json`; parse response; return `{isPlanningComplete, order: [{artifact, status}], raw}` with `order` following proposal→design→specs→tasks; verify shape in `test/plugin.test.js`
- [x] 6.2 Verify `isComplete` is not surfaced as a headline field; verify test fails if `isComplete` appears at the top level of the returned object

## 7. openspec_instructions tool

- [x] 7.1 Implement `openspec_instructions` tool: args `artifact: "proposal"|"design"|"specs"|"tasks"`, `change: string`, `cwd?: string`; run `openspec instructions <artifact> --change <change> --json`; extract and return `{template, instruction, resolvedOutputPath}`; verify all three fields present in `test/plugin.test.js`

## 8. Error handling completeness

- [x] 8.1 Verify infrastructure-failure path in `openspec_cli`: spawn throws → `{error, exitCode:null}` returned + `logError` called + no throw from `execute`; verify in test
- [x] 8.2 Verify infrastructure-failure path in `openspec_status` and `openspec_instructions` using same pattern; verify in test
- [x] 8.3 Verify `event` hook error is swallowed: throwing `$` inside `event` → no exception propagates; verify in test

## 9. Test coverage and validation

- [x] 9.1 Run full test suite (`npm test`); verify all tests pass with zero failures — 53/53 passed
- [x] 9.2 Run `node --check src/index.js`; verify no syntax errors
- [x] 9.3 Run `openspec validate initial-plugin --json` in the repo; verify `valid: true` and zero issues

## 10. Deployment and smoke test

- [x] 10.1 Create symlink `~/.config/opencode/plugins/opencode-openspec.js → <repo>/src/index.js`; verify symlink target resolves correctly
- [ ] 10.2 Start opencode in a project with `openspec/` present; verify system prompt contains the tools notice and the active changes summary (manual smoke test — confirm injection fires)
- [ ] 10.3 Start opencode in a project without `openspec/`; verify system prompt does NOT contain the tools notice (injection is silent)

## 11. Documentation

- [x] 11.1 Write `README.md` covering: what the plugin does, the three tools with their arg shapes, deployment (symlink instructions), and the system-prompt injection behaviour; verify file exists and covers all four sections
