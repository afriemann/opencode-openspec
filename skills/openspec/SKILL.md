---
name: openspec
description: "Use when starting or resuming a coding task that involves implementing changes — load right before planning or implementing, not for troubleshooting or read-only investigation. Provides the complete OpenSpec workflow for this system's agents: setup/init, read-existing-specs-first, mandatory alignment-before-creating, tool-driven artifact workflow, spec-authoring craft, design.md ownership, and the Apply/Verify/Archive sequence. Does not run openspec commands without explicit user confirmation."
---

# OpenSpec

OpenSpec organises each coding change as version-controlled artifacts — proposal, design, specs, tasks. This skill defines how this system's agents plan, author, implement, and archive them.

## Tool Use

Perform every `openspec` operation through the plugin tools, in this order of preference:
- `openspec_status` for change status: returns `isPlanningComplete`, `order` (always proposal → design → specs → tasks), and `raw` (full CLI JSON, including `applyRequires`).
- `openspec_instructions` for artifact guidance: accepts only `proposal`, `design`, `specs`, `tasks`; returns `template`, `instruction`, `resolvedOutputPath`.
- `openspec_cli` for everything else, including `instructions apply` and `instructions archive`, which have no dedicated tool. Pass the command without the `openspec` prefix, with separate option and value tokens (`--change "<name>"`, not `--change=<name>`).

Fall back to raw `openspec` via bash only when these tools are absent from your toolset. A refusal (`unaudited-command`, `permission-unavailable`, a blocked verb) or a permission denial is not absence: report it to the user and never retry the command through bash. With a worktree active, `workdir` is not required.

## Setup

If `openspec/` is absent from the project root, offer:

> "This project doesn't have OpenSpec. Would you like me to run `openspec init --tools none`? Requires Node.js ≥ 20.19.0 and `openspec` installed globally (`npm install -g @fission-ai/openspec`)."

Accepted: run it via `openspec_cli`, then proceed. Declined: proceed without OpenSpec — skip the change lifecycle.

## Read Existing Specs First

Before creating any change, read `openspec/specs/<domain>/` for **every** domain the change touches. ADDED / MODIFIED / REMOVED is only correct relative to what is already specified: ADDED for existing behaviour creates two competing requirements; MODIFIED for new behaviour leaves nothing to replace.

If `openspec/specs/<domain>/` is absent, do not create the delta change yet:

1. If a flat `openspec/specs/<domain>.md` exists, convert it: move its content to `openspec/specs/<domain>/spec.md` with all `### Requirement:` headings directly under a single flat `## Requirements` section.
2. Otherwise read the domain's code and author `openspec/specs/<domain>/spec.md` capturing current behaviour (Purpose → Requirements → Scenarios, RFC 2119 keywords).
3. Every requirement heading MUST be `### Requirement: <Name>` — `openspec archive` matches that prefix when applying MODIFIED deltas; without it archive aborts.
4. Only then scaffold the delta change, so MODIFIED has a requirement to replace and REMOVED one to delete. For a Lite change the new main spec captures only the requirements the change touches.

When the domain has tests, take scenario skeletons from them: each descriptive test name (`describe`/`it` title, `t.Run("…")` string, `test_<name>`) becomes a scenario title with a GIVEN/WHEN/THEN skeleton. Ask the engineer for the GIVEN context and exact THEN assertions. This preserves the naming link the Verify step depends on.

## Alignment Before Creating

Even with a change name or a "go ahead" from the user, STOP before running any `openspec` command.

**Phase 1 — Elicit.** Ask before presenting your own findings (skip any already answered):
- What specific problem does this solve, and for whom?
- What does a successful outcome look like?
- What is explicitly out of scope?
- Any constraints — deadline, backwards compatibility, regulatory, budget?

**Phase 2 — Present and confirm.** Give your technical findings (current state, code constraints) grounded in the answers, then propose a concrete scope: what is in and explicitly what is out. Wait for confirmation; only then run `openspec new change`.

**Exemption.** A change may skip OpenSpec entirely (no `openspec new change`, no alignment conversation; implement and commit directly) only when it fits one category AND no `openspec/specs/<domain>/` exists for the changed domain:

