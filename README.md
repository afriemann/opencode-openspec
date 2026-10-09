# opencode-openspec

An [opencode](https://github.com/anomalyco/opencode) plugin that wraps the [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI as first-class agent tools and injects active-change context into the LLM system prompt on every call.

## Why

Agents using OpenSpec must memorise exact CLI flag syntax, manually parse JSON output, and make multiple round-trips (e.g. call `openspec instructions` → extract `resolvedOutputPath` → write the file). This plugin removes that friction.

## Tools

### `openspec_cli`

Runs any `openspec` subcommand. The `command` argument is the full subcommand and flags as a string.

```
openspec_cli({ command: "list --json" })
openspec_cli({ command: "validate my-change --strict" })
openspec_cli({ command: "new change my-feature" })
openspec_cli({ command: "archive my-change --yes" })
openspec_cli({ command: "validate --all --json", timeout: 30000 })
```

Returns `{ stdout, stderr, exitCode }`. A non-zero `exitCode` is a normal result — inspect `stderr` for details.

- **Quoting:** the command is split shell-style (single quotes, double quotes, backslash escapes). There is no expansion of `$VAR`, `~` or globs, and no pipes, redirects or `;`. A leading `openspec` is ignored.
- **Non-interactive:** every command runs with stdin closed and no injected flags. The CLI itself refuses pickers and prompts when there is no terminal.
- **Timeout:** optional `timeout` in ms (integer, 1000–600000, default 120000). On expiry the process group is killed and `{ stdout, stderr, exitCode: null, timedOut: true, reason: "timeout", hint }` is returned with any partial output. Check `openspec list` and `git status` after a timeout on a mutating command.
- **Structured failures:** `{ error, reason, exitCode: null }` with `reason` one of `parse-error`, `invalid-timeout`, `spawn-failed`.
- **Refused commands** (`{ cancelled: true, reason, error, hint }`, nothing runs; use your own terminal): `config edit` and `workset open` (`interactive`, they launch an editor), `completion install|uninstall` (edits shell rc files) and `feedback` (sends text to a third party) (`out-of-scope-side-effect`). A bare `<command> --help` is allowed.
- **Destructive verbs** (`archive`, `new change`, `store remove|unregister`, `workset remove`, `config reset|unset`): on V1 (`@opencode-ai/plugin`) approval goes through opencode's permission prompt (`context.ask`); a denial returns `{ cancelled: true }` without running anything. On V2 (`@opencode/plugin`) a plugin tool has no reachable confirmation mechanism, so they **run without a prompt**.
- **Cache:** after any non-read-only command (including failures and timeouts) the injected change list is refreshed.

An optional `workdir` argument overrides the working directory (defaults to session worktree or directory).

#### Security note (V2)

Because V2 cannot prompt, an agent that reads untrusted text (specs, issues, fetched pages) could be steered into archiving or creating changes without a prompt. Archived changes are recoverable through git. The only host-level control on V2 is denying the tool wholesale (`options.permission` is a deny-only visibility filter, see `docs/v2-compat-audit.md`); per-call prompts are not available. `openspec config set|reset`, `store register|remove` and `init`/`update` (with an arbitrary path) also run unprompted and can write outside the project.

### `openspec_status`

Structured wrapper for `openspec status --change <name> --json`. Returns:

```json
{
  "isPlanningComplete": true,
  "order": [
    { "artifact": "proposal", "status": "complete" },
    { "artifact": "design",   "status": "complete" },
    { "artifact": "specs",    "status": "complete" },
    { "artifact": "tasks",    "status": "complete" }
  ],
  "raw": { ... }
}
```

`order` always follows the canonical authoring sequence (proposal → design → specs → tasks), regardless of how the CLI's internal dependency graph is ordered. Use `isPlanningComplete` to determine whether to begin implementation; ignore the legacy `isComplete` field in `raw`.

### `openspec_instructions`

Structured wrapper for `openspec instructions <artifact> --change <name> --json`. Returns exactly the three fields an agent needs to write an artifact:

```json
{
  "template": "## Why\n\n...",
  "instruction": "Create the proposal document that establishes WHY ...",
  "resolvedOutputPath": "/path/to/openspec/changes/my-change/proposal.md"
}
```

Write the artifact content to `resolvedOutputPath`.

## System-prompt injection

When opencode loads this plugin in a project that contains an `openspec/` directory, every LLM call receives two extra items injected into the system prompt:

1. A **static tools notice** naming the three tools and directing the agent to use them instead of CLI commands.
2. A **dynamic active-changes summary** listing current changes with task-completion counts.

The injection cache is populated once per session and refreshed automatically after the plugin's own mutating tool calls (`new change`, `archive`). The system-prompt transform hook performs no filesystem or subprocess I/O — it only reads the in-memory cache.

- **On V1**, the cache is populated on the `session.created` event.
- **On V2**, the cache is populated **eagerly at plugin `setup()`**, using the plugin's own load-time directory — live verification against the real V2 host (`@opencode/cli` 2.0.3) found that `session.created` does not fire for single-shot `opencode run` invocations, so waiting on it alone would leave the cache empty. A `session.created` subscription is still kept as defense-in-depth for other hosting modes.

In projects without `openspec/`, the plugin is silent.

## Deployment

### V1 (`@opencode-ai/plugin`)

Loaded via opencode's file auto-discovery: create a symlink from the global plugins directory to the plugin's V1 entry point.

```bash
# Clone the repo
git clone <repo-url> ~/git/opencode-openspec

# Install dependencies
cd ~/git/opencode-openspec && npm install

# Create the symlink
ln -s ~/git/opencode-openspec/src/plugin.v1.js \
      ~/.config/opencode/plugins/opencode-openspec.js
```

### V2 (`@opencode/plugin`)

V2 auto-discovers plugins from a project-local `.opencode/plugins/` directory. Copy (or symlink) `src/plugin.v2.js` there, and place `src/core.js`/`src/lib/helpers.js` in a **sibling** `.opencode/lib/` directory — `.opencode/plugins/` scans and attempts to load *every* `.js` file placed directly inside it as an independent plugin candidate, so shared modules must live elsewhere.

```bash
mkdir -p .opencode/plugins .opencode/lib
cp ~/git/opencode-openspec/src/plugin.v2.js .opencode/plugins/openspec.js
cp ~/git/opencode-openspec/src/core.js .opencode/lib/core.js
cp ~/git/opencode-openspec/src/lib/helpers.js .opencode/lib/helpers.js
# adjust the two relative import paths in the copied files to match this layout
```

Restart opencode (or open a new session) for the plugin to take effect.

## Requirements

- Node.js ≥ 22.5 (or Bun, which opencode uses at runtime)
- `openspec` CLI on `PATH` (`npm install -g @fission-ai/openspec`)
- `@opencode-ai/plugin` ≥ 1.15.0 for V1 (provided by opencode's Bun runtime as a peer dep), and/or `@opencode/plugin` ≥ 2.0.0 for V2 — both are optional peer dependencies; only the one matching your host is ever imported

## Development

```bash
npm install
npm test
```

Tests use Jest with ESM support and fake the injected `exec` capability so no real `openspec` process is spawned (only `test/exec.test.js` starts real child processes).
