---
name: openspec
description: "Use when planning or implementing a change with OpenSpec, or when a project has an `openspec/` directory. Provides the OpenSpec workflow for the plugin tools: setup, reading existing specs, creating artifacts, spec-authoring formats, and the apply, sync, verify and archive steps."
---

# OpenSpec

OpenSpec organises each change as version-controlled artifacts in `openspec/changes/<name>/`: proposal, design, delta specs and tasks. Archiving merges the delta specs into the main specs in `openspec/specs/`.

**Specs describe application behaviour only:** what the shipped system observably does for its users or callers. Never spec test behaviour (test coverage, test cases, fixtures), documentation, configuration, tooling, CI, or refactoring. Those belong in `tasks.md` (and `design.md` for rationale), never in a requirement or scenario.

## Tool Use

Perform every `openspec` operation through the plugin tools, in this order of preference:
- `openspec_status` for change status: returns `isPlanningComplete`, `order` (always proposal → design → specs → tasks), and `raw` (full CLI JSON: per-artifact `requires` and `status`, plus `applyRequires`).
- `openspec_instructions` for artifact guidance: accepts only `proposal`, `design`, `specs`, `tasks`; returns `template`, `instruction`, `resolvedOutputPath`.
- `openspec_cli` for everything else, including `instructions apply` and `instructions archive`, which have no dedicated tool. Pass the command without the `openspec` prefix, with separate option and value tokens (`--change "<name>"`, not `--change=<name>`).

Fall back to raw `openspec` via a shell only when these tools are absent from your toolset. A refusal (`unaudited-command`, `permission-unavailable`, a blocked verb) or a permission denial is not absence: report it to the user and never retry the command through a shell. With a worktree active, `workdir` is not required.

## Setup

If `openspec/` is absent from the project root, offer to run `openspec init --tools none` (requires Node.js ≥ 20.19.0 and `openspec` installed globally: `npm install -g @fission-ai/openspec`). Accepted: run it via `openspec_cli`, then proceed. Declined: proceed without OpenSpec.

## Read Existing Specs First

Before creating a change, read `openspec/specs/<domain>/` for every domain the change touches. ADDED / MODIFIED / REMOVED is only correct relative to what is already specified: ADDED for existing behaviour creates two competing requirements; MODIFIED for new behaviour leaves nothing to replace.

If `openspec/specs/<domain>/` is absent, do not create the delta change yet:

1. If a flat `openspec/specs/<domain>.md` exists, convert it: move its content to `openspec/specs/<domain>/spec.md` with all `### Requirement:` headings directly under a single flat `## Requirements` section.
2. Otherwise read the domain's code and author `openspec/specs/<domain>/spec.md` capturing current behaviour (Purpose → Requirements → Scenarios, RFC 2119 keywords).
3. Every requirement heading MUST be `### Requirement: <Name>`; `openspec archive` matches that prefix when applying MODIFIED deltas, and without it archive aborts.
4. Only then scaffold the delta change, so MODIFIED has a requirement to replace and REMOVED one to delete.

## Creating Artifacts

**Worktree:** if implementation will use a git worktree, create or switch to it before `new change`; artifacts created in the main tree are invisible from a worktree.

1. `openspec_cli` `new change "<name>"` scaffolds the change directory.
2. `openspec_status` with `change`: read `raw.artifacts`. Each artifact reports `status` and `requires`; write an artifact only when its `requires` are done. `order` is a display order, not a dependency: in the default schema, design and specs both require only the proposal, and tasks requires both. `applyRequires` lists the artifacts needed before implementation; confirm `isPlanningComplete` is `true` first.
3. For each artifact, `openspec_instructions` with `artifact` and `change`; act on:
   - `template`: markdown starter; use it as the opening structure
   - `instruction`: authoring guidance; apply it, do NOT copy it into the file
   - `resolvedOutputPath`: absolute path to write the finished file to
4. `openspec_cli` `validate <name>` checks structural completeness.

A change that alters no application behaviour (refactor, tooling, configuration, tests, documentation) has no delta specs: set `skip_specs: true` in its `.openspec.yaml` (alongside its `schema:` line), since `openspec validate` rejects a change with zero deltas otherwise.

Artifact roles: `proposal.md` records why and what; `design.md` records technical decisions and rationale, not requirements or scenarios; delta `specs/` record observable behaviour; `tasks.md` records implementation steps. State each fact in one artifact and point to it from the others.

## Writing Good Specs