- **Typo correction:** only misspelled words in comments, docstrings, or string literals; zero logic, config, API, or schema change.
- **Documentation-only:** only Markdown/reStructuredText/plain-text docs, source comments, docstrings, or an isolated version bump (version string in a manifest, changelog entry, or tag; no lockfile or dependency-resolution change); zero executable statement, API signature, schema, config value, or test-assertion change. Any mixing with other changes disqualifies the whole diff; the claim lists every file.
- **Config-only:** only CI/CD pipeline definitions (e.g. `.github/workflows/*`, `.gitlab-ci.yml`, `Jenkinsfile`) or other configuration-value files, changing no behaviour a spec describes; no application source, IaC (Terraform/Helm/Kubernetes manifests), secrets, IAM/permission grants, or deployment-target configuration. OpenSpec is for behavioural changes to the software; a pure configuration change is not one.
- **Dependency version bump:** only dependency manifest/lockfiles (`package.json`/`package-lock.json`, `go.mod`/`go.sum`, `requirements.txt`/`poetry.lock`, `Cargo.toml`/`Cargo.lock`, `Gemfile`/`Gemfile.lock`), zero application source changed to adapt, AND the `upgrade-planning` skill's six-phase review was run for this bump and found no breaking change, deprecation, or configuration-behaviour impact. Any such impact disqualifies it: run the full workflow.

Any file outside these categories (even one line of application or infrastructure code beside a docs or CI edit) forces the full workflow. Typo correction and Documentation-only are also the only categories that may skip code review (see the always-on code-review rule); the other two still require it. Before skipping, state which category applies, confirm no domain spec exists for the touched area, and wait for explicit user confirmation; that claim plus confirmation is the alignment checkpoint for the exemption.

## Sizing: Lite and Full

Choose the tier before `openspec new change` and state the criteria relied on. **Lite** is the default and applies only when ALL hold: ≤3 files change; no new component boundary, public API, schema, or dependency; not security-, privacy-, or data-migration-related. Anything else is **Full**. A Lite change skips the proposal review (step 2) and `design.md` (step 3).

| Artifact | Lite (hard cap) | Full (hard cap) |
|---|---|---|
| `proposal.md` | 150 words: Why ≤3 sentences, What Changes as one-line bullets | 350 words |
| `design.md` | not written | 600 words |
| delta `specs/` | only the touched requirements, 1–2 scenarios each | every touched requirement with its edge and failure scenarios |
| `tasks.md` | ≤8 one-line checkboxes | ≤20 one-line checkboxes |

A change that cannot fit its cap is probably several changes; split it. Forbidden in every artifact:
- Investigation or diagnosis narrative (it belongs in the commit message).
- Restating a fact owned by another artifact (see ownership below); point to it instead.
- Restating a requirement in `tasks.md`; cite the scenario title instead.
- Alternatives or trade-offs, unless a real decision between alternatives was made.
- Restating the main spec or template sections with nothing to say; omit such sections rather than writing "none".

**One owner per fact** (upstream: proposal = why/what, design = how, specs = behaviour, tasks = steps): `proposal.md` owns motivation and scope, with "What Changes" naming capabilities only; `design.md` owns technical decisions and rationale, with no requirements, SHALL/MUST statements or scenarios; delta `specs/` own observable behaviour; `tasks.md` owns implementation steps, citing scenario titles for what and `design.md` decisions for how. Before `openspec validate`, check each artifact sentence against this list and delete or replace with a pointer any that states another artifact's fact.

## Creating Artifacts (Tool-Driven)

With confirmed scope and `openspec/` initialised:

**Worktree:** if implementation will use a git worktree, create or switch to it **before** `openspec_cli` `new change`; artifacts created in the main tree are invisible from a worktree.

