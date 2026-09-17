## MODIFIED Requirements

### Requirement: System-prompt transform hook is pure

The system-prompt injection hook SHALL perform no filesystem access, no subprocess spawn, and
no network I/O. It SHALL only read from the in-memory injection cache and add content to the
system prompt being assembled for the LLM call, in whatever content shape the runtime requires.
This ensures the hook completes with negligible latency and does not block the LLM call.

#### Scenario: Transform reads cache and pushes strings only

- **WHEN** the system-prompt injection hook is invoked
- **THEN** it reads the cached entry for the calling session's project directory
- **AND** adds content to the system prompt being assembled
- **AND** calls no filesystem functions and spawns no subprocess

### Requirement: Injection includes tools notice and active changes list when openspec is present

When the injection cache contains a `{ present: true }` entry for the calling session's project
directory, the system-prompt injection hook SHALL add two pieces of content to the system
prompt: (1) a static notice naming the three tools (`openspec_cli`, `openspec_status`,
`openspec_instructions`) and directing the agent to use them instead of raw CLI commands; and
(2) a one-line summary of each active change in the cached list showing its name and
task-completion counts.

#### Scenario: Injection includes static tools notice

- **WHEN** openspec is present in the project and the cache has been populated
- **THEN** the transform hook adds content containing the names of the three tools to the system prompt

#### Scenario: Injection includes active changes summary

- **WHEN** the cache contains a list of active changes
- **THEN** the transform hook adds content summarising those changes (name and completion counts) to the system prompt

### Requirement: Injection degrades gracefully on cache miss or population failure

If the cache has no entry for the calling session's project directory (e.g. the transform fires
before the cache has been populated, or population failed), the plugin SHALL still inject the
static tools notice and omit the changes summary. If the project is not present in the cache at
all, the plugin SHALL inject nothing — neither the notice nor the changes list.

#### Scenario: Static notice is injected on cache miss

- **WHEN** the transform hook fires and the cache has no entry for the project directory
- **THEN** the plugin still adds the static tools notice to the system prompt
- **AND** no changes summary is added

#### Scenario: Nothing is injected in a non-openspec project

- **WHEN** the cache entry for the project directory has `present: false`
- **THEN** the transform hook adds nothing to the system prompt

## ADDED Requirements

### Requirement: Injection cache is keyed by the calling session's project directory

The plugin SHALL resolve which project directory's cache entry applies to a given system-prompt
injection using the calling session's own association with a directory, however the runtime
makes that association available — not a single directory fixed at plugin load time — so that a
runtime hosting multiple concurrent sessions in different directories injects the correct
per-session content for each.

#### Scenario: Two concurrent sessions in different directories each see their own project's content

- **WHEN** two sessions with different project directories are active concurrently, one with `openspec/` present and one without
- **THEN** the session in the `openspec/`-present directory receives the tools notice and any changes summary
- **AND** the other session receives no injected content
