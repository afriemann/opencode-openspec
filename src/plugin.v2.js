// src/plugin.v2.js — opencode-openspec plugin, V2 entrypoint (@opencode/plugin)
//
// Thin adapter over src/core.js, mapping the same tool/event/system-prompt
// logic onto opencode's real V2 plugin SDK. Deliberately does NOT import
// `@opencode/plugin` at runtime (matching the established pattern from
// opencode-use/opencode-auto-instruct/opencode-redact/opencode-notify):
// `Plugin.define` is a verified identity function, and the package is an
// optional peer dependency.
//
// See design.md for the full decision record, especially the
// confirmation-gating decision: V2 exposes no plugin-reachable equivalent
// of V1's `context.ask` (confirmed by reading the installed @opencode/plugin
// and @opencode/schema types directly — Tool.Context has no ask/permission/
// confirm field, and PermissionDomain/SessionDomain deliberately omit the
// operations that could raise one). Destructive openspec_cli commands are
// therefore refused (not silently executed) on this runtime — see core.js's
// executeOpenspecCli with `confirm: null`.
//
// @typedef {import("@opencode/plugin").Plugin} Plugin

import {
  handleSessionCreated,
  composeSystemParts,
  executeOpenspecCli,
  executeOpenspecStatus,
  executeOpenspecInstructions,
  TOOL_SCHEMAS,
  TOOL_DESCRIPTIONS,
  V2_TOOL_OPTIONS,
} from './core.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PLUGIN_NAME = 'opencode-openspec'
const TOOL_NAMES = ['openspec_cli', 'openspec_status', 'openspec_instructions']

// Bound on how long the eager cache-population call (below) may block
// setup() before we give up waiting and let the plugin finish loading
// anyway (code-review finding: a hung `openspec` subprocess — stuck mount,
// huge repo, misbehaving binary — should degrade to "cache miss" rather
// than stalling this plugin's, and potentially the whole host's, startup).
const EAGER_CACHE_TIMEOUT_MS = 5000

/**
 * V2's `Context` has no `app.log` (unlike V1's `client.app.log`), so this
 * writes directly to stderr. Message formatting mirrors `logError` in
 * src/lib/helpers.js for parity between the two adapters' log lines.
 */
