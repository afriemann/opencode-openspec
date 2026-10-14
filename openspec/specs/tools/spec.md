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
string. It SHALL invoke supported commands in the resolved working directory and return a
JSON object with `stdout`, `stderr`, and `exitCode`. V1 retains its existing command support;
V2 accepts only audited forms, subject to native mutation authorization. A non-zero exit code
from an executed CLI command SHALL be returned as a normal result, not an authorization error.

#### Scenario: Read-only command returns stdout and exit code

- **WHEN** the agent calls `openspec_cli` with `command: "list --json"`
- **THEN** the tool runs `openspec list --json` in the resolved working directory
- **AND** returns `{ stdout: "<json string>", stderr: "", exitCode: 0 }`

#### Scenario: Non-zero exit from CLI is a normal return

- **WHEN** the agent calls `openspec_cli` with a supported command that causes openspec to exit non-zero (e.g. validate on an invalid change)
- **THEN** the tool returns `{ stdout: "...", stderr: "...", exitCode: <non-zero> }`
- **AND** does not throw or return an error structure

#### Scenario: openspec not on PATH returns a structured error

- **WHEN** the `openspec` binary is not on `PATH` and an authorized or read-only command spawn fails
- **THEN** the tool returns `{ error: "<message describing the failure>", exitCode: null }`
- **AND** the failure is logged via `client.app.log` on V1 or the existing runtime logger on V2
- **AND** no spawn exception propagates from the tool's `execute` function

### Requirement: openspec_cli gates destructive verbs before spawning

The `openspec_cli` tool SHALL retain V1 confirmation for parsed destructive verbs
(`archive`, `new change`, `store remove`, `store unregister`, `workset remove`, `config reset`,
and `config unset`), including leading global options. V1 denial SHALL return `{ cancelled: true }`
without execution. V2 SHALL authorize every supported mutation through native permission
assertion before spawning, rather than infer safety from the absence of V1 confirmation.

#### Scenario: archive command triggers confirmation

- **WHEN** the agent calls `openspec_cli` with `command: "archive my-change --yes"` on V1
- **THEN** confirmation is requested before the subprocess is started
- **AND** if the user approves, the command is executed and the result returned normally

#### Scenario: User denial returns cancelled result

- **WHEN** the agent calls `openspec_cli` with a destructive verb on V1
- **AND** the user denies confirmation
- **THEN** the tool returns `{ cancelled: true }`
- **AND** no subprocess is spawned

#### Scenario: Read-only command with change name containing archive is not gated

- **WHEN** the agent calls `openspec_cli` with `command: "status --change archive-cleanup --json"`
- **THEN** no confirmation or mutation assertion is requested
- **AND** the command is executed immediately without a confirmation prompt, on either runtime

#### Scenario: Destructive verb executes when no confirmation mechanism is available

- **GIVEN** V2 has callable native permission assertion and valid calling session identity
- **WHEN** the agent calls `openspec_cli` with `command: "archive my-change --yes"` without a V1 confirmation mechanism
- **AND** native authorization resolves
- **THEN** the subprocess is spawned and the command executes
- **AND** the result is returned as `{ stdout, stderr, exitCode }` with no `cancelled` field
- **AND** absence of native assertion would instead refuse the mutation before spawning

#### Scenario: Leading global option does not bypass the gate

- **WHEN** the agent calls `openspec_cli` with `command: "--no-color archive my-change --yes"`
- **THEN** V1 confirmation or V2 mutation assertion is completed before the subprocess is started

### Requirement: openspec_cli refreshes the injection cache after mutating commands

The plugin SHALL refresh its injection cache for the resolved project directory after an
executed non-read-only command, whether it exited zero, exited non-zero, or timed out.
V1 includes unknown verbs in its existing non-read-only classification; V2 refuses unaudited
forms before execution. Read-only commands, pre-execution refusals, and native assertion
rejections SHALL NOT trigger an invocation-related refresh.

#### Scenario: Cache is refreshed after new change creation

- **WHEN** the agent calls `openspec_cli` with `command: "new change my-feature"` and the authorized command completes successfully
- **THEN** the injection cache for the project directory is re-populated by running `openspec list --json`

