// src/plugin.v1.js — opencode-openspec plugin, V1 entrypoint (@opencode-ai/plugin)
//
// This module exports ONLY `default` — no named exports. opencode's legacy
// (V1) plugin loader speculatively invokes every named export of a plugin
// module with the same argument it passes to the real factory; a named
// export with a positional, type-assuming parameter throws on that
// mismatched argument and crashes the whole module's load (root-caused and
// fixed in `fix-v2-loader-named-export-crash`, PR #6 — see
// docs/v2-compat-audit.md). Keep it that way — import collaborators from
// `./core.js`/`./lib/helpers.js`, never re-export them.
//
// Thin adapter over src/core.js: wraps the three tools with @opencode-ai/plugin's
// `tool()`/`tool.schema` builder, and supplies V1-shaped capabilities
// ({$, log, confirm, defaultDir}) to core's runtime-agnostic behavior functions.

import { tool } from '@opencode-ai/plugin'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logError } from './lib/helpers.js'
import {
  handleSessionCreated,
  composeSystemParts,
  executeOpenspecCli,
  executeOpenspecStatus,
  executeOpenspecInstructions,
  TOOL_SCHEMAS,
  TOOL_DESCRIPTIONS,
} from './core.js'

/**
 * @param {{ client: object, directory: string, $: Function }} input
 * @returns {Promise<object>} Hooks
 */
async function OpenSpecPlugin({ client, directory, $, existsSync: _existsSync = existsSync }) {
  /** @type {Map<string, {present:boolean, changes:Array<{name:string,done:number,total:number}>, at:number}>} */
  const cacheByDir = new Map()

  const log = (level, message, err) => logError(client, message, err, level)

  // ------------------------------------------------------------------
  // Tools
  // ------------------------------------------------------------------

  const openspecCli = tool({
    description: TOOL_DESCRIPTIONS.openspec_cli,
    args: {
      command: tool.schema.string().describe(TOOL_SCHEMAS.openspec_cli.properties.command.description),
      workdir: tool.schema.string().optional().describe(TOOL_SCHEMAS.openspec_cli.properties.workdir.description),
    },
    async execute(args, context) {
      const resolveCtx = { defaultDir: context.worktree ?? context.directory }
      const caps = {
        $,
        log,
        confirm: (command) =>
          context.ask({
            permission: 'openspec',
            patterns: [command],
            always: [],
            metadata: { command },
          }),
        cacheByDir,
      }
      return executeOpenspecCli(args, resolveCtx, caps)
    },
  })

  const openspecStatus = tool({
    description: TOOL_DESCRIPTIONS.openspec_status,
    args: {
      change: tool.schema.string().describe(TOOL_SCHEMAS.openspec_status.properties.change.description),
      workdir: tool.schema.string().optional().describe(TOOL_SCHEMAS.openspec_status.properties.workdir.description),
    },
    async execute(args, context) {
      const resolveCtx = { defaultDir: context.worktree ?? context.directory }
      return executeOpenspecStatus(args, resolveCtx, { $, log, confirm: null, cacheByDir })
    },
  })

  const openspecInstructions = tool({
    description: TOOL_DESCRIPTIONS.openspec_instructions,
    args: {
      artifact: tool.schema.enum(TOOL_SCHEMAS.openspec_instructions.properties.artifact.enum).describe(
        TOOL_SCHEMAS.openspec_instructions.properties.artifact.description,
      ),
      change: tool.schema.string().describe(TOOL_SCHEMAS.openspec_instructions.properties.change.description),
      workdir: tool.schema.string().optional().describe(TOOL_SCHEMAS.openspec_instructions.properties.workdir.description),
    },
    async execute(args, context) {
      const resolveCtx = { defaultDir: context.worktree ?? context.directory }
      return executeOpenspecInstructions(args, resolveCtx, { $, log, confirm: null, cacheByDir })
    },
  })

  // ------------------------------------------------------------------
  // Event hook
  // ------------------------------------------------------------------

  async function handleEvent({ event }) {
    try {
      if (event.type !== 'session.created') return
      const dir = event.properties?.info?.directory ?? event.properties?.directory ?? directory
      await handleSessionCreated(cacheByDir, $, log, _existsSync, dir, { join })
    } catch (err) {
      log('error', 'event handler failed', err)
    }
  }

  // ------------------------------------------------------------------
  // System-prompt transform (pure — no I/O)
  // ------------------------------------------------------------------

  function systemTransform(_input, output) {
    try {
      for (const part of composeSystemParts(directory, cacheByDir)) {
        output.system.push(part)
      }
    } catch (err) {
      log('error', 'system.transform failed', err)
    }
  }

  return {
    event: handleEvent,
    tool: {
      openspec_cli: openspecCli,
      openspec_status: openspecStatus,
      openspec_instructions: openspecInstructions,
    },
    'experimental.chat.system.transform': systemTransform,
  }
}

export default OpenSpecPlugin