1. `openspec_cli` `new change "<name>"` — scaffold the change directory.
2. `openspec_status` with `change` — read `order` and `raw` (resolved paths, `applyRequires`). After all planning artifacts are written, confirm `isPlanningComplete` is `true` before implementing.
3. For each artifact in `order`, `openspec_instructions` with `artifact` and `change`; act on:
   - `template` — markdown starter; use as the opening structure
   - `instruction` — authoring guidance; apply it, do NOT copy it into the file
   - `resolvedOutputPath` — absolute path to write the finished file to
4. `openspec_cli` `validate <name>` — structural completeness before the approval gate.

**Artifact ownership and mandatory sequence.** The order is fixed; `design.md` precedes `specs/` even where the CLI's own status output treats them as the same level.

| Step | Artifact / Action | Who | Gate |
|---|---|---|---|
| 1 | `proposal.md` | Engineer structures; **user provides the why and scope** (from alignment); if intent is unclear, ask before writing | — |
| 2 | Proposal review | Commission `architect` for a critique-only pass on `proposal.md`: questions, risks, scope concerns, alternatives; no design, no file writes. Skip for Lite. | After `proposal.md` complete |
| 3 | `design.md` | Commission `architect` (system/backend/infrastructure) or `ui-designer` (user-facing UI); engineer never authors content. Skip for Lite (state "Lite" and the criteria). | After proposal review evaluated (or skipped) |
| 4 | `specs/` | Engineer, grounded in `design.md` | Requires `design.md` complete |
| 5 | `tasks.md` | Engineer; implements the specs, no scope beyond them | Requires `specs/` complete |

**After proposal review:** evaluate every returned concern and document a disposition on each (accept, revise proposal, or reject with reason); silent discard is not acceptable. A security-related concern may not be rejected without explicit user approval. Surface to the user any concern that (a) questions the stated scope, (b) identifies a risk or constraint missing from the proposal, or (c) raises an alternative worth exploring. Significant scope gaps: revise `proposal.md` before commissioning `design.md`.

When `architect` or `ui-designer` returns, before writing `specs/`, list each decision and component in `design.md` and map it to the requirement(s) it generates; any decision with none is recorded as "no spec requirement — [reason]". Do not begin `specs/` with unmapped decisions. The engineer authors the GIVEN/WHEN/THEN requirements in `specs/` only; `design.md` is not edited to carry them. If `design.md` states behaviour as requirements or scenarios, move it to `specs/` and leave a pointer (ask the design agent to do so when it is a substantial amount). State in every `design.md` commission brief that it records decisions, not requirements or scenarios.

## Writing Good Specs

