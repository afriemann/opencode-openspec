# Proposal

## Why

Installing this plugin should also make the existing OpenSpec workflow skill available, without a separate skill installation. Bundle the existing skill unchanged rather than maintain a rewritten variant.

## What Changes

- Provide the bundled `openspec` skill on demand on OpenCode V2.
- Preserve an existing skill with the same ID and release the plugin's registration on unload.
- Document V2 skill availability and the unchanged skill's references to other skills and agent roles.

## Capabilities

### Modified Capabilities

- `plugin`: Extend the V2 capability contract to include a packaged, on-demand skill with existing-skill precedence and lifecycle cleanup.

## Impact

- Add `skills/openspec/SKILL.md` as an unchanged copy of the existing skill.
- Update `src/plugin.v2.js`, `test/plugin.v2.test.js`, and `README.md`.
- V1, existing tools and context injection, dependencies, package settings, and the installed source skill remain unchanged.
- Making the skill standalone or bundling its referenced skills and agents is outside scope.
