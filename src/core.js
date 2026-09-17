// src/core.js — opencode-openspec, runtime-agnostic core.
//
// Holds every behavior that does NOT depend on which opencode plugin API
// (V1 or V2) is hosting this plugin: the `openspec` CLI wrapper, the
// injection cache, workdir resolution, the three tools' argument/result
// handling, and system-prompt composition. Neither `@opencode-ai/plugin`
// nor `@opencode/plugin` is ever imported here — every host capability
// (the shell-exec function, logging, and the confirmation mechanism) is
// injected by the calling adapter.
//
// See design.md for the full architecture and the confirmation-gating
// decision (D-1 through D-4, and the dedicated confirmation-gating section).

import { isDestructive, normalizeCommand } from './lib/helpers.js'

export { isDestructive }

// ---------------------------------------------------------------------------
// V2 tool-visibility constant (design.md D-2)
// ---------------------------------------------------------------------------

/**
 * Every V2 custom tool descriptor MUST carry this, or it silently becomes
 * Code-Mode-only (indirect-call-only) instead of directly callable —
 * confirmed empirically against the real host in the opencode-use port.
 * Applied uniformly to all three tools, never re-spelled per call site.
 */
export const V2_TOOL_OPTIONS = Object.freeze({ codemode: false })

const CANONICAL_ORDER = ['proposal', 'design', 'specs', 'tasks']

const TOOLS_NOTICE = `## OpenSpec tools available

This project uses OpenSpec. Use these tools instead of running \`openspec\` CLI commands directly:
- \`openspec_cli\` — run any openspec subcommand (e.g. \`openspec_cli({ command: "list --json" })\`)
- \`openspec_status\` — get structured artifact status for a change in canonical order
- \`openspec_instructions\` — get template, authoring guidance, and output path for an artifact`

// ---------------------------------------------------------------------------
// resolveWorkdir (design.md D-4)
// ---------------------------------------------------------------------------

/**
 * Resolves the working directory for a tool call.
 * Priority: args.workdir (if non-empty) -> the session-scoped directory
 * (looked up via sessionDirs.get(sessionID), if both are provided) -> defaultDir.
 *
 * V1 supplies `defaultDir = context.worktree ?? context.directory` per call
 * and no `sessionDirs`/`sessionID` (preserving exact V1 behavior). V2 has no
 * per-call directory field on `Tool.Context` at all (design.md F5), so it
 * supplies `sessionDirs`/`sessionID` (tracked from the session.created event
 * stream) and `defaultDir = ctx.location.directory` as the final fallback.
 *
 * @param {{ workdir?: string }} args
 * @param {{ defaultDir: string, sessionID?: string, sessionDirs?: Map<string,string> }} resolveCtx
 * @returns {string}
 */
export function resolveWorkdir(args, { defaultDir, sessionID, sessionDirs }) {
  if (args.workdir && args.workdir.length > 0) return args.workdir
  if (sessionID && sessionDirs?.has(sessionID)) return sessionDirs.get(sessionID)
  return defaultDir
}

// ---------------------------------------------------------------------------
// runOpenspec — shared CLI helper
// ---------------------------------------------------------------------------

/**
 * Run `openspec <argsArray>` in cwd via the injected Bun-shell-shaped `$`.
 * Returns { stdout, stderr, exitCode }. A non-zero exit is a normal result.
 * Throws on infrastructure failure (spawn error, openspec not on PATH).
 *
 * @param {Function} $ - Bun shell tagged-template-literal function
 * @param {string} cwd
 * @param {string[]} argsArray
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
 *
 * @param {Map<string, object>} cacheByDir
 * @param {Function} $
 * @param {(level: string, message: string, err?: unknown) => void} log
 * @param {string} dir
 */
export async function populateCache(cacheByDir, $, log, dir) {
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
    log('error', `populateCache failed for ${dir}`, err)
    if (!cacheByDir.has(dir)) {
      cacheByDir.set(dir, { present: true, changes: [], at: Date.now() })
    }
  }
}

/**
 * Handles a session-created event: checks for `openspec/` presence and
 * populates (or marks absent) the cache entry for that directory.
 *
 * @param {Map<string, object>} cacheByDir
 * @param {Function} $
 * @param {(level: string, message: string, err?: unknown) => void} log
 * @param {(path: string) => boolean} existsSyncFn
 * @param {string} dir
 * @param {{ join: (...parts: string[]) => string }} pathLib
 */
