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
openspec_cli({ command: "new change my-feature" })   // requires confirmation
openspec_cli({ command: "archive my-change --yes" }) // requires confirmation
```

Returns `{ stdout, stderr, exitCode }`. A non-zero `exitCode` is a normal result — inspect `stderr` for details. Destructive verbs (`archive`, `new change`) require explicit user approval via opencode's permission prompt before executing. If the user denies, the tool returns `{ cancelled: true }` without running anything.

An optional `workdir` argument overrides the working directory (defaults to session worktree or directory).

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

The injection cache is populated once per session (on `session.created`) and refreshed automatically after the plugin's own mutating tool calls (`new change`, `archive`). The system-prompt transform hook performs no filesystem or subprocess I/O — it only reads the in-memory cache.

In projects without `openspec/`, the plugin is silent.

## Deployment

The plugin is loaded via opencode's file auto-discovery: create a symlink from the global plugins directory to the plugin's entry point.

```bash
# Clone the repo
git clone <repo-url> ~/git/opencode-openspec

# Install dependencies
cd ~/git/opencode-openspec && npm install

# Create the symlink
ln -s ~/git/opencode-openspec/src/index.js \
      ~/.config/opencode/plugins/opencode-openspec.js
```

Restart opencode (or open a new session) for the plugin to take effect.

## Requirements

- Node.js ≥ 22.5 (or Bun, which opencode uses at runtime)
- `openspec` CLI on `PATH` (`npm install -g @fission-ai/openspec`)
- `@opencode-ai/plugin` ≥ 1.15.0 (provided by opencode's Bun runtime as a peer dep)

## Development

```bash
npm install
npm test
```

Tests use Jest with ESM support and mock the Bun `$` shell so no real `openspec` process is spawned.
