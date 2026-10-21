# Tasks

## 1. Bundled skill and native registration

- [x] 1.1 Add failing scenario-named V2 tests for packaged availability, replay, and both precedence paths; verify the red run before implementation.
- [x] 1.2 Have agent-engineer copy the existing skill unchanged to `skills/openspec/SKILL.md`; verify byte identity once against the source.
- [x] 1.3 Implement design D1–D2 in `src/plugin.v2.js`; verify the registration and precedence scenarios pass.
- [x] 1.4 Extend the existing cleanup test for the skill handle and preserve all existing module-loading/export assertions; verify plugin lifecycle tests pass.
- [x] 1.5 Update README with V2-only availability, on-demand loading, precedence, and referenced-skill/agent caveats; verify it matches the implemented contract.

## 2. Failure isolation

- [x] 2.1 Add failing scenario-named tests for missing skill capability, unreadable/malformed asset, and registration/replay failure; verify the red run before failure handling.
- [x] 2.2 Implement design D3; verify each failure scenario preserves existing capabilities and emits a diagnostic.

## 3. Integration verification and review

- [x] 3.1 Run the complete Jest suite and npm package dry-run; verify all tests pass and the bundled skill is included without manifest/dependency changes.
- [x] 3.2 Self-review the diff for simplification and obtain code-reviewer plus agent-engineer conformance review; resolve blockers and record warning dispositions.

## Workflow follow-up

- Red run: 16 expected assertion failures, 27 existing tests passed; green run: all 43 V2 tests passed. Skill copy byte identity verified (21,231 bytes). README/static asset copy need no separate literal-only tests; registration is exercised behaviorally.
- Scope remains the confirmed bundled asset, V2 adapter/tests, README, and OpenSpec artifacts; V1, dependencies, package settings, installed source, and agent instructions remain unchanged.
- Verification: 292 tests passed across 8 suites; package dry-run includes the 21,231-byte skill; no lint/build target or pre-commit configuration exists. Adding tooling is outside the approved scope.
- Self-review: no duplicated production logic, named code smells, speculative layers, or new historical-narration comments found. The strict extractor and table-driven failure cases are intentional.
- Reviews: code-reviewer and agent-engineer found no blockers or warnings. Optional cleanup hardening, defensive replay cloning, and exact diagnostic assertions are deferred: current tests cover the approved behavior and these add unrelated failure contracts or implementation coupling. Existing setup assertion and unchanged V1 installation instructions already satisfy the documentation/test suggestions. Asset identity and package inclusion were verified; the temporary dependency symlink is not part of the commit.

- Commit the reviewed change, archive through OpenSpec, and commit the archival separately.
- Push the branch, open the PR, and verify repository/worktree cleanup.
