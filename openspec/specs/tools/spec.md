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
flags, e.g. `"list --json"` or `"validate my-change --strict"`) and an optional `cwd` string.
It SHALL invoke `openspec <command>` in the resolved working directory and return a JSON object
with `stdout`, `stderr`, and `exitCode`. A non-zero exit code from the CLI SHALL be returned
as a normal result — it is not an error — so the agent can inspect and act on it.

#### Scenario: Read-only command returns stdout and exit code

- **WHEN** the agent calls `openspec_cli` with `command: "list --json"`
- **THEN** the tool runs `openspec list --json` in the resolved cwd
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
by substring search. When a destructive verb is detected, the tool SHALL call `context.ask`
for user confirmation **before** spawning any subprocess. When the user denies, the tool SHALL
return `{ cancelled: true }` without executing the command.

#### Scenario: archive command triggers confirmation

- **WHEN** the agent calls `openspec_cli` with `command: "archive my-change --yes"`
- **THEN** `context.ask` is called for confirmation before the subprocess is started
- **AND** if the user approves, the command is executed and the result returned normally

#### Scenario: User denial returns cancelled result

- **WHEN** the agent calls `openspec_cli` with a destructive verb
- **AND** `context.ask` rejects (user denies)
- **THEN** the tool returns `{ cancelled: true }`
- **AND** no subprocess is spawned

#### Scenario: Read-only command with change name containing archive is not gated

- **WHEN** the agent calls `openspec_cli` with `command: "status --change archive-cleanup --json"`
- **THEN** `context.ask` is NOT called
- **AND** the command is executed immediately without a confirmation prompt

### Requirement: openspec_cli refreshes the injection cache after mutating commands

When `openspec_cli` successfully executes a mutating command (`archive` or `new change`), the
plugin SHALL refresh its injection cache for the resolved project directory so that subsequent
LLM calls reflect the updated list of changes.

#### Scenario: Cache is refreshed after new change creation

- **WHEN** the agent calls `openspec_cli` with `command: "new change my-feature"` and the user approves
- **AND** the command completes successfully
- **THEN** the injection cache for the project directory is re-populated by running `openspec list --json`

### Requirement: openspec_status returns structured artifact status in canonical order

The `openspec_status` tool SHALL accept a `change` name and an optional `cwd` string. It SHALL
return a JSON object containing `isPlanningComplete` (boolean), an `order` array listing each
artifact in the canonical authoring order (proposal → design → specs → tasks) with its
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
`"design"`, `"specs"`, `"tasks"`), a `change` name, and an optional `cwd` string. It SHALL
return a JSON object containing exactly `template` (the starter markdown), `instruction` (the
authoring guidance), and `resolvedOutputPath` (the absolute filesystem path to write the
artifact to), extracted from the CLI `--json` response.

#### Scenario: Returns the three fields needed to write an artifact

- **WHEN** the agent calls `openspec_instructions` with `artifact: "proposal"` and a valid change name
- **THEN** the tool returns an object with `template`, `instruction`, and `resolvedOutputPath` as non-empty strings

#### Scenario: resolvedOutputPath is the exact path to write

- **WHEN** `openspec_instructions` returns `resolvedOutputPath`
- **THEN** writing the artifact content to that path produces the correct artifact file in the expected location within the change directory

### Requirement: Tools resolve cwd from context when not explicitly provided

All three tools SHALL use the agent's session context to determine the working directory when
`cwd` is not provided as an argument. The resolution order SHALL be: (1) `args.cwd` if
provided and non-empty; (2) `context.worktree` if truthy; (3) `context.directory`. The
resolved cwd is passed to the openspec CLI, which locates the `openspec/` root by walking up
the directory tree from that path.

#### Scenario: Tool uses worktree when no explicit cwd provided

- **WHEN** the agent calls `openspec_status` without a `cwd` argument
- **AND** the session's `context.worktree` is a non-empty string
- **THEN** the tool runs openspec with the worktree path as the working directory

#### Scenario: Explicit cwd overrides context

- **WHEN** the agent calls `openspec_status` with `cwd: "/some/path"`
- **THEN** the tool runs openspec with `/some/path` as the working directory regardless of `context.worktree`
