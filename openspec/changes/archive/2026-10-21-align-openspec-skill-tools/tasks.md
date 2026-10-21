## 1. Skill and README alignment

- [x] 1.1 Add a "Tool Use" section to `skills/openspec/SKILL.md`: tool preference order, no-prefix command form, fallback only when tools are absent, refusals reported not bypassed.
- [x] 1.2 Route status, artifact instructions, setup, new change, validate, apply/archive guidance, and archive through the tools in the skill body; drop the superseded `isComplete`, status-order, and duplicate "never plain bash" text.
- [x] 1.3 Rename the CLI Reference table to a tool reference naming the tool per row.
- [x] 1.4 Replace the README "unchanged copy" wording with "adapted for the plugin tools".
- [x] 1.5 Run `npm test` and the code-review gate; verify the diff touches only the two files plus this change.
- [x] 1.6 Archive with `archive align-openspec-skill-tools --yes --skip-specs`; commit separately and push to PR #23.

## Notes

- Docs-only (instruction text); TDD skipped, no literal-only tests. `npm test`: 292 passed. `code-reviewer`: Approve, no blockers.
