# Proposal

## Why

The bundled `openspec` skill still tells agents to run raw `openspec` CLI strings, although the plugin provides dedicated status and instructions tools. Aligning the wording makes the bundled skill match the tools it ships with.

## What Changes

- Bundled skill prefers `openspec_status`, `openspec_instructions`, then `openspec_cli`; apply/archive guidance goes through `openspec_cli`.
- Raw CLI fallback only when plugin tools are absent, never to bypass a refusal or permission denial.
- README describes the skill as adapted for the plugin tools, not an unchanged copy.

## Capabilities

### New Capabilities
### Modified Capabilities

## Impact

`skills/openspec/SKILL.md` and `README.md` only. No runtime source, installed skill, or archived design changes.