#### Scenario: Cache is refreshed after a failed or timed-out mutating command

- **WHEN** an authorized non-read-only command exits non-zero or is killed by the timeout
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
V2 SHALL apply audited-form validation to the resulting literal arguments before execution.

#### Scenario: Quoted argument with spaces reaches the CLI intact

- **WHEN** the agent calls `openspec_cli` with `command: "new change \"my-feature\" --description 'two words'"`
- **AND** any required runtime authorization resolves
- **THEN** the CLI receives the arguments `new`, `change`, `my-feature`, `--description`, `two words`

#### Scenario: Shell metacharacters are inert

- **WHEN** the agent calls `openspec_cli` with `command: "list ; rm -rf $HOME"`
- **THEN** V1 passes `;`, `rm`, `-rf` and `$HOME` as literal arguments with no shell involved
- **AND** V2 refuses the unaudited form without executing a CLI or shell subprocess

#### Scenario: Leading openspec token is ignored

- **WHEN** the agent calls `openspec_cli` with `command: "openspec list --json"`
- **THEN** the CLI receives `list`, `--json`

#### Scenario: Unterminated quote is rejected

- **WHEN** the agent calls `openspec_cli` with `command: "show \"my-change"`
- **THEN** the tool returns `reason: "parse-error"` and spawns nothing

### Requirement: openspec_cli refuses commands that cannot run non-interactively or reach outside the project

The `openspec_cli` tool SHALL refuse, without spawning, `config edit`, `workset open`,
`completion install`, `completion uninstall`, and `feedback`, returning `{ cancelled: true,
reason, error, hint }` with existing `interactive` or `out-of-scope-side-effect` reasons.
Existing bare-help exemption SHALL remain; help as an option value, after `--`, or mixed with
operands grants no exemption. Executed commands SHALL retain closed stdin, unchanged host
environment, and no injected flags; V2 additionally requires an audited form and mutation authorization.

#### Scenario: Editor-launching command fails fast

- **WHEN** the agent calls `openspec_cli` with `command: "config edit"`
- **THEN** the tool returns `cancelled: true` and `reason: "interactive"` without spawning
- **AND** V2 does not request a mutation assertion

#### Scenario: Out-of-project side effect is refused

- **WHEN** the agent calls `openspec_cli` with `command: "completion install bash"`
- **THEN** the tool returns `cancelled: true` and `reason: "out-of-scope-side-effect"` without spawning
- **AND** V2 does not request a mutation assertion

#### Scenario: Help for a blocked command is allowed

- **WHEN** the agent calls `openspec_cli` with `command: "feedback --help"`
- **THEN** the command is executed without V1 confirmation or V2 mutation assertion

#### Scenario: Help flag used as an option value does not bypass the blocklist

- **WHEN** the agent calls `openspec_cli` with `command: "feedback hi --body -h"`
- **THEN** the tool returns `cancelled: true` and `reason: "out-of-scope-side-effect"` without spawning

#### Scenario: Commands run with stdin closed and no injected flags

- **WHEN** the agent calls `openspec_cli` with `command: "archive my-change"`
- **AND** runtime authorization resolves
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

### Requirement: V2 CLI accepts only audited command forms

The V2 tool SHALL accept the CLI 1.14.1 forms below using separate option/value tokens and
listed aliases, including audited global/parent options, without dropping or reordering tokens.
Unknown commands, subcommands, flags, malformed operands, missing values, long-option equals
syntax, `--` terminators, and short bundles SHALL return `{ cancelled: true, reason:
"unaudited-command", error, hint }` before assertion or execution. The hint SHALL name the audit version.

#### Scenario: Audited commands and options are accepted

- **GIVEN** `B` denotes a boolean flag, `V` a required option value, brackets optional operands, and angle brackets required operands
- **WHEN** a V2 invocation uses a form in the inventory with valid arity and listed options
- **THEN** it is classified read-only or mutating as shown and proceeds subject to mutation authorization
- **AND** global `--no-color B`, config parent `--scope V` with global scope, and workset parent `--json B` are accepted in their applicable command paths

