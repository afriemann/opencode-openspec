# Spec Delta

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
- **AND** it registers the tool, event-subscription, system-prompt, and bundled on-demand skill capabilities without throwing, returning a cleanup function

#### Scenario: Plugin loads without runtime dependencies

- **WHEN** the plugin is loaded in an environment where only the relevant runtime's host SDK is present
- **THEN** the module initialises successfully with no missing-module errors

#### Scenario: Module exports nothing but default

- **WHEN** `src/plugin.v1.js` or `src/plugin.v2.js` is imported as an ES module namespace
- **THEN** `Object.keys` of that namespace is exactly `['default']`
- **AND** no internal helper, CLI-runner, or cache function is reachable as a named export from either entrypoint

## ADDED Requirements

### Requirement: V2 provides the packaged OpenSpec skill on demand

The V2 plugin SHALL expose the bundled `openspec` skill through the native skill registry with metadata from its frontmatter, its absolute packaged file path, and its Markdown body as content, without injecting that body unconditionally into session context.

#### Scenario: Packaged skill is available independently of the project directory

- **GIVEN** the package contains `skills/openspec/SKILL.md`
- **WHEN** the V2 plugin loads for a project outside the package directory
- **THEN** the native registry exposes ID and name `openspec`, the packaged description, its absolute file path, and content excluding frontmatter
- **AND** the bundled body is not appended to session context

#### Scenario: Skill transform replay retains the packaged skill

- **WHEN** the host replays the plugin's skill registration against a fresh registry
- **THEN** the same packaged skill is available without duplicate entries

### Requirement: Other OpenSpec skill definitions take precedence

The V2 plugin SHALL preserve an existing skill with ID `openspec` and allow a subsequently discovered skill with that ID to replace its bundled definition.

#### Scenario: An earlier OpenSpec skill is preserved

- **GIVEN** the registry already contains a skill with ID `openspec`
- **WHEN** the plugin's skill registration is applied
- **THEN** the existing skill is unchanged and no replacement is added

#### Scenario: A later discovered OpenSpec skill overrides the bundle

- **GIVEN** the plugin has registered its bundled skill
- **WHEN** the host applies a subsequently discovered skill with ID `openspec`
- **THEN** that discovered skill is the active definition
- **AND** unloading the plugin leaves the discovered skill intact

### Requirement: Bundled skill failures are isolated

The V2 plugin SHALL log and skip unavailable bundled-skill registration without disabling its existing tools, event handling, or session-context hook.

#### Scenario: Missing native skill capability preserves existing capabilities

- **WHEN** the V2 host does not expose native skill registration
- **THEN** the plugin logs the unavailable capability and still loads its existing capabilities

#### Scenario: Unreadable or malformed bundled skill preserves existing capabilities

- **WHEN** the packaged skill cannot be read or has unsupported metadata or an empty body
- **THEN** the plugin logs the skill-loading failure, exposes no bundled skill, and still loads its existing capabilities

#### Scenario: Skill registration failure preserves existing capabilities

- **WHEN** the native skill registration or a replayed registry edit fails
- **THEN** the plugin logs the failure without propagating it into the host
- **AND** its existing capabilities remain available