- **Delta specs MUST be in subdirectory format:** `specs/<capability>/spec.md` inside the change directory (e.g. `specs/dispatcher/spec.md`). A flat `specs/<capability>.md` makes `openspec validate` report "No deltas found" even with valid headers.
- **Delta H2 headers carry an operation prefix:** `## ADDED <Type>`, `## MODIFIED <Type>`, `## REMOVED <Type>`, or `## RENAMED <Type>` (e.g. `## ADDED Requirements`). Plain `## Requirements` is valid only in main specs; the validator error "No delta sections found" means a main-spec heading was used.
- **Scenarios are nested inside their parent requirement block.** Each `### Requirement:` contains its own `#### Scenario:` sub-headings. Never create a separate `## ADDED Scenarios` section; the validator reports `ADDED "<requirement name>" must include at least one scenario`.
- **`SHALL`/`MUST` in the first sentence.** The validator scans only the first sentence of each requirement: write "Subject SHALL/MUST verb (condition)", not "Condition, subject SHALL verb." A keyword pushed past the first sentence is silently undetected.
- **One statement, one `SHALL`/`MUST`.** Three "and also" clauses = three requirements.
- **Application behaviour only.** No requirement such as "SHALL have tests for X" or "SHALL document Y", "SHALL be configured with Z"; scenarios describe system behaviour, not how it is tested.
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

**Apply:** call `openspec_cli` with `instructions apply --change "<name>" --json` for enriched guidance (`openspec_instructions` does not accept `apply`), then implement against `tasks.md`. Mark each task `[x]` in `tasks.md` once completed and verified; `openspec archive` reads those checkboxes and warns on any unchecked item.

**Sync:** update delta specs immediately, before continuing implementation, when (1) the scope or format changes mid-implementation, (2) implementation reveals a spec gap, or (3) an implementation decision diverges from the spec. The spec is the source of truth. Before archive, confirm the delta matches what was built.

**Verify:** before archiving, check completeness (every requirement implemented, every scenario covered by a test), correctness (implementation matches spec intent), and coherence (`design.md` decisions reflected in code).

**Archive:**
- Before archiving, call `openspec_cli` with `instructions archive --change "<name>" --json`.
- Run `openspec_cli` with `archive <name> --yes`. Always pass `--yes`: the command issues two interactive prompts agents cannot answer in a non-TTY (unchecked `tasks.md` items warning; "Proceed with spec updates?"). Archive is destructive: V1 asks for confirmation; V2 runs it after native permission assertion, which the host may allow, ask, or deny.
- For a change with no delta specs, use `archive <name> --yes --skip-specs`. It skips all spec updates without warning, so use it only when the change has no delta spec files.
- If the incomplete-tasks warning fires despite finished work, tick every completed `tasks.md` item `[x]` and re-run.
- Do NOT modify the domain's main spec (`openspec/specs/<domain>/spec.md`) before archive completes. Archive applies the delta itself; pre-editing destroys the headings the delta targets and fails with "MODIFIED failed — not found".
- Never archive by copying or moving files by hand; use only the command, so no duplicate remains under `openspec/changes/`.
- After archive, verify `openspec/changes/` holds no directory for this change, that nothing outside `changes/archive/` still references `openspec/changes/<name>`, and that every `TBD - created by archiving` Purpose line in a merged main spec is replaced with a real one-sentence Purpose.
- If a delta marks **all** requirements in a domain REMOVED, archive fails because the validator rejects an empty main spec. Workaround: before archive, move those REMOVED-only delta files out of the change directory to a temporary directory, run archive to completion, restore or discard them, then delete the now-empty `openspec/specs/<domain>/` afterwards.

## Tool Reference

| Tool | Command / arguments | When |
|---|---|---|
| `openspec_cli` | `init --tools none` | First time on a project |
| `openspec_cli` | `list` | On session resume, to find in-progress changes |
| `openspec_cli` | `show <name>` | Inspect a change's current state |
| `openspec_cli` | `new change "<name>"` | To scaffold a change |
| `openspec_status` | `change` | After `new change`, for artifact status, prerequisites and paths |
| `openspec_instructions` | `artifact`, `change` | Per artifact, for template + constraints |
| `openspec_cli` | `instructions apply --change "<name>" --json` | During implementation, for task-apply guidance |
| `openspec_cli` | `instructions archive --change "<name>" --json` | Before archiving, for archive guidance |
| `openspec_cli` | `validate <name>` | After artifact creation |
| `openspec_cli` | `archive <name> --yes` | After implementation and verification; add `--skip-specs` for a change with no delta specs |
