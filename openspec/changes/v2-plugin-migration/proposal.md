## Why

opencode's real V2 product (`@opencode/cli` / `@opencode/plugin`) does not
run V1 plugin implementations at all; this plugin (currently V1-only,
`@opencode-ai/plugin`) needs a genuine port to `Plugin.define`-shape
(`{id, setup(ctx)}`) before V1's documented, time-boxed compatibility
bridge closes. This plugin's prior `v2-compat-audit` change (already
archived) confirmed a real load-time regression against `opencode-ai@dev`
(later found to be the wrong target — V1's own prerelease channel, not the
real V2 product); this change supersedes that audit with a real port.

## What Changes

- Rename `src/index.js` → `src/plugin.v1.js` (V1 adapter, behavior
  unchanged) and add `src/plugin.v2.js` (V2 adapter). Shared logic (the
  `runOpenspec` CLI wrapper, cache population, the three tools' argument/
  result handling, the system-prompt notice/change-list composition) is
  extracted into a runtime-agnostic `src/core.js`, since — unlike
  `opencode-redact` — this plugin registers custom tools and needs the V2
  `codemode: false` tool-visibility fix already confirmed necessary in the
  `opencode-use` port.
- V1's `tool` hook (three custom tools built via `@opencode-ai/plugin`'s
  `tool()`/`tool.schema` builder) maps to V2's
  `ctx.tool.transform((editor) => editor.add({...}))`, with JSON Schema
  argument definitions (V2 has no Zod-like schema builder) and
  `options: { codemode: false }` on all three tools so they remain
  directly callable, not Code-Mode-only.
- V1's `event` hook (filtering for `session.created`) maps to V2's
  `ctx.event.subscribe({signal})`.
- V1's `experimental.chat.system.transform` maps to V2's
  `ctx.session.hook("context", (event) => { event.system.push(...) })`.
- V1's Bun `$` shell-exec shortcut (passed into the plugin factory as
  `PluginInput.$`) has no V2 `Context` equivalent — V2 must resolve
  `globalThis.Bun.$` once at `setup()` and fail loudly if absent, matching
  the pattern already established and reviewed in the `opencode-use` port.
- `context.ask` (used to gate destructive `openspec_cli` commands behind
  user confirmation) needs a V2-confirmed equivalent — a design decision,
  since V2's tool-execution context shape has not yet been confirmed for
  this specific capability in any prior port.

## Capabilities

### Modified Capabilities
- `plugin`: the module-shape and safety-property requirements (ESM
  factory, individually-wrapped hooks, no propagated exceptions) must be
  described in terms that hold for both the V1 factory-function shape and
  V2's `{id, setup(ctx)}` shape.
- `tools`: the three tools' behavior contract must be described
  independently of whether the argument schema is built with
  `@opencode-ai/plugin`'s `tool.schema` or V2's plain JSON Schema, and
  independently of which runtime's confirmation-gating mechanism is used
  for destructive commands.
- `system-prompt`: the injection mechanism description must hold for both
  `experimental.chat.system.transform`'s `(input, output)` shape and V2's
  `ctx.session.hook("context", event)` shape.

## Impact

- `src/index.js` (renamed), `src/core.js` (new), `src/plugin.v1.js` (new),
  `src/plugin.v2.js` (new), `package.json` (subpath exports, new optional
  peer/dev dependency), `test/` (import path updates, new V2
  adapter-conformance tests), `docs/v2-compat-audit.md` (rewritten).
- No behavior change for existing V1 users.