export async function handleSessionCreated(cacheByDir, $, log, existsSyncFn, dir, pathLib) {
  if (!dir) return
  const present = existsSyncFn(pathLib.join(dir, 'openspec'))
  if (!present) {
    cacheByDir.set(dir, { present: false, changes: [], at: Date.now() })
    return
  }
  await populateCache(cacheByDir, $, log, dir)
}

// ---------------------------------------------------------------------------
// System-prompt composition (pure — no I/O)
// ---------------------------------------------------------------------------

/**
 * Returns an array of plain-text strings to inject into the system prompt
 * for the given directory's cache state. Each adapter wraps these as its
 * runtime requires (V1 pushes bare strings; V2 wraps each in
 * `{type:'text', text}`, design.md F13).
 *
 * @param {string} dir
 * @param {Map<string, object>} cacheByDir
 * @returns {string[]}
 */
export function composeSystemParts(dir, cacheByDir) {
  const entry = cacheByDir.get(dir)
  if (!entry) {
    return [TOOLS_NOTICE]
  }
  if (!entry.present) {
    return []
  }
  const parts = [TOOLS_NOTICE]
  if (entry.changes.length > 0) {
    const lines = entry.changes
      .map(c => `  - ${c.name} (${c.done}/${c.total} tasks done)`)
      .join('\n')
    parts.push(`## Active OpenSpec changes\n\n${lines}`)
  }
  return parts
}

// ---------------------------------------------------------------------------
// Tool behaviors
// ---------------------------------------------------------------------------

/**
 * @typedef {{ $: Function, log: (level: string, message: string, err?: unknown) => void,
 *   confirm: ((command: string) => Promise<void>) | null, cacheByDir: Map<string, object> }} Caps
 * @typedef {{ defaultDir: string, sessionID?: string, sessionDirs?: Map<string,string> }} ResolveCtx
 */

/**
 * `openspec_cli` behavior. When `caps.confirm` is `null` (no confirmation
 * mechanism reachable on this runtime, e.g. V2 — see design.md's
 * confirmation-gating decision), a destructive verb is refused WITHOUT
 * spawning any subprocess, rather than silently executing unconfirmed.
 *
 * @param {{ command: string, workdir?: string }} args
 * @param {ResolveCtx} resolveCtx
 * @param {Caps} caps
 * @returns {Promise<string>} JSON-stringified result
 */
export async function executeOpenspecCli(args, resolveCtx, caps) {
  const workdir = resolveWorkdir(args, resolveCtx)
  const tokens = normalizeCommand(args.command).trim().split(/\s+/).filter(Boolean)
  const destructive = isDestructive(args.command)

  if (destructive) {
    if (caps.confirm) {
      try {
        await caps.confirm(args.command)
      } catch {
        return JSON.stringify({ cancelled: true })
      }
    } else {
      return JSON.stringify({
        cancelled: true,
        reason: 'confirmation-unavailable',
        hint:
          'Destructive openspec verbs are not available through openspec_cli on this runtime ' +
          '(no confirmation mechanism is reachable from a plugin tool here). Run the command ' +
          'directly with the built-in shell/bash tool instead, which prompts for confirmation.',
      })
    }
  }

  try {
    const result = await runOpenspec(caps.$, workdir, tokens)
    if (destructive && result.exitCode === 0) {
      await populateCache(caps.cacheByDir, caps.$, caps.log, workdir)
    }
    return JSON.stringify(result)
  } catch (err) {
    caps.log('error', 'openspec_cli spawn failed', err)
    return JSON.stringify({ error: err?.message ?? String(err), exitCode: null })
  }
}

/**
 * @param {{ change: string, workdir?: string }} args
 * @param {ResolveCtx} resolveCtx
 * @param {Caps} caps
 * @returns {Promise<string>} JSON-stringified result
 */
