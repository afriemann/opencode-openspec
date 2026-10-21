# opencode-openspec

An [opencode](https://github.com/anomalyco/opencode) plugin that wraps the [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI as first-class agent tools and injects active-change context into the LLM system prompt on every call.

## Why

Agents using OpenSpec must memorise exact CLI flag syntax, manually parse JSON output, and make multiple round-trips (e.g. call `openspec instructions` → extract `resolvedOutputPath` → write the file). This plugin removes that friction.

## Tools

### `openspec_cli`

Runs `openspec` subcommands. V1 retains broad command support; V2 accepts only the audited CLI 1.14.1 forms below. The `command` argument is the full subcommand and flags as a string.

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
- **V1 confirmation:** destructive verbs (`archive`, `new change`, `store remove|unregister`, `workset remove`, `config reset|unset`) go through `context.ask`; denial returns `{ cancelled: true }` without running anything.
- **V2 authorization:** every supported mutation awaits `ctx.permission.assert` using its own `openspec.<operation>` action. Allow can proceed without prompting; ask waits for host approval. Native denial, plain rejection, corrective-feedback rejection, and permission-service errors propagate unchanged before execution. Plain rejection retains the host's step-ending behavior; it is not converted into a normal cancellation result.
- **Cache:** after an executed non-read-only command (including failures and timeouts) the injected change list is refreshed. Pre-execution refusal or permission rejection causes no invocation-related refresh. Independent setup/session cache population is unchanged.

An optional `workdir` argument overrides the working directory (defaults to session worktree or directory).

#### Supported command forms (V2)

The grammar is audited against OpenSpec **1.14.1** (2026-10-14), not inferred from a verb's name. The [tools contract](openspec/specs/tools/spec.md) lists every accepted operand and flag, including hidden `--store-path`, `--initiative`, and `--areas` options. Read-only forms are:

```text
version, list, view, show, validate, status, instructions, templates, schemas
change show|list|validate
config path|list|get
schema which|validate
store list|ls|doctor
workset list|ls
completion generate
```

Supported mutations have distinct, stable policy actions:

| Operation | Action | Authorized effects |
| --- | --- | --- |
| `new change` | `openspec.new.change` | Create artifacts and supporting project directories/config |
| `archive` | `openspec.archive` | Move the change and, unless skipped, update/remove main specs |
| `init` | `openspec.init` | Generate/update/remove project integrations, including Copilot files |
| `update` | `openspec.update` | Regenerate/remove existing integrations |
| `store setup` | `openspec.store.setup` | Initialize a store, optionally initialize git, register globally |
| `store register` | `openspec.store.register` | Update global registry and possibly store metadata |
| `store unregister` | `openspec.store.unregister` | Remove global registration; retain store files |
| `store remove` | `openspec.store.remove` | Unregister and recursively delete the store root |
| `workset create` | `openspec.workset.create` | Write global workset state |
| `workset remove` | `openspec.workset.remove` | Remove state and derived workspace file |
| `config set` | `openspec.config.set` | Write global configuration |
| `config unset` | `openspec.config.unset` | Remove a global configuration key |
| `config reset` | `openspec.config.reset` | Reset global configuration |
| `config profile` | `openspec.config.profile` | Change global profile; CLI may offer project updates |
| `schema fork` | `openspec.schema.fork` | Create a schema; `--force` permits replacement |
| `schema init` | `openspec.schema.init` | Create/replace a schema; optional project-default update |

Use **separate option/value tokens** (`--change my-change`). Listed single-token aliases, global `--no-color`, config parent `--scope global`, and workset parent `--json` are supported. Long-option equals syntax (`--change=my-change`), `--` terminators, and short-flag bundles are refused. Equals signs inside ordinary values remain literal. A narrow bare-help request, such as `archive --help` or `config edit -h`, is read-only; help as an option value or mixed with operands does not exempt a mutation.

Unknown verbs, subcommands, flags (even on read-only verbs), and malformed arity return `{ cancelled: true, reason: "unaudited-command", error, hint }` before any assertion or subprocess. Hidden `experimental`/`__complete` and unaudited `context`, top-level `doctor`, and `spec` forms are not supported. Existing interactive/out-of-scope blocks keep their original refusal reasons.

For a CLI upgrade, inspect its command registrations and mutation handlers, update the tools contract, grammar and scenario-linked tests together, then review before enabling new forms. The plugin does **not** enforce a CLI version pin: later releases can change the effects of already-known invocations without changing their tokens.

#### Permission rules and security boundaries (V2)

OpenCode **2.0.29+** exposes the native assertion [Promise API](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/plugin/src/promise/permission.ts) and [input schema](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/plugin/src/permission.ts). Each mutation requests one resource:

```text
JSON.stringify([absoluteEffectiveWorkdir, ...parsedArgv])
```

For example, `new change my-change` in `/repo` requests `["/repo","new","change","my-change"]`. Lexical path resolution preserves symlink spelling; a relative `workdir` resolves against the host process's working directory. Argument boundaries and the effective workdir are captured once before approval and used unchanged for execution. Metadata contains the readable operation, workdir and argv; actual session identity is required, and optional agent/tool provenance is forwarded only when well formed.

Native V2 configuration uses an ordered `permissions` array. Place these rules **after** broad defaults so that they take precedence:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "openspec.*", "resource": "*", "effect": "ask" },
    {
      "action": "openspec.new.change",
      "resource": "[\"/repo\",\"new\",\"change\",\"my-change\"]",
      "effect": "allow"
    },
    { "action": "openspec.store.remove", "resource": "*", "effect": "deny" }
  ]
}
```

Rules are **last-match-wins**; no matching rule defaults to ask. Configured deny is checked before saved allows. Existing saved allows and evaluation hooks can affect allow/ask decisions. Creation permission does not also grant archival or removal permission. `options.permission` catalogue filtering is not a substitute for execution-time assertion.

The plugin omits `save`, so an invocation does not generate new reusable grants. This does **not** erase existing saved permissions or override broad configured allows. Rules match the serialized JSON resource using wildcard **patterns**, not literal string equality: JSON serialization does not escape the host's pattern language. Copying a resource containing `*` or `?` into a rule can broaden it; the concrete allow example intentionally contains no wildcard operands. The [v2.0.29 matcher](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/util/wildcard.ts) also normalizes backslashes to `/` on both sides. Equivalent commands with different flags or path spellings can have different resources.

Authorization covers the **exact invocation and its OpenSpec-resolved effects**, not filesystem containment. OpenSpec root/store selection, default stores, global config and inherited environment (`HOME`, XDG or OpenSpec settings) can direct writes outside the workdir. Accepted flags authorize their full effects, including overwrite or recursive deletion. No filesystem sandbox, rollback, or shell-permission fallback is provided.

Missing/non-callable `permission.assert` or invalid calling session identity returns `{ cancelled: true, reason: "permission-unavailable", error, hint }` before mutation execution. Older manually loaded V2 runtimes retain audited read-only tools and context injection, but strict package managers may reject their peer mismatch rather than load the plugin.

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

The injection cache is populated on setup/session events and refreshed automatically after executed mutating tool calls. The system-prompt transform hook performs no filesystem or subprocess I/O — it only reads the in-memory cache.

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

V2 auto-discovers plugins from a project-local `.opencode/plugins/` directory. Keep the package layout intact: `.opencode/plugins/` scans every direct `.js` child as a plugin, so shared modules must not sit alongside the entrypoint. For a plain-copied install, copy both `src/` and `skills/` into a sibling directory and add a default-export wrapper:

```bash
mkdir -p .opencode/plugins .opencode/lib/openspec
cp -R ~/git/opencode-openspec/src ~/git/opencode-openspec/skills .opencode/lib/openspec/
cat > .opencode/plugins/openspec.js <<'JS'
export { default } from '../lib/openspec/src/plugin.v2.js'
JS
```

Restart opencode (or open a new session) for the plugin to take effect.

The V2 entrypoint registers the packaged `openspec` skill natively, making it available to load on demand without a separate skill installation. Its full body is not injected into every prompt. V1 does not register the bundled skill.

Other definitions with the same skill ID take precedence: an earlier registration is preserved, and a later config-discovered skill overrides the bundle. In particular, an existing local `openspec` skill shadows the packaged copy, including future bundled updates. Unloading the plugin removes only its own registration.

The skill is the existing workflow adapted for the plugin tools. It references other skills (including `coding` and `upgrade-planning`) and agent roles that this package does not supply; install those separately if you want the complete referenced workflow. If native skill registration is unavailable or the bundled file cannot be loaded, the plugin logs the problem and keeps its tools and context hooks available.

Installed vendor copies, chezmoi-rendered files, and ai-dotfiles plugin pins/host permission rules are separate integration work; this repository change does not update them.

## Requirements

- Node.js ≥ 22.5 (or Bun, which opencode uses at runtime)
- `openspec` CLI on `PATH` (`npm install -g @fission-ai/openspec`)
- `@opencode-ai/plugin` ≥ 1.15.0 for V1, and/or `@opencode/plugin` ≥ 2.0.29 for full V2 mutation support — both are optional peer dependencies. The V2 adapter also checks native capability at runtime; a version claim alone does not bypass protection.

## Development

```bash
npm install
npm test
```

Tests use Jest with ESM support and fake the injected `exec` capability so no real `openspec` process is spawned (only `test/exec.test.js` starts real child processes).
