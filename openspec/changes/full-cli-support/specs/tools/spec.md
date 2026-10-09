## MODIFIED Requirements

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

#### Scenario: Destructive verb is refused when no confirmation mechanism is available

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

## ADDED Requirements

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
