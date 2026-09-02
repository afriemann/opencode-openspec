// src/lib/helpers.js
// Pure helpers with no external dependencies.

const SERVICE = 'opencode-openspec'

/**
 * Resolve the working directory for a tool call.
 * Priority: args.workdir (if non-empty) → context.worktree → context.directory
 *
 * @param {{ workdir?: string }} args
 * @param {{ worktree?: string, directory?: string }} context
 * @returns {string}
 */
export function resolveWorkdir(args, context) {
  if (args.workdir && args.workdir.length > 0) return args.workdir
  if (context.worktree) return context.worktree
  return context.directory
}

/**
 * Detect destructive openspec verbs by leading-token match.
 * Destructive: "archive ..." or "new change ..."
 * Leading-token (not substring) so "status --change archive-x" is not gated.
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isDestructive(command) {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return false
  if (tokens[0] === 'archive') return true
  if (tokens[0] === 'new' && tokens[1] === 'change') return true
  return false
}

/**
 * Log an error via client.app.log, falling back to process.stderr.write.
 * Never throws. Never calls console.*.
 *
 * @param {{ app: { log: (opts: object) => Promise<unknown> } }} client
 * @param {string} message
 * @param {unknown} [err]
 * @param {'error'|'warn'|'info'} [level]
 */
export function logError(client, message, err, level = 'error') {
  const detail = err
    ? `: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    : ''
  const msg = `[${SERVICE}] ${message}${detail}`
  try {
    const p = client.app.log({ body: { service: SERVICE, level, message: msg } })
    p?.catch?.(() => process.stderr.write(msg + '\n'))
  } catch {
    process.stderr.write(msg + '\n')
  }
}