- **Delta specs MUST be in subdirectory format:** `specs/<capability>/spec.md` inside the change directory (e.g. `specs/dispatcher/spec.md`). A flat `specs/<capability>.md` makes `openspec validate` report "No deltas found" even with valid headers.
- **Delta H2 headers carry an operation prefix:** `## ADDED <Type>`, `## MODIFIED <Type>`, `## REMOVED <Type>`, or `## RENAMED <Type>` (e.g. `## ADDED Requirements`). Plain `## Requirements` is valid only in main specs; the validator error "No delta sections found" means a main-spec heading was used.
- **Scenarios are nested inside their parent requirement block.** Each `### Requirement:` contains its own `#### Scenario:` sub-headings. Never create a separate `## ADDED Scenarios` section; the validator reports `ADDED "<requirement name>" must include at least one scenario`.
- **`SHALL`/`MUST` in the first sentence.** The validator scans only the first sentence of each requirement: write "Subject SHALL/MUST verb (condition)", not "Condition, subject SHALL verb." A keyword pushed past the first sentence is silently undetected.
- **One statement, one `SHALL`/`MUST`.** Three "and also" clauses = three requirements.
- **Observable only.** "SHALL show an error banner when upload exceeds 10 MB", not "SHALL handle large uploads gracefully".
- **RFC 2119 discipline.** `MUST`/`SHALL` by default; `SHOULD` only for "unless justified"; `MAY` for genuinely optional behaviour.
- **Name the case in the scenario title.** "Rejects an expired token", not "Test 2".
- **Cover edge cases and failure modes.**
- **Right-size the change.** One intent statable in a sentence; the most common mistake is a change that is really three.
- **`### Requirement:` headings must be direct children of `## Requirements`.** `openspec archive` ignores headings nested in sub-sections (e.g. `## Schema`); if a delta's MODIFIED/REMOVED targets one, archive aborts with "not found".
- **MODIFIED and REMOVED headings, and every nested `#### Scenario:` title inside a MODIFIED requirement, must match the main spec exactly** — every word, space, and punctuation mark; only letter case is exempt (case-insensitive since v1.7.0). Archive finds the requirement by the text after `### Requirement: `, then checks that every scenario in the main spec's version still appears in the delta's, matched by the text after `#### Scenario: `. Before writing any `## MODIFIED` or `## REMOVED` section, grep `openspec/specs/<domain>/spec.md` for the exact heading AND the exact title of every scenario the requirement contains. A heading mismatch aborts with "MODIFIED failed — not found" (or "REMOVED failed — not found"); a mismatched scenario title fails later with `"... current spec contains scenario(s) not present in the modified block: \"<old title>\". Refresh the change spec before archiving to avoid dropping scenarios."` If a changed scenario's old title is now misleading, keep the old title in the delta, then rename it in a small follow-up edit to the merged main spec **after** archive completes (editing the main spec is forbidden only before archive).
- **A `## MODIFIED` body MUST contain the complete final body of the requirement.** Archive does wholesale replacement, not merge: a delta with only the new clauses silently drops all pre-existing text and every scenario not repeated. To author one: (1) copy the entire requirement body verbatim from `openspec/specs/<domain>/spec.md`; (2) insert or modify the new text and scenarios; (3) paste the complete result as the MODIFIED body.
- **ADDED vs MODIFIED:** `## ADDED` only for a requirement absent from the main spec. A new clause or scenario on an *existing* requirement is `## MODIFIED` with the full body, never `## ADDED`.

## Apply, Sync, Verify, Archive

