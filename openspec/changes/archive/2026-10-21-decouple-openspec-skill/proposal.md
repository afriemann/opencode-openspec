# Proposal

## Why

The bundled `openspec` skill still encodes one local setup: named agent roles, external skill dependencies, mandatory review routing, size tiers and custom approval gates. A package shipped to other users should describe only OpenSpec mechanics and the plugin tools.

## What Changes

- Remove the Cross-Skill Integration table, named-agent assignments, external-skill dependencies and mandatory review routing from `skills/openspec/SKILL.md`.
- Remove Lite/Full limits, the alignment and exemption policy, prescribed test names, `// spec:` comments, commit-message format and the `todowrite` expectation.
- Follow the artifact prerequisites reported by `openspec_status` instead of a custom sequence.
- Keep tool usage, setup, spec-authoring formats, exact-match MODIFIED rules, sync and archive mechanics.
- README describes the skill as self-contained.

## Capabilities

### New Capabilities
### Modified Capabilities

## Impact

`skills/openspec/SKILL.md` and `README.md` only. No runtime source, installed skill or archived design changes.
