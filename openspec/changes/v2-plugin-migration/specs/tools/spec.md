## MODIFIED Requirements

### Requirement: openspec_cli gates destructive verbs before spawning

The `openspec_cli` tool SHALL detect whether the `command` argument begins with a destructive
verb (`archive` or `new change`) by matching the **leading tokens** of the command string, not
by substring search. When a destructive verb is detected, the tool SHALL NOT reach a subprocess
without either explicit user approval or a refusal returned to the agent. On a runtime that
exposes a user-confirmation mechanism, the tool SHALL request confirmation before spawning any
subprocess and, when the user denies, SHALL return `{ cancelled: true }` without executing the
command. On a runtime that exposes no user-confirmation mechanism reachable from a tool, the
tool SHALL refuse the destructive command without spawning any subprocess, returning a
structured result indicating confirmation is unavailable and directing the agent toward an
alternative that is itself confirmation-gated by the host.

#### Scenario: archive command triggers confirmation

- **WHEN** the agent calls `openspec_cli` with `command: "archive my-change --yes"` on a runtime that exposes a confirmation mechanism
- **THEN** confirmation is requested before the subprocess is started
- **AND** if the user approves, the command is executed and the result returned normally

#### Scenario: User denial returns cancelled result

- **WHEN** the agent calls `openspec_cli` with a destructive verb on a runtime that exposes a confirmation mechanism
- **AND** the user denies confirmation
- **THEN** the tool returns `{ cancelled: true }`
- **AND** no subprocess is spawned

#### Scenario: Read-only command with change name containing archive is not gated

- **WHEN** the agent calls `openspec_cli` with `command: "status --change archive-cleanup --json"`
- **THEN** no confirmation is requested
- **AND** the command is executed immediately without a confirmation prompt, on any runtime

#### Scenario: Destructive verb is refused when no confirmation mechanism is available

- **WHEN** the agent calls `openspec_cli` with a destructive verb on a runtime that exposes no confirmation mechanism reachable from a tool
- **THEN** the tool returns a structured result with `cancelled: true` and a reason indicating confirmation is unavailable
- **AND** no subprocess is spawned
- **AND** the result directs the agent toward an alternative path that is itself confirmation-gated by the host

### Requirement: openspec_cli refreshes the injection cache after mutating commands

When `openspec_cli` successfully executes a mutating command (`archive` or `new change`), the
plugin SHALL refresh its injection cache for the resolved project directory so that subsequent
LLM calls reflect the updated list of changes. On a runtime where a mutating command is always
refused before spawning (see the destructive-verb gating requirement), the cache refresh
naturally never occurs for that runtime, since no mutation ever executes.

#### Scenario: Cache is refreshed after new change creation

- **WHEN** the agent calls `openspec_cli` with `command: "new change my-feature"` and the command is approved and completes successfully
- **THEN** the injection cache for the project directory is re-populated by running `openspec list --json`

### Requirement: Tools resolve workdir from context when not explicitly provided

All three tools SHALL determine the working directory when `workdir` is not provided as an
argument using, in order: (1) `args.workdir` if provided and non-empty; (2) the directory
associated with the calling session, however the runtime makes that association available; (3)
a runtime-wide default directory. The resolved workdir is passed to the openspec CLI, which
locates the `openspec/` root by walking up the directory tree from that path.

#### Scenario: Tool uses worktree when no explicit cwd provided

- **WHEN** the agent calls `openspec_status` without a `workdir` argument
- **AND** the calling session has an associated directory
- **THEN** the tool runs openspec with that session's directory as the working directory

#### Scenario: Explicit cwd overrides context

- **WHEN** the agent calls `openspec_status` with `workdir: "/some/path"`
- **THEN** the tool runs openspec with `/some/path` as the working directory regardless of any session-scoped directory