function makeLog() {
  return (level, message, err) => {
    const detail = err
      ? `: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
      : ''
    process.stderr.write(`[${PLUGIN_NAME}] ${level}: ${message}${detail}\n`)
  }
}

export default {
  id: PLUGIN_NAME,

  /**
   * @param {{
   *   location: { directory: string },
   *   tool: { transform(cb: (editor: object) => void | Promise<void>): Promise<{dispose(): Promise<void>}> },
   *   event: { subscribe(opts: {signal: AbortSignal}): AsyncIterable<unknown> },
   *   session: { hook(name: string, cb: Function): Promise<{dispose(): Promise<void>}> },
   * }} ctx
   */
  async setup(ctx) {
    const log = makeLog()

    // design.md D-3: every capability this plugin offers depends on
    // shelling out to the `openspec` binary. Fail loudly and immediately
    // if the Bun shell shortcut isn't available, rather than answering
    // every tool call with an error later.
    const $ = globalThis.Bun?.$
    if (!$) {
      throw new Error(`${PLUGIN_NAME}: globalThis.Bun.$ is not available; this plugin requires the Bun shell runtime.`)
    }

    /** @type {Map<string, object>} */
    const cacheByDir = new Map()
    /** @type {Map<string, string>} sessionID -> directory */
    const sessionDirs = new Map()

    const caps = { $, log, confirm: null, cacheByDir }

    // ------------------------------------------------------------------
    // Tools (design.md D-2: every descriptor MUST carry V2_TOOL_OPTIONS)
    // ------------------------------------------------------------------

    const toolRegistration = await ctx.tool.transform((editor) => {
      editor.add({
        name: 'openspec_cli',
        description: TOOL_DESCRIPTIONS.openspec_cli,
        input: TOOL_SCHEMAS.openspec_cli,
        options: V2_TOOL_OPTIONS,
        async execute(input, toolCtx) {
          const resolveCtx = { defaultDir: ctx.location.directory, sessionID: toolCtx.sessionID, sessionDirs }
          const result = await executeOpenspecCli(input, resolveCtx, caps)
          return { content: result }
        },
      })
      editor.add({
        name: 'openspec_status',
        description: TOOL_DESCRIPTIONS.openspec_status,
        input: TOOL_SCHEMAS.openspec_status,
        options: V2_TOOL_OPTIONS,
        async execute(input, toolCtx) {
          const resolveCtx = { defaultDir: ctx.location.directory, sessionID: toolCtx.sessionID, sessionDirs }
          const result = await executeOpenspecStatus(input, resolveCtx, caps)
          return { content: result }
        },
      })
      editor.add({
        name: 'openspec_instructions',
        description: TOOL_DESCRIPTIONS.openspec_instructions,
        input: TOOL_SCHEMAS.openspec_instructions,
        options: V2_TOOL_OPTIONS,
        async execute(input, toolCtx) {
          const resolveCtx = { defaultDir: ctx.location.directory, sessionID: toolCtx.sessionID, sessionDirs }
          const result = await executeOpenspecInstructions(input, resolveCtx, caps)
          return { content: result }
        },
      })

      // Defensive post-registration assertion (design.md D-2, code-reviewer-
      // mandated in the opencode-use port): a tool silently losing
      // codemode:false is otherwise invisible -- the plugin loads, the tools
      // exist, and the agent simply cannot call them directly.
      for (const name of TOOL_NAMES) {
        const descriptor = editor.get(name)
        if (!descriptor || descriptor.options?.codemode !== false) {
          throw new Error(`${PLUGIN_NAME}: tool '${name}' is missing options.codemode:false after registration`)
        }
      }
    })

    // ------------------------------------------------------------------
    // Eager cache population (empirical correction, tasks.md 4.3a)
    // ------------------------------------------------------------------
    //
    // `session.created` was expected to fire once per session and drive the
    // cache population (design.md D-4's original plan, mirroring V1's
    // `event` hook). Live verification against the real V2 host
    // (`@opencode/cli` 2.0.3, single-shot `opencode run` invocations)
    // showed this does NOT hold: the observed event stream for a run goes
    // straight from setup/catalog events to `session.inbox.enqueued` /
    // `session.execution.started` — `session.created` never appears.
    // Since `ctx.location.directory` is already known and stable at
    // `setup()` time (V2 gives a plugin instance exactly one directory,
    // matching the fact that `Tool.Context` has none either — design.md
    // F5), the cache is populated here directly rather than waiting on an
    // event that may never arrive for this invocation shape.
    //
    // Bounded by EAGER_CACHE_TIMEOUT_MS (code-review finding): unlike V1,
    // where cache population was fire-and-forget off the `event` hook and
    // never blocked plugin load, this call is awaited inside `setup()` — a
    // hung `openspec` subprocess would otherwise stall the whole plugin's
    // (and potentially the host's) startup. On timeout, setup() proceeds
    // with an empty cache (equivalent to a cache miss: the static tools
    // notice is still injected, no active-changes summary); the underlying
    // call is left to finish in the background and will still populate the
    // cache late if it ever completes. The timer itself is always cleared
    // once the race settles (whichever side wins) so a fast-resolving call
    // never leaves a dangling 5s timer behind — this matters both for
    // production shutdown and for test suites asserting no open handles.
    {
      let timeoutId
      await Promise.race([
        handleSessionCreated(cacheByDir, $, log, existsSync, ctx.location.directory, { join }),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => {
            log('warn', `eager cache population exceeded ${EAGER_CACHE_TIMEOUT_MS}ms; continuing without it`)
            resolve()
          }, EAGER_CACHE_TIMEOUT_MS)
        }),
      ]).finally(() => clearTimeout(timeoutId))
    }

    // ------------------------------------------------------------------
    // Event subscription (session.created -> cache re-population, kept as
    // defense-in-depth: some hosting modes, e.g. a persistent multi-session
    // server, may still emit it with a session-specific directory)
    // ------------------------------------------------------------------

    const controller = new AbortController()

    ;(async () => {
      try {
        for await (const rawEvent of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            if (rawEvent.type !== 'session.created') continue // unmapped: no await, no cost
            const { sessionID, location } = rawEvent.data ?? {}
            const dir = location?.directory ?? ctx.location.directory
            if (sessionID && dir) {
              sessionDirs.set(sessionID, dir)
            }
            await handleSessionCreated(cacheByDir, $, log, existsSync, dir, { join })
          } catch (err) {
            log('error', `event handling failed for '${rawEvent?.type}'`, err)
          }
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          log('error', 'event subscription loop terminated unexpectedly', err)
        }
      }
    })()

    // ------------------------------------------------------------------
    // System-prompt injection
    // ------------------------------------------------------------------

    const sessionHookRegistration = await ctx.session.hook('context', (event) => {
      try {
        const dir = sessionDirs.get(event.sessionID) ?? ctx.location.directory
        for (const text of composeSystemParts(dir, cacheByDir)) {
          event.system.push({ type: 'text', text })
        }
      } catch (err) {
        log('error', 'system-prompt context hook failed', err)
      }
    })

    return async () => {
      controller.abort()
      await toolRegistration?.dispose?.()
      await sessionHookRegistration?.dispose?.()
    }
  },
}
