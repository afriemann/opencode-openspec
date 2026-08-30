## ADDED Requirements

### Requirement: openspec_cli tokenizes command strings with shell-like quote stripping

The `openspec_cli` tool SHALL parse the `command` argument into tokens using shell-like quoting
rules before passing them to the openspec binary. Tokens enclosed in double quotes or single
quotes SHALL have the surrounding quote characters stripped. Backslash-escaped characters
outside quotes SHALL be included in the token without the backslash. Unquoted whitespace SHALL
separate tokens. The resulting bare tokens SHALL be passed as separate positional arguments to
the openspec subprocess, so `new change "my-feature"` and `new change my-feature` produce
identical subprocess calls.

#### Scenario: Double-quoted change name reaches openspec without quotes

- **WHEN** the agent calls `openspec_cli` with `command: 'new change "my-feature"'`
- **THEN** the subprocess receives `my-feature` (no surrounding quote characters) as the change name argument

#### Scenario: Single-quoted token is stripped

- **WHEN** the agent calls `openspec_cli` with `command: "validate 'my-change'"`
- **THEN** the subprocess receives `my-change` (no surrounding quote characters) as the argument

#### Scenario: Unquoted tokens pass through unchanged

- **WHEN** the agent calls `openspec_cli` with `command: "list --json"`
- **THEN** the tokens `list` and `--json` are passed to openspec without modification

## MODIFIED Requirements

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
- **THEN** the failure is logged via `client.app.log`
- **AND** the tool's `execute` function throws the error
- **AND** no structured `{ error, exitCode: null }` object is returned
