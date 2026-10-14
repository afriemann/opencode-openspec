# opencode V2 Compatibility Audit — `opencode-openspec`

**Status:** Version-aware audit. The lifecycle verification below records the original
2.0.3 port; mutation authorization is supported on 2.0.29+ as described here. Historical
claims that the plugin cannot assert permissions do not apply to that newer API.

## Native mutation authorization (v2.0.29+)

The exact OpenCode `v2.0.29` tag resolves to commit
`042d0832f5f3a73eaa039a58a7d565776f6d4290`. Its
[Promise permission API](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/plugin/src/promise/permission.ts)
exposes `ctx.permission.assert(input): Promise<void>`; it is absent in the sampled
`v2.0.28` API. A local checkout named `v2` is not evidence of this tagged contract.

The [plugin input schema](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/plugin/src/permission.ts)
requires `sessionID`, `action`, and `resources: string[]`; optional fields are `agent`,
`save`, `metadata`, and `source`. Tool provenance is `{ type: "tool", messageID, id }`.
There is no `message` or signal input field. The tagged
[Promise tool context](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/plugin/src/promise/tool.ts)
adds `signal: AbortSignal` and Promise-based `progress` to the base tool context;
separate cancellation handling remains outside this change. This plugin forwards actual calling identity and
well-formed optional provenance, supplies readable invocation metadata, and omits `save`.

Shared core validates an audited CLI 1.14.1 invocation, then awaits the V2 adapter's
assertion **outside** spawn-error conversion. Each mutator has its own action, such as
`openspec.new.change`, `openspec.archive`, or `openspec.store.remove`. One JSON-encoded
resource binds the lexical absolute cwd and immutable argv used for execution. This
authorizes the invocation's CLI-resolved effects, including external/global writes;
it is not a filesystem containment rule or an environment snapshot.

The [native core evaluator](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/permission.ts)
uses ordered `{ action, resource, effect }` rules under top-level `permissions`, with
last-match-wins and default ask. Allow can resolve without prompting; ask waits.
Configured deny is evaluated before saved allows. Denial, feedback rejection, plain
decline, and service errors propagate unchanged with no invocation or related refresh.
Plain decline must retain the host's step-ending control flow, not become tool output.
Omitting `save` prevents new reusable grants, but does not erase existing allows.

Full V2 support declares optional peer `>=2.0.29` and development SDK `2.0.29`. A runtime
capability check independently refuses mutations if assertion is non-callable or session
identity is invalid. Older manually loaded V2 runtimes retain audited reads/context;
strict package managers may reject their peer mismatch. V1 confirmation remains unchanged.