export async function executeOpenspecStatus(args, resolveCtx, caps) {
  const workdir = resolveWorkdir(args, resolveCtx)
  try {
    const result = await runOpenspec(caps.$, workdir, ['status', '--change', args.change, '--json'])
    if (result.exitCode !== 0) {
      return JSON.stringify({ error: result.stderr || result.stdout, exitCode: result.exitCode })
    }
    let raw
    try {
      raw = JSON.parse(result.stdout)
    } catch (err) {
      return JSON.stringify({ error: `Failed to parse openspec output: ${err?.message}`, exitCode: null })
    }
    const artifactMap = new Map((raw.artifacts ?? []).map(a => [a.id, a]))
    const order = CANONICAL_ORDER.map(id => ({
      artifact: id,
      status: artifactMap.get(id)?.status ?? 'unknown',
    }))
    return JSON.stringify({ isPlanningComplete: raw.isPlanningComplete ?? false, order, raw })
  } catch (err) {
    caps.log('error', 'openspec_status failed', err)
    return JSON.stringify({ error: err?.message ?? String(err), exitCode: null })
  }
}

/**
 * @param {{ artifact: string, change: string, workdir?: string }} args
 * @param {ResolveCtx} resolveCtx
 * @param {Caps} caps
 * @returns {Promise<string>} JSON-stringified result
 */
export async function executeOpenspecInstructions(args, resolveCtx, caps) {
  const workdir = resolveWorkdir(args, resolveCtx)
  try {
    const result = await runOpenspec(caps.$, workdir, ['instructions', args.artifact, '--change', args.change, '--json'])
    if (result.exitCode !== 0) {
      return JSON.stringify({ error: result.stderr || result.stdout, exitCode: result.exitCode })
    }
    let raw
    try {
      raw = JSON.parse(result.stdout)
    } catch (err) {
      return JSON.stringify({ error: `Failed to parse openspec output: ${err?.message}`, exitCode: null })
    }
    return JSON.stringify({
      template: raw.template ?? '',
      instruction: raw.instruction ?? '',
      resolvedOutputPath: raw.resolvedOutputPath ?? '',
    })
  } catch (err) {
    caps.log('error', 'openspec_instructions failed', err)
    return JSON.stringify({ error: err?.message ?? String(err), exitCode: null })
  }
}

// ---------------------------------------------------------------------------
// Tool argument schemas (design.md: V2 tools are always JSON Schema)
// ---------------------------------------------------------------------------

export const TOOL_SCHEMAS = {
  openspec_cli: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Full openspec subcommand and flags, e.g. "list --json" or "new change my-feature"',
      },
      workdir: {
        type: 'string',
        description: 'Working directory for openspec; defaults to session worktree or directory',
      },
    },
    required: ['command'],
  },
  openspec_status: {
    type: 'object',
    properties: {
      change: { type: 'string', description: 'The change name (e.g. "my-feature")' },
      workdir: { type: 'string', description: 'Working directory for openspec' },
    },
    required: ['change'],
  },
  openspec_instructions: {
    type: 'object',
    properties: {
      artifact: {
        type: 'string',
        enum: ['proposal', 'design', 'specs', 'tasks'],
        description: 'Which artifact to get instructions for',
      },
      change: { type: 'string', description: 'The change name' },
      workdir: { type: 'string', description: 'Working directory for openspec' },
    },
    required: ['artifact', 'change'],
  },
}

export const TOOL_DESCRIPTIONS = {
  openspec_cli:
    'Run any openspec subcommand. Provide the full subcommand and flags as a single string ' +
    '(e.g. "list --json", "validate my-change", "status --change my-change --json"). ' +
    'Returns { stdout, stderr, exitCode }. A non-zero exitCode is a normal result — inspect ' +
    'stderr for details. Destructive verbs (archive, new change) require user confirmation ' +
    'before executing and return { cancelled: true } if denied (or refused with ' +
    '{ cancelled: true, reason: "confirmation-unavailable" } on a runtime with no confirmation mechanism).',
  openspec_status:
    'Get structured artifact status for a change. Returns { isPlanningComplete, order, raw } ' +
    'where order is an array of { artifact, status } in the canonical authoring sequence: ' +
    'proposal → design → specs → tasks. Use isPlanningComplete to determine if the planning ' +
    'phase is complete before starting implementation.',
  openspec_instructions:
    'Get the template, authoring guidance, and resolved output path for a specific artifact. ' +
    'Returns { template, instruction, resolvedOutputPath }. Write the artifact content to ' +
    'resolvedOutputPath when done.',
}
