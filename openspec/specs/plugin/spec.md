# plugin Specification

## Purpose
Defines the module shape, packaging contract, and safety properties of the `opencode-openspec`
opencode plugin: how it is loaded, how its factory is structured, and how it must behave at the
process boundary to avoid disrupting the host opencode session.

## Requirements

### Requirement: Plugin is a valid ESM opencode plugin

The plugin module SHALL be a valid opencode plugin: an ESM file with `"type": "module"` in
`package.json`, exporting a plugin factory as a default export only. The module SHALL NOT
export anything else by name. `@opencode-ai/plugin` SHALL be declared in `peerDependencies`
only — never in `dependencies` — so the runtime-resolved copy provided by Bun is used.

#### Scenario: Factory loads and returns hooks

- **WHEN** opencode loads the plugin via a symlink from `~/.config/opencode/plugins/`
- **THEN** the factory function is called with `PluginInput`
- **AND** it returns a `Hooks` object containing `event`, `tool`, and `experimental.chat.system.transform` hooks without throwing

#### Scenario: Plugin loads without runtime dependencies

- **WHEN** the plugin is loaded in an environment where only the peer `@opencode-ai/plugin` is present
- **THEN** the module initialises successfully with no missing-module errors

#### Scenario: Module exports nothing but default

- **WHEN** the plugin module is imported as an ES module namespace
- **THEN** `Object.keys` of that namespace is exactly `['default']`
- **AND** no internal helper, CLI-runner, or cache function is reachable as a named export

### Requirement: Plugin never throws into opencode

Every event handler and intercept hook in the plugin SHALL be individually wrapped so that an
internal error is caught and logged rather than propagated into opencode's hook pipeline. A
failure in one hook SHALL NOT affect other hooks or block the LLM call from proceeding.

#### Scenario: Error inside event hook is swallowed

- **WHEN** an internal error occurs inside the `event` hook
- **THEN** the error is logged via `client.app.log` (falling back to `process.stderr.write` if logging fails)
- **AND** no exception propagates out of the hook

#### Scenario: Error inside transform hook is swallowed

- **WHEN** an internal error occurs inside `experimental.chat.system.transform`
- **THEN** the error is logged
- **AND** the hook returns normally, allowing the LLM call to proceed

### Requirement: Plugin never writes to console

The plugin SHALL NOT call `console.log`, `console.warn`, `console.error`, or any other
`console.*` method, because such output leaks into the opencode TUI and pollutes the user's
terminal. All structured logging SHALL use `client.app.log` with service name
`"opencode-openspec"`.

#### Scenario: Logging falls back to stderr, not console

- **WHEN** `client.app.log` throws or returns a rejected promise
- **THEN** the plugin falls back to `process.stderr.write`
- **AND** no `console.*` method is called
