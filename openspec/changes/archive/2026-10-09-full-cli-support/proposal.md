# Proposal

## Why

`openspec_cli` is documented as "run any openspec subcommand", but in practice agents still shell out to
`openspec` for the commands that matter most. On V2, `archive` and `new change` are refused outright
(no confirmation mechanism), and the refusal hint tells the agent to use bash. Arguments containing
quotes or spaces are mangled by a whitespace-only tokenizer, and commands that prompt interactively can
hang the tool. Change management through the plugin is therefore not possible end to end.

## What Changes

- **BREAKING (V2):** destructive verbs (`archive`, `new change`) execute on V2 without a plugin-level
  confirmation; host tool permissions (`permission` config for `openspec_cli`) are the gate. The
  `confirmation-unavailable` refusal is removed. V1 behaviour is not a design constraint; the V1 adapter
  keeps its existing `context.ask` confirmation unchanged.
- `openspec_cli` tokenizes the command shell-style (single quotes, double quotes, backslash escapes), so
  quoted arguments and arguments with spaces reach the CLI intact. The destructive-verb check and the argv
  builder share this tokenizer.
- Commands run non-interactively with stdin closed. Verified against openspec 1.14.0: with no TTY the CLI
  already refuses pickers and prompts with guidance (`show`/`validate` with no item, `init` without
  `--tools`, `archive` without a name) and `archive` without `--yes` proceeds without prompting, so no flag
  or environment injection is added. Only commands that launch an external editor or GUI and would hang
  (`config edit`, `workset open`) fail fast with a structured error and hint.
- `openspec_cli` accepts an optional `timeout` (default 120000 ms); on expiry the process is killed and a
  structured timeout result (with any partial output) is returned.
- A shell-style tokenizer error (unterminated quote, empty command) returns a structured error instead of
  spawning.
- The injection cache is refreshed after any spawned command whose verb is not on a read-only list,
  whether it exited 0, non-zero, or timed out, so unknown or new verbs default to refresh.
- A small blocklist refuses commands that cannot work or reach outside the project: `config edit`,
  `workset open` (launch an editor) and `completion install|uninstall`, `feedback` (edit shell rc files /
  send data to a third party). `store remove` is classified destructive.
- Shared runner: the unused duplicate `src/lib/openspec-runner.js` is removed; `core.js` owns execution.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tools`: gating requirement changes (V2 executes destructive verbs), cache-refresh requirement widens,
  and new requirements for shell-style argument parsing, non-interactive execution, and timeout are added
  to the `openspec_cli` contract.

## Impact

- Code: `src/lib/helpers.js`, `src/lib/openspec-runner.js`, `src/core.js`, `src/plugin.v1.js`,
  `src/plugin.v2.js` (tool schema gains `timeout`).
- Tests: `test/helpers.test.js`, `test/plugin.test.js`, `test/plugin.v2.test.js`,
  `test/adapter-conformance.test.js` (the asserted V1/V2 divergence disappears).
- Docs: `README.md`, `AGENTS.md` gotcha line, `docs/v2-compat-audit.md` confirmation-gating section.
- Supersedes the tokenizer half of stale open PR #1 (`fix-cli-tokenizer`, based on the pre-refactor layout).
- Security posture: on V2, a destructive command can run without an in-plugin prompt; users who want a gate
  must configure host permissions for `openspec_cli`.
