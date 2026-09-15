## MODIFIED Requirements

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
