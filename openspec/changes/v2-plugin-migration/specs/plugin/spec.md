## MODIFIED Requirements

### Requirement: Plugin is a valid ESM opencode plugin

The plugin SHALL be a valid opencode plugin on both the V1 (`@opencode-ai/plugin`) and V2
(`@opencode/plugin`) hosts, using each runtime's own required shape. Each host entrypoint module
(`src/plugin.v1.js`, `src/plugin.v2.js`) SHALL export its factory or definition as a default
export only, and SHALL NOT export anything else by name — this holds independently for each
entrypoint file. The plugin SHALL declare each host SDK as an optional peer dependency only —
never in `dependencies` — so the runtime-resolved copy is used and neither SDK is ever imported
at runtime by the plugin itself.

#### Scenario: Factory loads and returns hooks

- **WHEN** opencode V1 loads the plugin via a symlink from `~/.config/opencode/plugins/`
- **THEN** the factory function is called with `PluginInput`
- **AND** it returns a `Hooks` object containing `event`, `tool`, and `experimental.chat.system.transform` hooks without throwing

#### Scenario: V2 module loads and registers its capabilities

- **WHEN** opencode V2 loads the plugin via `.opencode/plugins/` auto-discovery or an explicit `plugins` config entry
- **THEN** the plugin's `setup` function is called with the V2 context
- **AND** it registers the tool, event-subscription, and system-prompt capabilities without throwing, returning a cleanup function

#### Scenario: Plugin loads without runtime dependencies

- **WHEN** the plugin is loaded in an environment where only the relevant runtime's host SDK is present
- **THEN** the module initialises successfully with no missing-module errors

#### Scenario: Module exports nothing but default

- **WHEN** `src/plugin.v1.js` or `src/plugin.v2.js` is imported as an ES module namespace
- **THEN** `Object.keys` of that namespace is exactly `['default']`
- **AND** no internal helper, CLI-runner, or cache function is reachable as a named export from either entrypoint

### Requirement: Plugin never throws into opencode

Every event handler and intercept hook in the plugin SHALL be individually wrapped so that an
internal error is caught and logged rather than propagated into opencode's hook pipeline. A
failure in one hook SHALL NOT affect other hooks or block the LLM call from proceeding. On a
runtime whose event delivery is a continuous stream, a failure while handling one event SHALL
NOT terminate the stream for subsequent events.

#### Scenario: Error inside event hook is swallowed

- **WHEN** an internal error occurs inside the event-handling hook
- **THEN** the error is logged (falling back to `process.stderr.write` if the runtime's own logging channel fails)
- **AND** no exception propagates out of the hook

#### Scenario: Error inside transform hook is swallowed

- **WHEN** an internal error occurs inside the system-prompt injection hook
- **THEN** the error is logged
- **AND** the hook returns normally, allowing the LLM call to proceed

#### Scenario: A failure handling one event in a continuous stream does not stop later events

- **WHEN** the runtime delivers events as a continuous stream and handling one event raises an internal error
- **THEN** that error is logged
- **AND** subsequent events in the stream continue to be handled normally

### Requirement: Plugin never writes to console

The plugin SHALL NOT call `console.log`, `console.warn`, `console.error`, or any other
`console.*` method, because such output leaks into the opencode TUI and pollutes the user's
terminal. All structured logging SHALL use the runtime's own logging channel when one is
available, with service name `"opencode-openspec"`, and SHALL fall back to
`process.stderr.write` when the runtime has no logging channel or that channel fails.

#### Scenario: Logging falls back to stderr, not console

- **WHEN** the runtime's logging channel is unavailable, throws, or returns a rejected promise
- **THEN** the plugin falls back to `process.stderr.write`
- **AND** no `console.*` method is called

### Requirement: Every registered capability is released on unload

On a runtime whose capability registration returns a disposable handle, the plugin SHALL retain
every such handle and release all of them when the plugin is unloaded or its cleanup is invoked.

#### Scenario: Cleanup disposes every registered capability

- **WHEN** the plugin's cleanup is invoked
- **THEN** every previously registered capability handle is disposed
- **AND** no further events are delivered to the plugin after cleanup completes
