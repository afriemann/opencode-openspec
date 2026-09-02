// src/index.js — opencode-openspec plugin
// Wraps the OpenSpec CLI as three agent tools and injects active-change context
// into the system prompt on every LLM call.

import { tool } from '@opencode-ai/plugin'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveWorkdir, isDestructive, logError } from './lib/helpers.js'

export { resolveWorkdir, isDestructive, logError } from './lib/helpers.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANONICAL_ORDER = ['proposal', 'design', 'specs', 'tasks']

const TOOLS_NOTICE = `## OpenSpec tools available

This project uses OpenSpec. Use these tools instead of running \`openspec\` CLI commands directly:
- \`openspec_cli\` — run any openspec subcommand (e.g. \`openspec_cli({ command: "list --json" })\`)
- \`openspec_status\` — get structured artifact status for a change in canonical order
- \`openspec_instructions\` — get template, authoring guidance, and output path for an artifact`

// ---------------------------------------------------------------------------
// runOpenspec — shared CLI helper
// ---------------------------------------------------------------------------

/**
 * Run `openspec <argsArray>` in cwd.
 * Returns { stdout, stderr, exitCode }. A non-zero exit is a normal result, not an error.
 * Throws on infrastructure failure (spawn error, openspec not on PATH).
 *
 * @param {Function} $ - Bun shell tagged-template-literal function
 * @param {string} cwd
 * @param {string[]} argsArray
 * @returns {Promise<{stdout:string, stderr:string, exitCode:number}>}
 */