**Apply:** call `openspec_cli` with `instructions apply --change "<name>" --json` for enriched guidance (`openspec_instructions` does not accept `apply`), then implement against `tasks.md`. Mark each task `[x]` in `tasks.md` as completed and verified; `todowrite` is no substitute, because `openspec archive` reads `tasks.md` checkboxes and warns on any unchecked item. Encode each GIVEN/WHEN/THEN scenario as a failing test (see `tdd`), named after its scenario title in the language convention: `test_<slug>` (Python); `it("<title>")` (TypeScript Jest/Vitest); `t.Run("<title>", ...)` inside a `Test<Subject>` function (Go, full name `Test<Subject>/<slug>`), or `Test<Slug>` for a standalone Go scenario with no siblings. The slugified title is the canonical scenario-to-test link the Verify step uses. Put a `// spec:` / `# spec:` comment on the outermost test container citing the main spec `openspec/specs/<domain>/spec.md` (path relative to project root; `<domain>` is the directory name under the change's `specs/`). NEVER cite `openspec/changes/...`: that path moves on archive and tests describe current behaviour, not a delivery. Move the comment to individual tests when a container mixes scenarios from different spec files. MODIFIED → update the existing test (rename if the title changed); REMOVED → delete it.

**Sync:** update delta specs immediately, before continuing implementation, when (1) the user changes scope or format mid-implementation (resolve ambiguity, update the spec, then resume); (2) implementation reveals a spec gap; (3) an implementation decision diverges from the spec. The spec is the source of truth. Pre-archive, confirm the delta matches what was built and correct any drift before `openspec archive`.

**Verify:** `code-reviewer` reads `proposal.md` → delta `specs/` → diff and checks completeness (every requirement implemented, every scenario covered by a test whose name matches the slugified title), correctness (implementation matches spec intent), and coherence (`design.md` decisions reflected in code). A scenario with no name-matched test is a coverage gap that blocks the review. In reverse, a test in the touched files whose name maps to a scenario title absent from every current requirement (main spec plus this change's deltas) is an orphaned test: flag `[WARNING]` for cleanup.

**Archive:**
- Before archiving, call `openspec_cli` with `instructions archive --change "<name>" --json`.
- Run `openspec_cli` with `archive <name> --yes` (mandatory). Always pass `--yes`: the command issues two interactive prompts agents cannot answer in a non-TTY (unchecked `tasks.md` items warning; "Proceed with spec updates?" on every normal run). Archive is destructive: V1 asks for confirmation; V2 runs it after native permission assertion, which the host may allow, ask, or deny.
- For infrastructure, tooling, or documentation-only changes with no delta specs, use `archive <name> --yes --skip-specs`. Only when the change genuinely has no delta spec files: it skips all spec updates without warning.
- If the incomplete-tasks warning fires despite finished work, tick every completed `tasks.md` item `[x]` and re-run.
- Do NOT modify the domain's main spec (`openspec/specs/<domain>/spec.md`) during implementation or before archive completes; it must stay at its pre-change state. Archive applies the delta itself; pre-editing destroys the headings the delta targets and fails with "MODIFIED failed — not found".
- Never archive by copying or moving files by hand; use only the command, so no duplicate remains under `openspec/changes/`.
- After archive, verify before committing: `openspec/changes/` holds no directory for this change; `grep -rn "openspec/changes/" <test and source dirs>` outside `changes/archive/` returns nothing (repoint any hit at `openspec/specs/<domain>/spec.md`); and every `TBD - created by archiving` Purpose line in a merged main spec is replaced with a real one-sentence Purpose. Include these fixes in the archive commit.
- Commit the archival separately: `docs: archive openspec change <name>`.
- If a delta marks **all** requirements in a domain REMOVED (content consolidated elsewhere), archive fails because the validator rejects an empty main spec. Workaround: before archive, move those REMOVED-only delta files out of the change directory (e.g. to `/tmp/`), run archive to completion, restore or discard them, then delete the now-empty `openspec/specs/<domain>/` in a follow-up commit.

## Cross-Skill Integration

| Skill / Agent | Interaction |
|---|---|
| `tdd` | Scenarios are the red-step failing tests. ADDED → new test; MODIFIED → update test; REMOVED → delete test. |
| `code-reviewer` | Performs Verify: reads proposal → specs → diff; reports spec conformance with code quality in one pass. |
| `architect` | Commissioned twice per change when design.md is not skipped: (1) critique-only reviewer of `proposal.md` (step 2), writes no files; (2) system/backend/infrastructure design (step 3), writes `design.md`. Engineer evaluates review findings before commissioning design.md. |
| `ui-designer` | Same as `architect` for user-facing interface design; writes `design.md` (step 3) before `specs/`. |
| `adr` | Per-change decisions live in `design.md`; write an ADR only for cross-cutting, permanent decisions spanning multiple changes. |
| `troubleshooting` | A bug is a deviation from spec: read `openspec/specs/` to anchor expected behaviour; record the violated requirement in the diagnosis. |
| `upgrade-planning` | Its six-phase review gates the "Dependency version bump" exemption (see Alignment). |
| `detective` | Reads `openspec/specs/` as intended behaviour alongside code investigation. |
| `coding` | All coding-skill rules apply during Apply. OpenSpec defines *what* to build; `coding` defines *how*. |

## Tool Reference

| Tool | Command / arguments | When |
|---|---|---|
| `openspec_cli` | `init --tools none` | First time on a project |
| `openspec_cli` | `list` | On session resume, to find in-progress changes |
| `openspec_cli` | `show <name>` | Inspect a change's current state |
| `openspec_cli` | `new change "<name>"` | After scope alignment is confirmed |
| `openspec_status` | `change` | After `new change`, for artifact order and paths |
| `openspec_instructions` | `artifact`, `change` | Per artifact, for template + constraints |
| `openspec_cli` | `instructions apply --change "<name>" --json` | During implementation, for task-apply guidance |
| `openspec_cli` | `instructions archive --change "<name>" --json` | Before archiving, for archive guidance |
| `openspec_cli` | `validate <name>` | After artifact creation, before the approval gate |
| `openspec_cli` | `archive <name> --yes` | After implementation, tests passing, review clean; add `--skip-specs` for infra/tooling/doc-only changes with no delta specs |
