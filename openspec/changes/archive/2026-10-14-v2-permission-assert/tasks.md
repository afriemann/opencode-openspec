# Tasks

Implementation starts only after direct approval of these artifacts. Scenario names in
`specs/tools/spec.md` are the test-name contract; preserve coverage of existing main-spec
scenarios and use parameterized cases where they cover one observable contract.

## 1. Audited V2 intent and invocation identity

- [x] 1.1 Run the existing `npm test` baseline through the project's tooling and capture its result; verify no failures before implementation and keep verbose output outside the repository.
- [x] 1.2 Add failing scenario-linked tests in `test/permission-intent.test.js` for every audited command/option row, canonical mutation actions, parent/global flags, aliases, required/optional operands, repeatable values, hidden/unknown forms, missing values, unsupported syntax, and help/value ambiguity; verify each new behavior fails before implementing it.
- [x] 1.3 Implement the closed intent grammar in new `src/lib/permissions.js`, reusing parsed argv rather than adding another tokenizer; verify the grammar/action tests pass and no unaudited form is silently accepted or dropped.
- [x] 1.4 Add failing invocation-binding scenarios, then implement lexical absolute-workdir and single JSON-resource construction; verify quoted/special-character values, relative-workdir base, symlink spelling, and exact cwd/argv equality in the scenario-linked tests.
- [x] 1.5 Document the audited syntax inventory, `unaudited-command` hint, CLI 1.14.1 baseline, and re-audit process in `README.md`; verify every documented form matches the accepted grammar and unsupported equals-option/terminator/bundle syntax is stated explicitly.

## 2. Native pre-spawn authorization and unchanged execution semantics

- [x] 2.1 Add failing scenario-linked pipeline tests in `test/cli-pipeline.test.js` for allow, pending ask, unchanged native denial/plain rejection/feedback/service failures, synchronous throws, immutable snapshot across pending approval, and zero invocation/refresh execution after refusals; verify the red step before changing the execution boundary.
- [x] 2.2 Add the injected V2 authorization boundary in `src/core.js` before spawn-error conversion and update the tool contract description; verify pipeline tests pass with the identical authorized cwd/argv, no V1 confirmation on V2, and no rejected-call refresh.
- [x] 2.3 Update scenario-linked cache, parser, block/help, and executed-command tests for the modified requirements; verify authorized nonzero exits/timeouts retain refresh, failed refresh preserves cache, parse/block errors keep their reasons, and no shell or injected flags are introduced.
- [x] 2.4 Document invocation authorization versus filesystem containment, environment/external/global effects, overwrite/removal effects, native error behavior, and omitted reusable grants in `README.md`; verify the text matches the tools delta and preserves existing post-execution cache semantics.

## 3. V2 adapter, compatibility, and V1 regression

- [x] 3.1 Add failing v2.0.29-source-shaped adapter tests in `test/plugin.v2.test.js` for required session/action/resource metadata, optional provenance, preserved method receiver, omitted `message`/`save`, missing/non-callable capability, and missing/empty/non-string session identity; verify red-step failure before adapter changes.
- [x] 3.2 Wire native `ctx.permission.assert` and actual calling context in `src/plugin.v2.js`, with `permission-unavailable` refusal and no fallback; verify all adapter scenarios pass and the original native rejection object escapes the adapter unchanged.
- [x] 3.3 Update scenario-linked `test/adapter-conformance.test.js` coverage for intentional V2 differences and preserved V1 broad grammar, destructive confirmation/cancellation, dedicated status/instructions, context injection, and cleanup; verify existing V1 behavior without changing its adapter or executor.
- [x] 3.4 Set optional V2 peer to `>=2.0.29`, pin development SDK to `2.0.29`, and synchronize `package-lock.json`; verify manifest/lock consistency and unchanged V1 peer `>=1.15.0` using the project's package workflow.
- [x] 3.5 Replace obsolete capability claims in `docs/v2-compat-audit.md` and update `README.md` with the tagged API source, native ordered policy example, action inventory, last-match/no-match semantics, pattern caveats, and installation-versus-runtime fallback distinction; verify against the exact v2.0.29 contract and document ai-dotfiles/vendor integration as separate.

## 4. Integrated verification and review

- [x] 4.1 Run the full `npm test` suite and all configured project quality gates with captured logs; verify every test passes, each changed scenario has name-linked coverage, and no test lacks a behavioral requirement in the main spec or delta.
- [x] 4.2 Self-review the diff for duplication, smells, overengineering, redundant comments, secrets, and out-of-scope edits; verify the main tools spec, vendor/chezmoi, AGENTS/instruction files, V1 adapter, and executor remain untouched before archive.
- [x] 4.3 Obtain code-reviewer plus authorization/domain-conformance review using proposal, specs, design, and diff; resolve every blocker and record an accepted/rejected disposition for every warning, then verify required re-review and the suite pass.

## Workflow follow-up

Verification evidence: baseline 166 tests passed; core red step observed 50 behavioral
failures before implementation, then 254 tests passed. Adapter red step observed 20
behavioral failures before wiring, then the integrated suite passed with 274 tests.
Unchanged scenarios remain regression tests. Manifest constants and generated lockfile
updates, documentation, and mechanical comment/test-name cleanup do not require TDD.

Final verification: 278 tests in eight suites pass on Node 26.11.1 with SDK 2.0.29;
all 40 delta scenarios have passing name-linked tests. No lint/build/pre-commit target
is configured. Review-driven quoted-command negatives were observed failing (four
cases) before the token-boundary fix. V1 adapter, existing parser/executor, main specs
and protected/integration paths remain untouched before archive.

Review dispositions:
- Code review: approved after full artifact/source and critical test-body inspection;
  no blockers or open warnings, no orphan or bloated tests found.
- Initial read-only-report concern: rejected after source verification; CLI 1.14.1
  `--report` selects full/findings console content, not a file. JSON matching warning:
  accepted through explicit serialized-resource and pattern caveats.
- Lockfile provenance warning: rejected with `npm ls` evidence; every changed version
  is in SDK 2.0.29's dependency subtree, including shared/deduplicated Effect 4.0.1.
- Main-spec link warning: accepted via the mandatory archive-before-push gate; the
  separate archival commit updates the linked contract in this same PR.
- Plugin-conformance warnings: accepted and verified fixed — exact-tag `*`/`?` and
  backslash caveats, complete plain-copy deployment without a symlink claim, and
  token-wise help matching plus closed root-command validation.
- Authorization review: approved, no blockers/warnings. Promise context signal fact
  reconciled against the exact tag and SDK; no cancellation scope added.
- Suggestions: accepted immutable classification locals, audit date and accurate V1
  cache-test title. Rejected description shortening (always-visible security contract),
  cosmetic missing-subcommand text (clear refusal/hint already exists), and extra
  relative-workdir prose (already documented). Separate grammar/action parameterized
  tests retained because they assert different observable contracts.

- Commit the reviewed implementation and artifacts with precise staging.
- Archive `v2-permission-assert` through the OpenSpec tool, verify the main tools spec update, and commit archival separately.
- Push all commits, open or update the task PR, verify remote status and PR URL, and remove the isolated worktree only after verified publication.
- ai-dotfiles pin/config integration and vendor/chezmoi deployment are separate, explicitly approved follow-ups.
- Stale AGENTS.md parity/capability guidance requires a separately scoped agent-engineer change; do not edit it here.