export async function runOpenspec($, cwd, argsArray) {
  const proc = await $`openspec ${argsArray}`.cwd(cwd).quiet().nothrow()
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Populate (or refresh) the injection cache entry for a project directory.
 * Runs `openspec list --json` and stores parsed changes.
 *
 * @param {Map<string, object>} cacheByDir
 * @param {Function} $
 * @param {object} client
 * @param {string} dir
 */
export async function populateCache(cacheByDir, $, client, dir) {
  try {
    const proc = await $`openspec list --json`.cwd(dir).quiet().nothrow()
    let changes = []
    try {
      const parsed = JSON.parse(proc.stdout.toString())
      changes = (parsed.changes ?? []).map(c => ({
        name: c.name,
        done: c.completedTasks ?? 0,
        total: c.totalTasks ?? 0,
      }))
    } catch {
      // JSON parse failure — leave changes empty, cache still marked present
    }
    cacheByDir.set(dir, { present: true, changes, at: Date.now() })
  } catch (err) {
    logError(client, `populateCache failed for ${dir}`, err)
    if (!cacheByDir.has(dir)) {
      cacheByDir.set(dir, { present: true, changes: [], at: Date.now() })
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * @param {{ client: object, directory: string, $: Function }} input
 * @returns {Promise<object>} Hooks
 */
export async function OpenSpecPlugin({ client, directory, $, existsSync: _existsSync = existsSync }) {
  /** @type {Map<string, {present:boolean, changes:Array<{name:string,done:number,total:number}>, at:number}>} */
  const cacheByDir = new Map()

  // ------------------------------------------------------------------
  // Tool: openspec_cli
  // ------------------------------------------------------------------

  const openspecCli = tool({
    description:
      'Run any openspec subcommand. Provide the full subcommand and flags as a single string ' +
      '(e.g. "list --json", "validate my-change", "status --change my-change --json"). ' +
      'Returns { stdout, stderr, exitCode }. A non-zero exitCode is a normal result — inspect ' +
      'stderr for details. Destructive verbs (archive, new change) require user confirmation ' +
      'before executing and return { cancelled: true } if denied.',
    args: {
      command: tool.schema
        .string()
        .describe(
          'Full openspec subcommand and flags, e.g. "list --json" or "new change my-feature"',
        ),
      workdir: tool.schema
        .string()
        .optional()
        .describe('Working directory for openspec; defaults to session worktree or directory'),
    },
    async execute(args, context) {
      const workdir = resolveWorkdir(args, context)
      const tokens = args.command.trim().split(/\s+/).filter(Boolean)

      if (isDestructive(args.command)) {
        try {
          await context.ask({
            permission: 'openspec',
            patterns: [args.command],
            always: [],
            metadata: { command: args.command },
          })
        } catch {
          return JSON.stringify({ cancelled: true })
        }
      }

      try {
        const result = await runOpenspec($, workdir, tokens)
        // Refresh cache after a successful mutation
        if (isDestructive(args.command) && result.exitCode === 0) {
          await populateCache(cacheByDir, $, client, workdir)
        }
        return JSON.stringify(result)
      } catch (err) {
        logError(client, 'openspec_cli spawn failed', err)
        return JSON.stringify({ error: err?.message ?? String(err), exitCode: null })
      }
    },
  })

  // ------------------------------------------------------------------
  // Tool: openspec_status
  // ------------------------------------------------------------------

  const openspecStatus = tool({
    description:
      'Get structured artifact status for a change. Returns { isPlanningComplete, order, raw } ' +
      'where order is an array of { artifact, status } in the canonical authoring sequence: ' +
      'proposal → design → specs → tasks. Use isPlanningComplete to determine if the planning ' +
      'phase is complete before starting implementation.',
    args: {
      change: tool.schema.string().describe('The change name (e.g. "my-feature")'),
      workdir: tool.schema.string().optional().describe('Working directory for openspec'),
    },
    async execute(args, context) {
      const workdir = resolveWorkdir(args, context)
      try {
        const result = await runOpenspec($, workdir, [
          'status',
          '--change',
          args.change,
          '--json',
        ])
        if (result.exitCode !== 0) {
          return JSON.stringify({ error: result.stderr || result.stdout, exitCode: result.exitCode })
        }
        let raw
        try {
          raw = JSON.parse(result.stdout)
        } catch (err) {
          return JSON.stringify({
            error: `Failed to parse openspec output: ${err?.message}`,
            exitCode: null,
          })
        }
        const artifactMap = new Map((raw.artifacts ?? []).map(a => [a.id, a]))
        const order = CANONICAL_ORDER.map(id => ({
          artifact: id,
          status: artifactMap.get(id)?.status ?? 'unknown',
        }))
        return JSON.stringify({ isPlanningComplete: raw.isPlanningComplete ?? false, order, raw })
      } catch (err) {
        logError(client, 'openspec_status failed', err)
        return JSON.stringify({ error: err?.message ?? String(err), exitCode: null })
      }
    },
  })

  // ------------------------------------------------------------------
  // Tool: openspec_instructions
  // ------------------------------------------------------------------

  const openspecInstructions = tool({
    description:
      'Get the template, authoring guidance, and resolved output path for a specific artifact. ' +
      'Returns { template, instruction, resolvedOutputPath }. Write the artifact content to ' +
      'resolvedOutputPath when done.',
    args: {
      artifact: tool.schema
        .enum(['proposal', 'design', 'specs', 'tasks'])
        .describe('Which artifact to get instructions for'),
      change: tool.schema.string().describe('The change name'),
      workdir: tool.schema.string().optional().describe('Working directory for openspec'),
    },
    async execute(args, context) {
      const workdir = resolveWorkdir(args, context)
      try {
        const result = await runOpenspec($, workdir, [
          'instructions',
          args.artifact,
          '--change',
          args.change,
          '--json',
        ])
        if (result.exitCode !== 0) {
          return JSON.stringify({ error: result.stderr || result.stdout, exitCode: result.exitCode })
        }
        let raw
        try {
          raw = JSON.parse(result.stdout)
        } catch (err) {
          return JSON.stringify({
            error: `Failed to parse openspec output: ${err?.message}`,
            exitCode: null,
          })
        }
        return JSON.stringify({
          template: raw.template ?? '',
          instruction: raw.instruction ?? '',
          resolvedOutputPath: raw.resolvedOutputPath ?? '',
        })
      } catch (err) {
        logError(client, 'openspec_instructions failed', err)
        return JSON.stringify({ error: err?.message ?? String(err), exitCode: null })
      }
    },
  })

  // ------------------------------------------------------------------
  // Event hook
  // ------------------------------------------------------------------

  async function handleEvent({ event }) {
    try {
      if (event.type !== 'session.created') return
      const dir =
        event.properties?.info?.directory ?? event.properties?.directory ?? directory
      if (!dir) return

      const present = _existsSync(join(dir, 'openspec'))
      if (!present) {
        cacheByDir.set(dir, { present: false, changes: [], at: Date.now() })
        return
      }
      await populateCache(cacheByDir, $, client, dir)
    } catch (err) {
      logError(client, 'event handler failed', err)
    }
  }

  // ------------------------------------------------------------------
  // System-prompt transform (pure — no I/O)
  // ------------------------------------------------------------------

  function systemTransform(_input, output) {
    try {
      const entry = cacheByDir.get(directory)
      if (!entry) {
        // Cache miss — inject static notice only
        output.system.push(TOOLS_NOTICE)
        return
      }
      if (!entry.present) return

      output.system.push(TOOLS_NOTICE)

      if (entry.changes.length > 0) {
        const lines = entry.changes
          .map(c => `  - ${c.name} (${c.done}/${c.total} tasks done)`)
          .join('\n')
        output.system.push(`## Active OpenSpec changes\n\n${lines}`)
      }
    } catch (err) {
      logError(client, 'system.transform failed', err)
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
