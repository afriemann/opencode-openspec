// src/lib/helpers.js
// Pure helpers with no external dependencies.

const SERVICE = 'opencode-openspec'

/**
 * Strips zero-width and other invisible Unicode formatting characters that
 * would otherwise survive `.trim()` and `\s`-based whitespace splitting,
 * letting a destructive command string (e.g. a leading U+200B zero-width
 * space) evade `isDestructive`'s leading-token check while still reaching
 * the real `openspec` binary as the first argument. Used identically by
 * both `isDestructive` (the check) and the tokenizer that builds the argv
 * actually passed to the CLI (`core.js`'s `executeOpenspecCli`), so the two
 * views of the command can never disagree.
 *
 * @param {string} command
 * @returns {string}
 */
export function normalizeCommand(command) {
  return command.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
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
  const tokens = normalizeCommand(command).trim().split(/\s+/).filter(Boolean)
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
