# tools Specification

## Purpose
Defines the behaviour of the three agent-facing tools registered by the plugin:
`openspec_cli` (generic CLI escape hatch), `openspec_status` (structured artifact status),
and `openspec_instructions` (structured artifact authoring guidance). Each tool resolves its
working directory, invokes the `openspec` CLI, and returns a structured result the agent can
use without further parsing.

## Requirements

### Requirement: openspec_cli runs any openspec subcommand

The `openspec_cli` tool SHALL accept a `command` string (containing the full subcommand and
flags, e.g. `"list --json"` or `"validate my-change --strict"`) and an optional `workdir`
string. It SHALL invoke `openspec <command>` in the resolved working directory and return a
JSON object with `stdout`, `stderr`, and `exitCode`. A non-zero exit code from the CLI SHALL be
returned as a normal result — it is not an error — so the agent can inspect and act on it.

#### Scenario: Read-only command returns stdout and exit code

- **WHEN** the agent calls `openspec_cli` with `command: "list --json"`
- **THEN** the tool runs `openspec list --json` in the resolved working directory
- **AND** returns `{ stdout: "<json string>", stderr: "", exitCode: 0 }`

#### Scenario: Non-zero exit from CLI is a normal return

- **WHEN** the agent calls `openspec_cli` with a command that causes openspec to exit non-zero (e.g. validate on an invalid change)
- **THEN** the tool returns `{ stdout: "...", stderr: "...", exitCode: <non-zero> }`
- **AND** does not throw or return an error structure

#### Scenario: openspec not on PATH returns a structured error

- **WHEN** the `openspec` binary is not on `PATH` and the spawn fails
- **THEN** the tool returns `{ error: "<message describing the failure>", exitCode: null }`
- **AND** the failure is logged via `client.app.log`
- **AND** no exception propagates from the tool's `execute` function

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

### Requirement: openspec_status returns structured artifact status in canonical order

The `openspec_status` tool SHALL accept a `change` name and an optional `workdir` string. It
SHALL return a JSON object containing `isPlanningComplete` (boolean), an `order` array listing
each artifact in the canonical authoring order (proposal → design → specs → tasks) with its
individual status, and a `raw` field containing the full unmodified CLI response. The legacy
`isComplete` field SHALL NOT be surfaced as a headline result.

#### Scenario: Status returns canonical artifact order

- **WHEN** the agent calls `openspec_status` with a valid change name
- **THEN** the tool returns an object whose `order` array lists artifacts in the sequence: proposal, design, specs, tasks
- **AND** each entry has `artifact` and `status` fields

#### Scenario: isPlanningComplete is surfaced, not isComplete

- **WHEN** the agent calls `openspec_status` on a change where all planning artifacts are present
- **THEN** the returned object contains `isPlanningComplete: true`
- **AND** does NOT contain a top-level `isComplete` field used as a completion signal

### Requirement: openspec_instructions returns template, instruction, and output path

The `openspec_instructions` tool SHALL accept an `artifact` identifier (one of `"proposal"`,
`"design"`, `"specs"`, `"tasks"`), a `change` name, and an optional `workdir` string. It SHALL
return a JSON object containing exactly `template` (the starter markdown), `instruction` (the
authoring guidance), and `resolvedOutputPath` (the absolute filesystem path to write the
artifact to), extracted from the CLI `--json` response.

#### Scenario: Returns the three fields needed to write an artifact

- **WHEN** the agent calls `openspec_instructions` with `artifact: "proposal"` and a valid change name
- **THEN** the tool returns an object with `template`, `instruction`, and `resolvedOutputPath` as non-empty strings

#### Scenario: resolvedOutputPath is the exact path to write

- **WHEN** `openspec_instructions` returns `resolvedOutputPath`
- **THEN** writing the artifact content to that path produces the correct artifact file in the expected location within the change directory

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