| Form | Leaf options | Kind |
| --- | --- | --- |
| `init [path]` | `--tools V`, `--language V`, `--force B`, `--profile V`, `--no-animation B`, `--copilot-cloud B`, `--no-copilot-cloud B` | Mutation |
| `update [path]` | `--force B` | Mutation |
| `new change <name>` | `--description V`, `--goal V`, `--schema V`, `--json B`, `--store V`, `--store-path V`, `--initiative V`, `--areas V` | Mutation |
| `archive [change]` | `-y`/`--yes B`, `--skip-specs B`, `--no-validate B`, `--json B`, `--store V`, `--store-path V` | Mutation |
| `store setup [id]` | `--path V`, `--init-git B`, `--no-init-git B`, `--remote V`, `--json B` | Mutation |
| `store register [path]` | `--id V`, `--yes B`, `--json B` | Mutation |
| `store unregister <id>` | `--json B` | Mutation |
| `store remove <id>` | `--yes B`, `--json B` | Mutation |
| `workset create [name]` | repeatable `--member V`, `--tool V`, `--json B` | Mutation |
| `workset remove <name>` | `--yes B`, `--json B` | Mutation |
| `config set <key> <value>` | `--string B`, `--allow-unknown B` | Mutation |
| `config unset <key>` | None | Mutation |
| `config reset` | `--all B`, `-y`/`--yes B` | Mutation |
| `config profile [preset]` | None | Mutation |
| `schema fork <source> [name]` | `--json B`, `--force B` | Mutation |
| `schema init <name>` | `--json B`, `--description V`, `--artifacts V`, `--default B`, `--no-default B`, `--force B` | Mutation |
| `version` | `--json B`, `--check B` | Read-only |
| `list` | `--specs B`, `--changes B`, `--archived B`, `--all B`, `--sort V`, `--json B`, `--store V`, `--store-path V` | Read-only |
| `view` | `--store V`, `--store-path V` | Read-only |
| `change show [name]` | `--json B`, `--deltas-only B`, `--requirements-only B`, `--diff B`, `--no-interactive B` | Read-only |
| `change list` | `--json B`, `--long B` | Read-only |
| `change validate [name]` | `--strict B`, `--json B`, `--no-interactive B` | Read-only |
| `validate [item]` | `--all B`, `--changes B`, `--specs B`, `--archived B`, `--report V`, `--type V`, `--strict B`, `--json B`, `--concurrency V`, `--no-interactive B`, `--store V`, `--store-path V` | Read-only |
| `show [item]` | `--json B`, `--type V`, `--no-interactive B`, `--deltas-only B`, `--requirements-only B`, `--diff B`, `--requirements B`, `--no-scenarios B`, `-r`/`--requirement V`, `--store V`, `--store-path V` | Read-only |
| `completion generate [shell]` | None | Read-only |
| `status` | `--change V`, `--all B`, `--schema V`, `--json B`, `--store V`, `--store-path V` | Read-only |
| `instructions [artifact]` | `--change V`, `--schema V`, `--json B`, `--store V`, `--store-path V` | Read-only |
| `templates` | `--schema V`, `--json B` | Read-only |
| `schemas` | `--json B`, `--store V`, `--store-path V` | Read-only |
| `config path` | None | Read-only |
| `config list` | `--json B` | Read-only |
| `config get <key>` | None | Read-only |
| `schema which [name]` | `--json B`, `--all B` | Read-only |
| `schema validate [name]` | `--json B`, `--verbose B` | Read-only |
| `store list` / `store ls` | `--json B` | Read-only |
| `store doctor [id]` | `--json B` | Read-only |
| `workset list` / `workset ls` | `--json B` | Read-only |

#### Scenario: Unknown commands and flags fail closed

- **WHEN** V2 receives an unknown verb, unknown subcommand, or unaudited flag even on a read-only verb
- **THEN** it returns `reason: "unaudited-command"` with an audit-version hint and no assertion or subprocess
- **AND** hidden `experimental`, internal `__complete`, and unverified `doctor`, `context`, and `spec` forms are refused

#### Scenario: Unsupported option syntax and malformed arity fail closed

