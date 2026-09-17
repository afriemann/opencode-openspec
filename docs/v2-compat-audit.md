# opencode V2 Compatibility Audit — `opencode-openspec`

**Status:** Superseded — see the `v2-plugin-migration` change for the real V2 port. This
document is retained as a historical record and is updated below with the corrected
understanding and final verification results.

## Retraction of the original (2026-09-15) finding

The original version of this document, tested against `opencode-ai@dev`
(`0.0.0-dev-202609142154`), concluded this plugin was **broken** on "opencode V2" — a plugin
load-time crash (`command.trim is not a function`). Two corrections apply to that finding:

1. **`opencode-ai@dev` is not the real V2 product.** The real, documented V2 migration target
   is the separate npm package `@opencode/cli`/`@opencode/plugin` (stable, currently 2.0.x).
   `opencode-ai` (all its dist-tags, including `dev`) is V1's own evolving prerelease channel.
   See the shared `reality/opencode-v2-sandbox-plugin-compat` memory atom for the full
   correction history.
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
| `PluginInput.$` (Bun shell shortcut) | resolved once from `globalThis.Bun.$` in `setup()`; throws loudly if absent, since every capability this plugin offers depends on shelling out to `openspec` |
| `context.ask` (destructive-command confirmation) | **no equivalent** — see the confirmation-gating decision below |
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

No `ask`, `permission`, `confirm`, or `directory` field is reachable from a V2 tool's
`execute()`. Rather than silently executing an unconfirmed destructive command, `src/core.js`'s
`executeOpenspecCli` refuses it outright when its injected `confirm` capability is `null`
(which `plugin.v2.js` always passes), returning:

```json
{
  "cancelled": true,
  "reason": "confirmation-unavailable",
  "hint": "Destructive openspec verbs are not available through openspec_cli on this runtime (no confirmation mechanism is reachable from a plugin tool here). Run the command directly with the built-in shell/bash tool instead, which prompts for confirmation."
}
```

Verified live end-to-end: calling `openspec_cli({command: "archive my-feature --yes"})`
against a real change returned exactly this payload, spawned **no subprocess** (the change
directory was confirmed still present, not moved to `archive/`), and the model correctly
reported the refusal to the user instead of treating it as a normal completed archive.

**Open follow-up (not verified this session):** whether registering a tool with
`options.permission: "openspec"` and a matching `{action, resource, effect:"ask"}` rule
produces a genuine V2 prompt, or only deny-filters silently. The refusal path above does not
depend on the answer (it never touches `options.permission` at all), so this does not block
the port, but it remains an open question for a future capability if V2 ever exposes a real
per-tool confirmation surface.

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
this matches the standing lesson (`reality/opencode-v2-sandbox-plugin-compat`) that V2's event
vocabulary requires empirical testing, not just type-surface reading.

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
| Destructive verb refused with no subprocess spawned | ✅ `archive my-feature --yes` → `{cancelled:true, reason:"confirmation-unavailable", ...}`, change directory untouched |
| System-prompt injection reflects active changes without `session.created` | ✅ after the eager-population fix |
| Packaged `.opencode/lib/` layout resolves for a plain-copied (not symlinked) install | ✅ exercised across three separate scratch-project runs |
| `options.permission` prompt-suppression semantics (F9) | ⚠️ not independently re-verified this session — see the confirmation-gating decision's open follow-up above |

## Test suite

77 tests passing across 4 suites: 38 `test/plugin.test.js` + 17 `test/helpers.test.js`
(pre-existing V1 tests, behavior unchanged), 13 V2-specific lifecycle tests
(`test/plugin.v2.test.js`), and 9 shared adapter-conformance tests
(`test/adapter-conformance.test.js`) asserting both entrypoints issue identical CLI
invocations and produce identical results, except for the one deliberate divergence
(destructive-verb confirmation-gating).
