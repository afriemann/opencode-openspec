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

The `openspec_cli` tool SHALL detect whether the command begins with a destructive verb
(`archive`, `new change`, `store remove`, `store unregister`, `workset remove`, `config reset`, or
`config unset`) by resolving the verb from the parsed arguments
(skipping leading global options such as `--no-color`), not by substring search. On a runtime that
exposes a user-confirmation mechanism, the tool SHALL request confirmation before spawning any
subprocess for a destructive verb and, when the user denies, SHALL return `{ cancelled: true }`
without executing the command. On a runtime that exposes no user-confirmation mechanism reachable
from a tool, the tool SHALL execute the destructive command without a plugin-level prompt, leaving
authorisation to the host's tool permissions.

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

#### Scenario: Destructive verb executes when no confirmation mechanism is available

- **WHEN** the agent calls `openspec_cli` with `command: "archive my-change --yes"` on a runtime that exposes no confirmation mechanism reachable from a tool
- **THEN** the subprocess is spawned and the command executes
- **AND** the result is returned as `{ stdout, stderr, exitCode }` with no `cancelled` field

#### Scenario: Leading global option does not bypass the gate

- **WHEN** the agent calls `openspec_cli` with `command: "--no-color archive my-change --yes"` on a runtime that exposes a confirmation mechanism
- **THEN** confirmation is requested before the subprocess is started

### Requirement: openspec_cli refreshes the injection cache after mutating commands

When `openspec_cli` spawns any command whose verb is not on the read-only list (including
`archive`, `new change`, `init`, `update`, and any verb unknown to the plugin), the plugin SHALL
refresh its injection cache for the resolved project directory afterwards, whether the command
exited zero, exited non-zero, or timed out, so that subsequent LLM calls reflect the updated list
of changes. Read-only commands SHALL NOT trigger a refresh.

#### Scenario: Cache is refreshed after new change creation

- **WHEN** the agent calls `openspec_cli` with `command: "new change my-feature"` and the command completes successfully
- **THEN** the injection cache for the project directory is re-populated by running `openspec list --json`

#### Scenario: Cache is refreshed after a failed or timed-out mutating command

- **WHEN** a non-read-only command exits non-zero or is killed by the timeout
- **THEN** the injection cache for the project directory is re-populated

#### Scenario: Failed refresh keeps the previous cache entry

- **WHEN** the refresh `openspec list --json` itself fails or times out
- **THEN** the previous cache entry for the project directory is kept

#### Scenario: Read-only command does not refresh the cache

- **WHEN** the agent calls `openspec_cli` with `command: "list --json"`
- **THEN** no additional `openspec list --json` refresh is run

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

### Requirement: openspec_cli parses the command shell-style without expansion

The `openspec_cli` tool SHALL split the `command` string into arguments using POSIX-like quoting
(single quotes literal, double quotes with `\"` and `\\` escapes, backslash escapes outside
quotes, adjacent segments concatenated) and SHALL NOT perform variable, tilde, glob, or operator
expansion. A leading `openspec` token SHALL be ignored. An unterminated quote, trailing backslash,
or empty command SHALL return `{ error, reason: "parse-error", exitCode: null }` without spawning.

#### Scenario: Quoted argument with spaces reaches the CLI intact

- **WHEN** the agent calls `openspec_cli` with `command: "new change \"my-feature\" --description 'two words'"`
- **THEN** the CLI receives the arguments `new`, `change`, `my-feature`, `--description`, `two words`

#### Scenario: Shell metacharacters are inert

- **WHEN** the agent calls `openspec_cli` with `command: "list ; rm -rf $HOME"`
- **THEN** the CLI receives `;`, `rm`, `-rf` and `$HOME` as literal arguments and no shell is involved

#### Scenario: Leading openspec token is ignored

- **WHEN** the agent calls `openspec_cli` with `command: "openspec list --json"`
- **THEN** the CLI receives `list`, `--json`

#### Scenario: Unterminated quote is rejected

- **WHEN** the agent calls `openspec_cli` with `command: "show \"my-change"`
- **THEN** the tool returns `reason: "parse-error"` and spawns nothing

### Requirement: openspec_cli refuses commands that cannot run non-interactively or reach outside the project

The `openspec_cli` tool SHALL refuse, without spawning, the commands `config edit`, `workset open`,
`completion install`, `completion uninstall`, and `feedback`, returning `{ cancelled: true, reason,
error, hint }` where `reason` is `interactive` for the first two and `out-of-scope-side-effect` for
the rest, and the hint directs the user to run the command in their own terminal. A bare help request
(`<command> --help` or `-h` with no other arguments) SHALL NOT be refused or gated; a help flag
elsewhere (e.g. as an option value or after `--`) grants no exemption. All other commands SHALL run with stdin closed
and the host environment unchanged, with no flags injected.

#### Scenario: Editor-launching command fails fast

- **WHEN** the agent calls `openspec_cli` with `command: "config edit"`
- **THEN** the tool returns `cancelled: true` and `reason: "interactive"` without spawning

#### Scenario: Out-of-project side effect is refused

- **WHEN** the agent calls `openspec_cli` with `command: "completion install bash"`
- **THEN** the tool returns `cancelled: true` and `reason: "out-of-scope-side-effect"` without spawning

#### Scenario: Help for a blocked command is allowed

- **WHEN** the agent calls `openspec_cli` with `command: "feedback --help"`
- **THEN** the command is executed

#### Scenario: Help flag used as an option value does not bypass the blocklist

- **WHEN** the agent calls `openspec_cli` with `command: "feedback hi --body -h"`
- **THEN** the tool returns `cancelled: true` and `reason: "out-of-scope-side-effect"` without spawning

#### Scenario: Commands run with stdin closed and no injected flags

- **WHEN** the agent calls `openspec_cli` with `command: "archive my-change"`
- **THEN** the subprocess receives exactly the arguments `archive`, `my-change`
- **AND** its stdin is closed

### Requirement: openspec_cli bounds execution with a timeout

The `openspec_cli` tool SHALL accept an optional integer `timeout` in milliseconds (default
120000, minimum 1000, maximum 600000) and SHALL kill the subprocess when it expires, returning
`{ stdout, stderr, exitCode: null, timedOut: true, reason: "timeout", error, hint }` with any
partial output captured. A `timeout` outside the range or not an integer SHALL return
`reason: "invalid-timeout"` without spawning.

#### Scenario: Hanging command is killed at the timeout

- **WHEN** the agent calls `openspec_cli` with `timeout: 1000` and the subprocess does not exit
- **THEN** the subprocess is killed and the tool returns `timedOut: true` with `reason: "timeout"`

#### Scenario: Out-of-range timeout is rejected

- **WHEN** the agent calls `openspec_cli` with `timeout: 10`
- **THEN** the tool returns `reason: "invalid-timeout"` and spawns nothing

#### Scenario: Default timeout applies when omitted

- **WHEN** the agent calls `openspec_cli` without `timeout`
- **THEN** the subprocess is run with a 120000 ms timeout