- **WHEN** V2 receives long-option equals syntax, `--` as an option terminator, a short bundle, missing option values, or operands outside a form's required/optional arity
- **THEN** it returns `reason: "unaudited-command"` without assertion or subprocess
- **AND** an equals sign inside an ordinary operand or value remains an inert value, not option syntax

#### Scenario: Option values and help tokens do not change command intent

- **WHEN** V2 receives `new change my-change --description archive` or `new change my-change --description -h`
- **THEN** the invocation remains a mutation requiring `openspec.new.change`
- **AND** `archive -- --yes` is refused as unsupported syntax rather than exempted as help
- **AND** `store --help remove` is not treated as a bare-help exemption

### Requirement: V2 mutations use operation-specific permission actions

The V2 tool SHALL assert the canonical action for each supported mutating form below.
Creation authorization SHALL NOT substitute for archival or removal authorization.
Each action authorizes all effects of the accepted invocation, including accepted overwrite,
global configuration, external store, and removal flags; it is not a claim of harmless creation.

#### Scenario: Each mutation uses its canonical action

- **WHEN** V2 executes a supported mutation
- **THEN** its native assertion uses the corresponding action, never a generic tool or shell action

| Command | Action |
| --- | --- |
| `init` | `openspec.init` |
| `update` | `openspec.update` |
| `new change` | `openspec.new.change` |
| `archive` | `openspec.archive` |
| `store setup` | `openspec.store.setup` |
| `store register` | `openspec.store.register` |
| `store unregister` | `openspec.store.unregister` |
| `store remove` | `openspec.store.remove` |
| `workset create` | `openspec.workset.create` |
| `workset remove` | `openspec.workset.remove` |
| `config set` | `openspec.config.set` |
| `config unset` | `openspec.config.unset` |
| `config reset` | `openspec.config.reset` |
| `config profile` | `openspec.config.profile` |
| `schema fork` | `openspec.schema.fork` |
| `schema init` | `openspec.schema.init` |

### Requirement: V2 authorization binds to the executed invocation

The V2 tool SHALL authorize one immutable invocation using a single resource equal to
`JSON.stringify([absoluteEffectiveWorkdir, ...parsedArgv])`. The executed cwd and argv SHALL
match that authorized snapshot. Workdir selection SHALL retain existing precedence and
lexical absolute resolution, preserving relative-path base and symlink spelling. The resource
authorizes CLI-resolved effects, not filesystem containment or frozen external configuration.

#### Scenario: Pending approval cannot change the executed invocation

- **GIVEN** a mutation assertion is pending for an explicit workdir and parsed command
- **WHEN** caller-owned arguments, session-directory state, or request metadata are subsequently changed
- **AND** authorization resolves
- **THEN** the command executes exactly once with the original authorized cwd and argv

#### Scenario: Lexical workdir and argument boundaries are preserved

- **WHEN** V2 authorizes a mutation with a relative workdir, symlink-spelled directory, or quoted values containing spaces, quotes, equals signs, or wildcard characters
- **THEN** the single resource and executed cwd/argv preserve the same lexical directory spelling and literal token boundaries
- **AND** no realpath rewriting, expansion, argument reordering, or session-relative base change occurs

### Requirement: V2 native assertion uses actual calling context

The V2 tool SHALL supply actual session identity, canonical action, one invocation resource,
and readable metadata containing operation, workdir, and argv to native assertion.
Wellformed optional agent and tool-source identity SHALL be forwarded; malformed optional
values SHALL be omitted. The request SHALL omit `message` and `save` and SHALL preserve the
native method receiver. Omitted save requests no new reusable grant, not revocation of existing grants.

#### Scenario: Native request matches the v2.0.29 input contract

- **GIVEN** a V2 calling context with valid sessionID, agent, messageID, and id
- **WHEN** a mutation is authorized
- **THEN** the assertion receives sessionID, canonical action, one serialized invocation resource, readable metadata, agent, and `source: { type: "tool", messageID, id }`
- **AND** neither `message` nor `save` is present
- **AND** the assertion's native receiver is preserved

#### Scenario: Missing or malformed optional provenance is omitted

- **WHEN** a valid-session mutation lacks wellformed optional agent, messageID, or id values
- **THEN** optional agent or source is omitted as applicable without fabrication or malformed input
- **AND** required identity and invocation authorization remain intact

