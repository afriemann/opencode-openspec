## Purpose

Defines the behaviour of the plugin's system-prompt injection: how the plugin detects
OpenSpec presence in a project, caches the active changes list, and injects a tools-available
notice and changes summary into the LLM system prompt on every call without performing I/O in
the injection hot path.

## ADDED Requirements

### Requirement: Injection cache is populated on session start

When a `session.created` event fires, the plugin SHALL check whether the session's project
directory contains an `openspec/` subdirectory. If present, it SHALL run `openspec list --json`
in that directory and store the result in the injection cache keyed by the project directory.
The `existsSync` check for presence SHALL be performed once per project directory and cached —
it SHALL NOT be re-evaluated on subsequent calls or inside the transform hook.

#### Scenario: Cache is populated when openspec is present

- **WHEN** a `session.created` event fires for a project directory that contains `openspec/`
- **THEN** the plugin runs `openspec list --json` in that directory
- **AND** stores `{ present: true, changes: [...], at: <timestamp> }` in the cache keyed by the project directory

#### Scenario: Cache marks absence when openspec is not present

- **WHEN** a `session.created` event fires for a project directory that does NOT contain `openspec/`
- **THEN** the plugin stores `{ present: false }` in the cache for that directory
- **AND** does NOT attempt to run `openspec list`

### Requirement: System-prompt transform hook is pure

The `experimental.chat.system.transform` hook SHALL perform no filesystem access, no subprocess
spawn, and no network I/O. It SHALL only read from the in-memory injection cache and push
strings into `output.system`. This ensures the hook completes with negligible latency and does
not block the LLM call.

#### Scenario: Transform reads cache and pushes strings only

- **WHEN** the `experimental.chat.system.transform` hook is invoked
- **THEN** it reads the cached entry for the session's project directory
- **AND** pushes string content into `output.system`
- **AND** calls no filesystem functions and spawns no subprocess

### Requirement: Injection includes tools notice and active changes list when openspec is present

When the injection cache contains a `{ present: true }` entry for the session's project
directory, the `experimental.chat.system.transform` hook SHALL push two items into
`output.system`: (1) a static notice naming the three tools (`openspec_cli`, `openspec_status`,
`openspec_instructions`) and directing the agent to use them instead of raw CLI commands; and
(2) a one-line summary of each active change in the cached list showing its name and
task-completion counts.

#### Scenario: Injection includes static tools notice

- **WHEN** openspec is present in the project and the cache has been populated
- **THEN** the transform hook pushes a string containing the names of the three tools into `output.system`

#### Scenario: Injection includes active changes summary

- **WHEN** the cache contains a list of active changes
- **THEN** the transform hook pushes a string summarising those changes (name and completion counts) into `output.system`

### Requirement: Injection degrades gracefully on cache miss or population failure

If the cache has no entry for the session's project directory (e.g. the transform fires before
`session.created` has populated the cache, or population failed), the plugin SHALL still inject
the static tools notice and omit the changes summary. If the project is not present in the
cache at all, the plugin SHALL inject nothing — neither the notice nor the changes list.

#### Scenario: Static notice is injected on cache miss

- **WHEN** the transform hook fires and the cache has no entry for the project directory
- **THEN** the plugin still pushes the static tools notice into `output.system`
- **AND** no changes summary is pushed

#### Scenario: Nothing is injected in a non-openspec project

- **WHEN** the cache entry for the project directory has `present: false`
- **THEN** the transform hook pushes nothing into `output.system`

### Requirement: Injection cache is refreshed after this plugin's own mutating tool calls

When `openspec_cli` completes a mutating command (`archive` or `new change`) successfully, the
plugin SHALL re-run `openspec list --json` for the project directory and update the cache entry.
The cache is NOT refreshed on a timer. Changes created or archived by external processes or by
other sessions are NOT reflected until the next `session.created` event for a new session.

#### Scenario: Cache reflects new change after creation via openspec_cli

- **WHEN** the agent calls `openspec_cli` with `"new change my-feature"` and the command succeeds
- **THEN** the cached changes list for the project directory is updated to include `my-feature`
- **AND** the next LLM call's injection includes the new change in the summary
