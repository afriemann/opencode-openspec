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

const PARSE_ERROR = 'parse-error'

/** Options that take a separate value and sit between a group verb and its subverb. */
const VALUE_OPTIONS = new Set(['--scope'])

/**
 * POSIX-like lexer: single quotes are literal; inside double quotes a
 * backslash escapes only `"` and `\`; outside quotes a backslash escapes the
 * next character; adjacent segments concatenate. No expansion of any kind.
 *
 * @param {string} input
 * @returns {string[] | null} null on an unterminated quote or trailing backslash
 */
function lex(input) {
  const args = []
  let cur = ''
  let inArg = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === "'") {
      const end = input.indexOf("'", i + 1)
      if (end === -1) return null
      cur += input.slice(i + 1, end)
      i = end
      inArg = true
    } else if (ch === '"') {
      inArg = true
      i++
      for (;;) {
        if (i >= input.length) return null
        const c = input[i]
        if (c === '"') break
        if (c === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) i++
        cur += input[i]
        i++
      }
    } else if (ch === '\\') {
      if (i + 1 >= input.length) return null
      cur += input[++i]
      inArg = true
    } else if (/\s/.test(ch)) {
      if (inArg) args.push(cur)
      cur = ''
      inArg = false
    } else {
      cur += ch
      inArg = true
    }
  }
  if (inArg) args.push(cur)
  return args
}

/**
 * Tokenize and resolve an `openspec_cli` command string. The result is the
 * single source of truth for the argv, the destructive/blocked/read-only
 * classification, so they can never disagree.
 *
 * @param {string} command
 * @returns {{ ok: true, argv: string[], verb?: string, subverb?: string } |
 *           { ok: false, reason: 'parse-error', error: string }}
 */
export function parseCommand(command) {
  const argv = lex(normalizeCommand(command))
  if (argv === null) {
    return { ok: false, reason: PARSE_ERROR, error: 'Unterminated quote or trailing backslash in command' }
  }
  if (argv[0] === 'openspec') argv.shift()
  if (!argv.length) return { ok: false, reason: PARSE_ERROR, error: 'Empty command' }

  let verb
  let subverb
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('-')) {
      if (verb && VALUE_OPTIONS.has(t)) i++
      continue
    }
    if (verb === undefined) verb = t
    else {
      subverb = t
      break
    }
  }
  return { ok: true, argv, verb, subverb }
}

const BLOCKED = new Map([
  ['config edit', 'interactive'],
  ['workset open', 'interactive'],
  ['completion install', 'out-of-scope-side-effect'],
  ['completion uninstall', 'out-of-scope-side-effect'],
  ['feedback', 'out-of-scope-side-effect'],
])

const DESTRUCTIVE = new Set([
  'archive', 'new change', 'store remove', 'store unregister', 'workset remove', 'config reset', 'config unset',
])

const HELP_FLAGS = new Set(['-h', '--help'])

/**
 * True only for a bare help request (`<verb> [<subverb>] --help`). A help flag
 * elsewhere may be an option value (`feedback hi --body -h`) or an operand
 * after `--`, so it must not exempt a command from the blocklist or gate.
 */
function isBareHelp({ argv, verb, subverb }) {
  const rest = [...argv]
  for (const word of [verb, subverb]) {
    const i = word === undefined ? -1 : rest.indexOf(word)
    if (i !== -1) rest.splice(i, 1)
  }
  const flags = rest.filter((t) => t !== '--no-color')
  return flags.length > 0 && flags.every((t) => HELP_FLAGS.has(t))
}

const READ_ONLY_VERBS = new Set([
  'version', 'help', 'list', 'view', 'show', 'validate', 'status', 'instructions',
  'templates', 'schemas', 'context', 'doctor',
])
const READ_ONLY_SUBVERBS = new Set([
  'change show', 'change list', 'change validate',
  'spec show', 'spec list', 'spec validate',
  'config path', 'config list', 'config get',
  'schema which', 'schema validate',
  'store list', 'store ls', 'store doctor',
  'workset list', 'workset ls',
  'completion generate',
])

/**
 * @param {ReturnType<typeof parseCommand>} parsed
 * @returns {{ blocked?: string, destructive: boolean, readOnly: boolean }}
 */
export function classifyCommand(parsed) {
  if (!parsed.ok) return { destructive: false, readOnly: false }
  const { verb, subverb } = parsed
  const key = subverb ? `${verb} ${subverb}` : verb
  const wantsHelp = isBareHelp(parsed)
  const blocked = wantsHelp ? undefined : (BLOCKED.get(key) ?? BLOCKED.get(verb))
  const readOnly = wantsHelp || verb === undefined || READ_ONLY_VERBS.has(verb) || READ_ONLY_SUBVERBS.has(key)
  return { blocked, destructive: !wantsHelp && (DESTRUCTIVE.has(verb) || DESTRUCTIVE.has(key)), readOnly }
}

/**
 * @param {string} command
 * @returns {boolean}
 */
export function isDestructive(command) {
  return classifyCommand(parseCommand(command)).destructive
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