### Requirement: V2 mutation authorization waits for host permission

The V2 tool SHALL await native assertion resolution before mutation execution.
An allow decision can resolve without prompting; ask remains pending until the host resolves
or rejects it. The plugin SHALL NOT substitute unconditional confirmation for native policy
evaluation. While pending, the invocation SHALL trigger neither command execution nor cache refresh.

#### Scenario: Allowed invocation proceeds without plugin confirmation

- **GIVEN** native assertion resolves under host allow policy
- **WHEN** V2 receives an audited mutation
- **THEN** it executes once after assertion resolution without invoking V1 confirmation or adding a plugin prompt

#### Scenario: Pending ask prevents execution until approval

- **GIVEN** native assertion remains pending under host ask policy
- **WHEN** V2 receives an audited mutation
- **THEN** no invocation or cache-refresh subprocess starts while pending
- **AND** after the host approves, the exact authorized invocation executes once

### Requirement: V2 authorization failures propagate unchanged

The V2 tool SHALL propagate every synchronous native assertion throw and asynchronous rejection
unchanged, including configured denial, plain rejection, corrective feedback, and service failure.
It SHALL NOT convert authorization errors into ordinary results, spawn-failure output, or V1
cancellation. Rejected invocations SHALL trigger zero command or invocation-related refresh
subprocesses; unrelated setup/context activity retains its existing behavior.

#### Scenario: Configured denial propagates before spawn

- **WHEN** native assertion rejects with the host's configured-denial error
- **THEN** the same error object propagates and no invocation or refresh subprocess starts

#### Scenario: Plain rejection preserves step-ending control flow

- **WHEN** native assertion rejects because the user declined without feedback
- **THEN** the same step-ending native rejection propagates, not `{ cancelled: true }` or normal tool output
- **AND** no invocation or refresh subprocess starts

#### Scenario: Corrective feedback rejection is preserved

- **WHEN** native assertion rejects with corrective feedback
- **THEN** the original native error and feedback propagate unchanged
- **AND** no invocation or refresh subprocess starts

#### Scenario: Permission service failure fails closed

- **WHEN** native assertion throws synchronously or rejects asynchronously with a permission-service failure
- **THEN** the same error object propagates outside spawn-error conversion
- **AND** no invocation or refresh subprocess starts

### Requirement: V2 mutations fail closed without native authorization capability

The plugin SHALL declare V2 >=2.0.29 as its supported mutation runtime and refuse mutations
with `{ cancelled: true, reason: "permission-unavailable", error, hint }` when native assertion
is missing/non-callable or calling sessionID is missing, empty, or non-string. Supported read-only
functionality SHALL remain available where the plugin loads. There SHALL be no generic shell,
V1 confirmation, broad-tool-permission, or unguarded-execution fallback.

#### Scenario: Missing or non-callable assertion refuses mutations

- **GIVEN** an older or malformed V2 context without callable native assertion
- **WHEN** an audited mutation is requested
- **THEN** the tool returns `reason: "permission-unavailable"` with an upgrade/capability hint
- **AND** no invocation or refresh subprocess starts

#### Scenario: Invalid session identity refuses mutations

- **WHEN** a V2 mutation's calling sessionID is missing, empty, or non-string
- **THEN** the tool returns `reason: "permission-unavailable"` without assertion, command execution, or refresh

#### Scenario: Older manually loaded runtime retains read-only functionality

- **GIVEN** the plugin is loaded on V2 without native assertion
- **WHEN** the caller requests an audited read-only command or the dedicated status/instructions tools
- **THEN** existing read-only execution remains available without mutation assertion
- **AND** context injection retains its existing behavior

### Requirement: V1 behavior remains independent of V2 authorization

The V1 plugin SHALL retain its existing broad command support, destructive confirmation and
cancellation, read-only execution, and cache semantics without requiring native V2 assertion
or applying the V2 grammar. Its peer minimum SHALL remain unchanged.

#### Scenario: V1 command support does not inherit V2 refusals

- **WHEN** V1 receives a command form its existing classifier supports but the V2 grammar refuses
- **THEN** it follows its existing execution, confirmation, and refresh behavior without native assertion
