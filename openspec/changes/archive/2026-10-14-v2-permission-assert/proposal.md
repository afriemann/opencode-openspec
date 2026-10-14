# Proposal

## Why

V2 currently executes mutating OpenSpec CLI operations without a plugin-level authorization check, relying on broad host-tool permissions. OpenCode v2.0.29 exposes `ctx.permission.assert`, enabling operation-specific policy evaluation before the CLI subprocess starts while preserving V1 confirmation behavior.

## What Changes

- Add native V2 authorization for every supported mutating invocation, distinguishing `openspec.new.change`, `openspec.archive`, and individual store, workset, configuration, schema, initialization, and update operations.
- Bind authorization to the exact parsed argument vector and effective absolute working directory that will be executed. This authorizes the invocation and its OpenSpec-resolved effects, including global configuration, external stores, overwrite flags, and recursive removal; it is not a filesystem sandbox.
- Await assertion before command execution or invocation-triggered cache refresh. Allow may proceed without a prompt; ask waits for the host decision. Propagate denial, plain rejection, rejection with corrective feedback, and permission-service failures unchanged.
- Omit `save` so the plugin requests no new reusable grants; explicitly configured or previously saved permissions remain effective.
- **BREAKING (V2 only):** Accept an explicit command/subcommand/flag grammar audited against OpenSpec CLI 1.14.1. Refuse unknown command forms and unaudited flags, including flags on read-only operations, rather than execute potentially unclassified mutations. Preserve existing blocklist and narrow bare-help handling.
- **BREAKING (V2 mutation compatibility):** Require OpenCode V2 >=2.0.29 and callable native assertion support with actual session identity. Older or malformed runtimes retain read-only functionality but explicitly refuse mutations; no unguarded fallback.
- Preserve V1 classification, confirmation, parsing, process execution, timeout handling, and existing post-execution cache refresh behavior. Preserve `openspec_status`, `openspec_instructions`, and context injection.
- Document native ordered `permissions` rules, last-match-wins semantics, invocation-resource limitations, and the version-specific compatibility floor.

## Capabilities

### New Capabilities

None; authorization belongs to the existing agent-facing tools contract.

### Modified Capabilities

- `tools`: Replace V2's broad-tool-only mutation authorization with native pre-spawn assertions, add fail-closed command coverage and capability handling, and preserve V1 and authorized execution semantics.

## Impact

- Code: new `src/lib/permissions.js`; `src/core.js`; `src/plugin.v2.js`. Reuse the existing command parser and executor; no intended edits to `src/plugin.v1.js` or `src/lib/exec.js`.
- Dependencies: optional V2 peer minimum `>=2.0.29`, development SDK pinned to `2.0.29`, synchronized `package-lock.json`; V1 peer remains `>=1.15.0`.
- Tests: new `test/permission-intent.test.js`; `test/cli-pipeline.test.js`, `test/plugin.v2.test.js`, and `test/adapter-conformance.test.js`. Cover audited forms, operation separation, immutable invocation binding, pending approval, native rejection propagation, missing capabilities, and V1 regressions.
- Documentation: `README.md`, `docs/v2-compat-audit.md`, and this change's proposal, architect-owned design, tools delta spec, and tasks. The main tools spec changes only through archival.
- Host-policy examples authorize one creation invocation without granting archive/removal. Resource rules are wildcard patterns, not a guarantee of literal JSON equality; use metacharacter-free operands in the concrete allow example.
- Out of scope: installed vendor or chezmoi-rendered edits, ai-dotfiles pins/configuration, agent/instruction files, duplicating OpenSpec root resolution, filesystem containment, generic shell permission delegation, CLI semantic/version enforcement, and unrelated cache or execution changes. ai-dotfiles integration is a separate follow-up.

## Proposal Review Disposition

Agent-engineer: approved with refinements; security: no blocking proposal-level concerns.

- Accepted: full MODIFIED bodies for existing conflicting requirements; explicit native error versus V1 cancellation behavior; complete canonical action table; grammar refusals before assertions; no invocation-triggered refresh after refusal/rejection; native request-shape and malformed-capability tests.
- Accepted: test immutable cwd/argv binding across a pending assertion; omit malformed optional provenance; supply readable operation/workdir/argv metadata; document environment-driven effects, wildcard policy matching, JSON escaping, and omitted reusable grants.
- Accepted: specify lexical absolute cwd resolution preserving existing relative-workdir semantics, without realpath/symlink canonicalization; use the identical resulting string for authorization and spawn. Do not silently change the base of relative workdirs to the session directory.
- Accepted: distinct `unaudited-command` refusal with CLI 1.14.1 audit hint and documented re-audit procedure. Unsupported syntax is refused rather than guessed; hidden `experimental` initialization and internal `__complete` are not added merely because they exist. Mutating operation names are a stable policy API.
- Rejected: relaxing the approved V2 peer floor. The package declares supported V2 mutation functionality at >=2.0.29; runtime guards additionally fail closed for older/manual installations. Strict dependency installation may reject an older host before runtime fallback is available; documentation must not promise install compatibility below the peer floor.
- Rejected: adding separate cancellation handling after pending approval. The v2.0.29 Promise tool context supplies `signal: AbortSignal`, while the assertion input accepts no signal parameter. This fact was reconciled during implementation review; cancellation behavior remains separately scoped. Native assertion rejection still prevents spawn.
- Rejected: changing blocklist/help precedence or asserting unverified permission-pattern syntax/prompt rendering. Preserve the existing classifier's narrow bare-help exemption and block reasons; document only verified host matching semantics.
- Follow-up, excluded here: AGENTS.md's broad parity/no-V2-prompt statements will become stale; any update must be separately scoped and routed through agent-engineer. Vendor and ai-dotfiles integration also remain separate.
