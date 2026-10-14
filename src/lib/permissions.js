import { resolve } from 'node:path'

const AUDITED_CLI_VERSION = '1.14.1'
const ROOT_FLAGS = ['--no-color', '-h', '--help']
const STORE_VALUES = ['--store', '--store-path']
const SCHEMA_VALUES = ['--schema', ...STORE_VALUES]

function form(min, max, flags = [], values = [], mutates = false) {
  return { min, max, flags: new Set([...ROOT_FLAGS, ...flags]), values: new Set(values), mutates }
}

// CLI 1.14.1 registrations: dist/cli/index.js and commands/{config,schema,store,workset}.js.
// Unknown options are refused even on read-only verbs: future options may write state.
const FORMS = new Map(Object.entries({
  init: form(0, 1, ['--force', '--no-animation', '--copilot-cloud', '--no-copilot-cloud'], ['--tools', '--language', '--profile'], true),
  update: form(0, 1, ['--force'], [], true),
  'new change': form(1, 1, ['--json'], ['--description', '--goal', ...SCHEMA_VALUES, '--initiative', '--areas'], true),
  archive: form(0, 1, ['-y', '--yes', '--skip-specs', '--no-validate', '--json'], STORE_VALUES, true),
  'store setup': form(0, 1, ['--init-git', '--no-init-git', '--json'], ['--path', '--remote'], true),
  'store register': form(0, 1, ['--yes', '--json'], ['--id'], true),
  'store unregister': form(1, 1, ['--json'], [], true),
  'store remove': form(1, 1, ['--yes', '--json'], [], true),
  'workset create': form(0, 1, ['--json'], ['--member', '--tool'], true),
  'workset remove': form(1, 1, ['--yes', '--json'], [], true),
  'config set': form(2, 2, ['--string', '--allow-unknown'], [], true),
  'config unset': form(1, 1, [], [], true),
  'config reset': form(0, 0, ['--all', '-y', '--yes'], [], true),
  'config profile': form(0, 1, [], [], true),
  'schema fork': form(1, 2, ['--json', '--force'], [], true),
  'schema init': form(1, 1, ['--json', '--default', '--no-default', '--force'], ['--description', '--artifacts'], true),
  version: form(0, 0, ['--json', '--check']),
  list: form(0, 0, ['--specs', '--changes', '--archived', '--all', '--json'], ['--sort', ...STORE_VALUES]),
  view: form(0, 0, [], STORE_VALUES),
  'change show': form(0, 1, ['--json', '--deltas-only', '--requirements-only', '--diff', '--no-interactive']),
  'change list': form(0, 0, ['--json', '--long']),
  'change validate': form(0, 1, ['--strict', '--json', '--no-interactive']),
  validate: form(0, 1, ['--all', '--changes', '--specs', '--archived', '--strict', '--json', '--no-interactive'], ['--report', '--type', '--concurrency', ...STORE_VALUES]),
  show: form(0, 1, ['--json', '--no-interactive', '--deltas-only', '--requirements-only', '--diff', '--requirements', '--no-scenarios'], ['--type', '-r', '--requirement', ...STORE_VALUES]),
  'completion generate': form(0, 1),
  status: form(0, 0, ['--all', '--json'], ['--change', ...SCHEMA_VALUES]),
  instructions: form(0, 1, ['--json'], ['--change', ...SCHEMA_VALUES]),
  templates: form(0, 0, ['--json'], ['--schema']),
  schemas: form(0, 0, ['--json'], STORE_VALUES),
  'config path': form(0, 0),
  'config list': form(0, 0, ['--json']),
  'config get': form(1, 1),
  'schema which': form(0, 1, ['--json', '--all']),
  'schema validate': form(0, 1, ['--json', '--verbose']),
  'store list': form(0, 0, ['--json']),
  'store doctor': form(0, 1, ['--json']),
  'workset list': form(0, 0, ['--json']),
}))
const GROUPS = new Set(['new', 'change', 'config', 'schema', 'store', 'workset', 'completion'])
const ROOT_COMMANDS = new Set([...FORMS.keys()].map(operation => operation.split(' ')[0]))
const HELP_PATHS = [
  '', ...GROUPS, ...FORMS.keys(), 'store ls', 'workset ls',
  'feedback', 'config edit', 'workset open', 'completion install', 'completion uninstall',
].map(operation => operation ? operation.split(' ') : [])

function bareHelp(argv) {
  const tokens = argv.filter(token => token !== '--no-color')
  const firstHelp = tokens.findIndex(token => token === '-h' || token === '--help')
  return firstHelp !== -1 && HELP_PATHS.some(path => path.length === firstHelp && path.every((part, index) => part === tokens[index])) &&
    tokens.slice(firstHelp).every(token => token === '-h' || token === '--help')
}

function unaudited(error) {
  return { ok: false, refusal: {
    cancelled: true, reason: 'unaudited-command', error,
    hint: `V2 supports the audited OpenSpec ${AUDITED_CLI_VERSION} grammar. Use separate option/value tokens; new CLI forms require re-auditing.`,
  } }
}

export function permissionUnavailable(error) {
  return {
    cancelled: true, reason: 'permission-unavailable', error,
    hint: 'V2 mutations require OpenCode >=2.0.29 with callable permission.assert and an actual session ID; read-only tools remain available.',
  }
}

/** Bind classification and authorization to the same owned snapshot used for execution. */
export function createPermissionIntent(parsed, workdir) {
  const argv = Object.freeze([...parsed.argv])
  const absoluteWorkdir = resolve(workdir)
  const intent = (operation, readOnly) => Object.freeze({
    ok: true, operation, readOnly, action: readOnly ? null : `openspec.${operation.replaceAll(' ', '.')}`,
    workdir: absoluteWorkdir, argv, resource: JSON.stringify([absoluteWorkdir, ...argv]),
  })
  if (bareHelp(argv)) return intent('help', true)

  let index = 0
  while (argv[index] === '--no-color') index++
  const verb = argv[index++]
  if (!ROOT_COMMANDS.has(verb)) return unaudited(`Unaudited command: ${verb ?? '(missing)'}`)
  let operation = verb
  if (GROUPS.has(verb)) {
    while (argv[index]?.startsWith('-')) {
      if (argv[index] === '--no-color' || (verb === 'workset' && argv[index] === '--json')) index++
      else if (verb === 'config' && argv[index] === '--scope' && argv[index + 1] === 'global') index += 2
      else return unaudited(`Unaudited parent option: ${argv[index]}`)
    }
    let subverb = argv[index++]
    if ((verb === 'store' || verb === 'workset') && subverb === 'ls') subverb = 'list'
    operation = `${verb} ${subverb}`
  }
  const rule = FORMS.get(operation)
  if (!rule) return unaudited(`Unaudited command: ${operation ?? '(missing)'}`)

  let operands = 0
  for (; index < argv.length; index++) {
    const token = argv[index]
    if (verb === 'config' && token === '--scope') {
      if (argv[++index] !== 'global') return unaudited('Only --scope global is audited')
    } else if (rule.flags.has(token)) {
      continue
    } else if (rule.values.has(token)) {
      if (++index >= argv.length) return unaudited(`Missing value for ${token}`)
    } else if (token.startsWith('-')) {
      return unaudited(`Unaudited option or syntax: ${token}`)
    } else {
      operands++
    }
  }
  if (operands < rule.min || operands > rule.max) return unaudited(`Invalid operand count for ${operation}`)
  return intent(operation, !rule.mutates)
}
