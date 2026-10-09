## 1. Command parsing and classification (helpers.js)

- [x] 1.1 Red tests for `parseCommand` (quotes, escapes, concatenation, empty arg, `openspec` prefix, leading global options, `--scope`, parse errors) and classification tables (blocked, destructive incl. `--no-color archive`, `store remove`, read-only)
- [x] 1.2 Implement `parseCommand` and tables; rebuild `isDestructive` on them

## 2. Execution (exec.js)

- [x] 2.1 Red tests with a real `node -e` child: stdout/stderr/exit code, timeout kill with partial output, ENOENT rejects
- [x] 2.2 Implement `src/lib/exec.js` (spawn, stdin ignored, detached group kill SIGTERM→SIGKILL, env unchanged)

## 3. Core pipeline (core.js)

- [x] 3.1 Red tests (faked `exec`) for each spec scenario: parse-error, invalid-timeout, blocked reasons, help allowed, V2 destructive runs, V1 confirm/deny, leading-option gate, no injected args/stdin closed, timeout result, cache refresh rules
- [x] 3.2 Implement pipeline, reason codes, `timeout` in `TOOL_SCHEMAS`, updated `TOOL_DESCRIPTIONS`; switch status/instructions/populateCache to `exec`; delete `src/lib/openspec-runner.js`

## 4. Adapters

- [x] 4.1 V1: pass `exec` and `timeout` schema; V2: pass `exec`, drop Bun `$` precondition, replace eager-cache `Promise.race` with `timeoutMs`
- [x] 4.2 Update adapter-conformance, plugin and plugin.v2 tests (remove V1/V2 divergence assertion; no `$` fakes)

## 5. Docs

- [x] 5.1 README: new behaviour, blocked/destructive tables, host permission recommendation, prompt-injection risk, breaking V2 note
- [x] 5.2 Rewrite confirmation-gating section of `docs/v2-compat-audit.md`
- [x] 5.3 AGENTS.md gotcha line (route via `agent-engineer`)

## 6. Verify

- [x] 6.1 `npm test` green; `openspec validate full-cli-support`