The [README](../README.md#permission-rules-and-security-boundaries-v2) contains native
rules, action inventory, syntax restrictions, wildcard caveats, and integration limits.
The added tests use the tagged schema-shaped context and injected native assertion;
they do not claim a live interactive-host verification on 2.0.29.

## Retraction of the original (2026-09-15) finding

The original version of this document, tested against `opencode-ai@dev`
(`0.0.0-dev-202609142154`), concluded this plugin was **broken** on "opencode V2" — a plugin
load-time crash (`command.trim is not a function`). Two corrections apply to that finding:

1. **`opencode-ai@dev` is not the real V2 product.** The real, documented V2 migration target
   is the separate npm package `@opencode/cli`/`@opencode/plugin` (stable, currently 2.0.x).
   `opencode-ai` (all its dist-tags, including `dev`) is V1's own evolving prerelease channel.
2. **The crash itself was real, but it was a bug in opencode's own legacy (V1) plugin loader**
   (`getLegacyPlugins`), not a V2-specific issue: that loader speculatively invokes every
   *named* export of a plugin module (not just `default`) with the same argument it passes to
   the real factory, and this plugin's `isDestructive(command)` — re-exported as a named export
   — threw on that mismatched zero-argument call. This was root-caused and fixed independently
   in `fix-v2-loader-named-export-crash` (PR #6, merged 2026-09-15): the plugin module now
   exports only `default`, and this constraint is enforced by a spec requirement (see
   `openspec/specs/plugin/spec.md`) and a regression test (`test/plugin.test.js`, "module
   export surface").

This document (the `v2-compat-audit` branch/PR #5) predated PR #6 and was rebased onto `main`
(after PR #6 merged) before the real V2 port below was built, so the port never reintroduces
that bug.

## The real V2 port (`v2-plugin-migration`)

This plugin now has two entrypoints:

- `src/plugin.v1.js` — the original `@opencode-ai/plugin` factory-function shape, unchanged
  in behavior from before this change.
- `src/plugin.v2.js` — a genuine port to `@opencode/plugin`'s `{id, setup(ctx)}` shape,
  reusing shared logic extracted into a runtime-agnostic `src/core.js`.

Both entrypoints export **only `default`** (see the retraction above for why this matters for
V1 specifically; it is applied uniformly to both files as a defensive baseline).

### Hook / capability mapping (V1 → V2)

| V1 (`@opencode-ai/plugin`) | V2 (`@opencode/plugin`) |
|---|---|
| `tool` (custom tool map, built with `tool()`/`tool.schema`) | `ctx.tool.transform((editor) => editor.add({...}))`, with plain JSON Schema `input` definitions (V2 has no schema-builder) and `options: { codemode: false }` on every tool so it stays directly callable rather than falling back to Code-Mode-only indirection |
| `event` hook, filtered for `session.created` | `ctx.event.subscribe({signal})`, a detached async iterator stopped via an `AbortController` in the `setup()` cleanup |
| `experimental.chat.system.transform` | `ctx.session.hook("context", (event) => { event.system.push({type:'text', text}) })` — note V2 wraps each pushed part in an object, unlike V1's bare strings |
| `PluginInput.$` (Bun shell shortcut) | **not used**: both adapters spawn `openspec` through `src/lib/exec.js` (`node:child_process`), because Bun's `$` has no kill API and a `Promise.race` timeout would leave the child running |
| `context.ask` (destructive-command confirmation) | `ctx.permission.assert(...)` from the setup context on 2.0.29+; policy evaluation, not unconditional confirmation |
| `client.app.log` | **no equivalent** (`Context.app` has no `log` method) — logs go straight to `process.stderr.write` |

### The confirmation-gating decision

V1 gates destructive `openspec_cli` commands (`archive`, `new change`) behind
`context.ask(...)`, prompting the user for approval before spawning. V2's tool-execution
context has no analogous mechanism — confirmed empirically against the real, installed
`@opencode/cli` 2.0.3 host by logging `Object.keys(toolContext)` from inside a live tool call:

```
OQ1-KEYS: ["sessionID","agent","messageID","id","progress"]
OQ1-HASASK: false
OQ1-HASPERM: false
OQ1-HASCONFIRM: false
OQ1-HASDIR: false
```

No `ask`, `permission`, `confirm`, or `directory` field is present on that V2 tool context.
This does **not** establish absence of assertion on the setup context. On 2.0.29+, the
plugin uses the native permission domain as described above. Missing native assertion
refuses mutations rather than running them directly or redirecting through a shell.
V1 continues to use `context.ask` before its destructive operations.

### The `session.created` correction (found during live verification)

The original design (informed by the installed `@opencode/plugin` type surface, which lists
`session.created` with a `{sessionID, location:{directory}}` payload shape) assumed this event
would fire once per session and drive cache population, mirroring V1's `event` hook.

**Live verification against the real host contradicted this.** Instrumenting the V2 event loop
to log every observed `rawEvent.type` for a plain `opencode run "..."` invocation showed the
stream go straight from setup/catalog events (`agent.updated`, `catalog.updated`,
`command.updated`, `mcp.status.changed`, …) to `session.inbox.enqueued` →
`session.execution.started` → … → `session.execution.succeeded` — **`session.created` never
appeared.** The type surface was real but did not guarantee emission for this invocation shape;
V2 event emission requires empirical verification, not just type-surface reading.

**Fix:** `plugin.v2.js` now populates the cache **eagerly at `setup()`**, using
`ctx.location.directory` (already known and stable at setup time — and, per the OQ-1 finding
above, the only directory a V2 plugin instance ever has, since `Tool.Context` has none either).
The `session.created` subscription and its `sessionDirs` tracking map are kept as
defense-in-depth for other possible hosting modes (e.g. a persistent multi-session server),
but correctness no longer depends on that event firing.

Verified live: with the eager-population fix in place, a fresh `opencode run` correctly
reported an active OpenSpec change (`my-feature`) from injected system-prompt context, with
zero `session.created` events observed anywhere in that run's log.

## Verification summary (real host, `@opencode/cli` 2.0.3)

| Check | Result |
|---|---|
| Plugin loads via `.opencode/plugins/` auto-discovery, shared code in sibling `.opencode/lib/` | ✅ loads cleanly; 6 sibling V1-shape plugins present in the same run correctly *failed* to load under V2's loader (`Plugin must export a default definition with an id and an effect or setup function`), confirming the V2 loader genuinely distinguishes shape |
| `openspec_status`/`openspec_cli`/`openspec_instructions` directly callable (not Code-Mode-only) | ✅ confirmed via `⚙ openspec_status {...}` direct-call rendering, no Code-Mode fallback |
| `Object.keys(toolContext)` matches documented shape, no ask/permission/confirm/directory | ✅ exactly `["sessionID","agent","messageID","id","progress"]` |
| (historical, superseded by `full-cli-support`) Destructive verb refused with no subprocess spawned | ✅ `archive my-feature --yes` → `{cancelled:true, reason:"confirmation-unavailable", ...}`, change directory untouched |
| System-prompt injection reflects active changes without `session.created` | ✅ after the eager-population fix |
| Packaged `.opencode/lib/` layout resolves for a plain-copied (not symlinked) install | ✅ exercised across three separate scratch-project runs |
| `options.permission` prompt-suppression semantics (F9) | ⚠️ not independently re-verified this session — see the confirmation-gating decision's open follow-up above |

## Test suite

Run `npm test` for the current suite. Permission-intent, CLI-pipeline, V2-adapter, and
adapter-conformance tests cover the audited grammar, distinct mutation actions, immutable
invocation binding, pending approval, rejection identity, compatibility refusals, and V1
preservation. Shared read-only results, context injection, and cleanup remain equivalent;
V2 intentionally differs in accepted grammar and native mutation authorization.

## Addendum (2026-09-17): confirmation-gating design re-confirmed; two related ideas assessed

> Historical v2.0.6 assessment. The absence-of-assertion conclusion is superseded by the
> tagged v2.0.29 API above. `options.permission` remains a catalogue filter, not per-call authorization.

A later, independent architectural-suitability review re-examined this plugin's V2 design
against opencode V2's real native capabilities — specifically, whether the open follow-up
noted above (`options.permission` as a possible native replacement for the "refuse destructive
`openspec_cli` verbs outright, redirect to bash" confirmation-gating design) had since been
resolved.

### `options.permission` re-verified: does not gate individual invocations

The review's conclusion, source-verified against the real V2 source (`/tmp/opencode/v2-src`,
tag `v2.0.6`, `packages/core/src/tool.ts`):

> `options.permission` only affects wholesale tool-visibility filtering at `Tool.snapshot()`
> time (deny-only, hides the tool from the model's catalog entirely) — it never gates a
> specific invocation with a confirmation prompt, and `ctx.permission.rules(...)` does not
> exist on the real plugin-facing `PermissionDomain` type at all.

**Conclusion at v2.0.6:** descriptor permissions were insufficient for per-call gating.
The descriptor finding still applies, but it does not limit the assertion API introduced
in v2.0.29. The plugin now gates mutations with that native API, without a V1-style prompt
fallback or broad shell authorization.

This closes the open follow-up recorded above under "The confirmation-gating decision"; no
further re-verification of `options.permission` is pending.

### `ctx.storage` considered and rejected for the injection cache

The same review separately assessed `ctx.storage` as a possible replacement for the in-memory
`cacheByDir` Map used by the system-prompt injection path, and rejected it: the cache is a
deliberately short-lived, live-filesystem probe of the current OpenSpec change state, and
persisting it via `ctx.storage` would risk serving stale data across runs or after external
mutation of the `openspec/` directory — a correctness regression, not an improvement. No change
made.

### `ctx.command` for a read-only status command — backlog idea only

`ctx.command` was noted as a plausible, low-priority, purely additive idea: a read-only
`/openspec-status` slash command surfacing the same information the existing `openspec_status`
tool already provides. This is not required and has not been implemented; it is recorded here
only as a backlog note for a possible future change.
