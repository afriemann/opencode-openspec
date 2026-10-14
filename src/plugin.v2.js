// src/plugin.v2.js — opencode-openspec plugin, V2 entrypoint (@opencode/plugin)
//
// Thin adapter over src/core.js, mapping the same tool/event/system-prompt
// logic onto opencode's real V2 plugin SDK. Deliberately does NOT import
// `@opencode/plugin` at runtime (matching the established pattern from
// opencode-use/opencode-auto-instruct/opencode-redact/opencode-notify):
// `Plugin.define` is a verified identity function, and the package is an
// optional peer dependency.
//
// Mutation authorization uses the setup context's permission domain and the
// actual Tool.Context identity. Missing capability refuses mutations; native
// rejections propagate unchanged so the host can end a declined step.
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
import { createExec } from './lib/exec.js'
import { permissionUnavailable } from './lib/permissions.js'
import { join } from 'node:path'

const PLUGIN_NAME = 'opencode-openspec'
const TOOL_NAMES = ['openspec_cli', 'openspec_status', 'openspec_instructions']

// A hung cache probe must not stall plugin or host startup.
const EAGER_CACHE_TIMEOUT_MS = 5000

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0

async function authorizeMutation(ctx, intent, callingContext) {
  const permission = ctx.permission
  if (typeof permission?.assert !== 'function') {
    return permissionUnavailable('Native permission.assert is unavailable or not callable')
  }
  if (!isNonEmptyString(callingContext.sessionID)) {
    return permissionUnavailable('Actual calling session identity is missing or invalid')
  }
  const input = {
    sessionID: callingContext.sessionID,
    action: intent.action,
    resources: [intent.resource],
    metadata: { operation: intent.operation, workdir: intent.workdir, argv: [...intent.argv] },
  }
  if (isNonEmptyString(callingContext.agent)) input.agent = callingContext.agent
  if (isNonEmptyString(callingContext.messageID) && isNonEmptyString(callingContext.id)) {
    input.source = { type: 'tool', messageID: callingContext.messageID, id: callingContext.id }
  }
  // No save patterns: this call must not manufacture reusable wildcard grants.
  await permission.assert(input)
}

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
  async setup(ctx, { exec = createExec() } = {}) {
    const log = makeLog()

    /** @type {Map<string, object>} */
    const cacheByDir = new Map()
    /** @type {Map<string, string>} sessionID -> directory */
    const sessionDirs = new Map()

    const caps = {
      exec, log, confirm: null, cacheByDir, runtime: 'v2',
      authorize: (intent, callingContext) => authorizeMutation(ctx, intent, callingContext),
    }

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
          const resolveCtx = {
            defaultDir: ctx.location.directory, sessionDirs,
            sessionID: toolCtx?.sessionID, agent: toolCtx?.agent, messageID: toolCtx?.messageID, id: toolCtx?.id,
          }
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
    // Eager cache population
    // ------------------------------------------------------------------
    //
    // Single-shot runs may not emit session.created. The stable load-time
    // directory allows a bounded probe without waiting for that event;
    // the executor kills a timed-out probe rather than leaving it running.
    await handleSessionCreated(
      cacheByDir, exec, log, existsSync, ctx.location.directory, { join }, EAGER_CACHE_TIMEOUT_MS,
    )

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
            await handleSessionCreated(cacheByDir, exec, log, existsSync, dir, { join })
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
