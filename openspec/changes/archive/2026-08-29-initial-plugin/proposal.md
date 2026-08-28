## Why

Agents using OpenSpec must memorise exact CLI flag syntax, manually parse JSON output, and
make multiple round-trips (e.g. call `openspec instructions` → extract `resolvedOutputPath` →
write the file) every time they work on a change. This friction causes agents to skip steps
or make mistakes. The `openspec` CLI was designed for humans; agents need a native plugin interface.

## What Changes

- Introduce an opencode plugin (`opencode-openspec`) that wraps the OpenSpec CLI as first-class tools.
- **New tool `openspec_cli`**: runs any `openspec` subcommand and returns structured `{ stdout, exitCode, stderr }` — acts as the full-surface escape hatch.
- **New tool `openspec_status`**: calls `openspec status --change <name> --json` and returns the structured artifact dependency graph, completion flags, and resolved file paths in a single call.
- **New tool `openspec_instructions`**: calls `openspec instructions <artifact> --change <name> --json` and returns `{ template, instruction, resolvedOutputPath }` — giving the agent exactly the template to fill and the path to write it to without further parsing.
- **System-prompt injection**: on every LLM call in a session whose project directory contains `openspec/`, the plugin injects a tools-available notice and a cached list of active changes (refreshed on session start and with a 30-second TTL).

## Capabilities

### New Capabilities

- `plugin`: Plugin factory, ESM module structure, loading via symlink, `package.json` fields, peer-dep contract, and Jest test suite.
- `tools`: All three tool registrations — `openspec_cli`, `openspec_status`, `openspec_instructions` — including argument shapes, `cwd` resolution (`context.worktree ?? context.directory` with optional override), and error handling.
- `system-prompt`: `experimental.chat.system.transform` hook that detects openspec presence, caches the active changes list per session, and injects the tools-available protocol into every LLM call.

### Modified Capabilities

_(none — new project)_

## Impact

- **New file**: `src/index.js` (the plugin)
- **New file**: `package.json`
- **New file**: `test/` (Jest tests)
- **Deployment**: symlink `~/.config/opencode/plugins/opencode-openspec.js → <repo>/src/index.js`
- **Dependencies**: none at runtime; `@opencode-ai/plugin` is a peer dep provided by the host Bun runtime; `jest` as dev dep for tests
- **openspec CLI**: required on `PATH` at the path returned by `which openspec` (already present on the host)
