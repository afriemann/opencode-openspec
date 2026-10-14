// spec: openspec/changes/v2-permission-assert/specs/tools/spec.md
import { jest } from '@jest/globals'
import { resolve } from 'node:path'
import { executeOpenspecCli } from '../src/core.js'
import { parseCommand } from '../src/lib/helpers.js'
import { createMockExec } from './support/mock-exec.js'

function setup() {
  const exec = createMockExec()
  const authorize = jest.fn().mockResolvedValue(undefined)
  const caps = { runtime: 'v2', authorize, exec, log: jest.fn(), confirm: null, cacheByDir: new Map() }
  const run = async (command, workdir = '/repo') => JSON.parse(await executeOpenspecCli(
    { command, workdir }, { defaultDir: '/fallback', sessionID: 's1' }, caps,
  ))
  return { exec, authorize, run }
}

// Transcribed from CLI 1.14.1 registrations, independently of the implementation table.
const mutations = [
  ['init', 'init path --tools none --language en --force --profile core --no-animation --copilot-cloud --no-copilot-cloud'],
  ['update', 'update path --force'],
  ['new.change', 'new change x --description text --goal goal --schema custom --json --store id --store-path path --initiative i --areas a'],
  ['archive', 'archive x -y --yes --skip-specs --no-validate --json --store id --store-path path'],
  ['store.setup', 'store setup id --path path --init-git --no-init-git --remote url --json'],
  ['store.register', 'store register path --id id --yes --json'],
  ['store.unregister', 'store unregister id --json'],
  ['store.remove', 'store remove id --yes --json'],
  ['workset.create', 'workset --json create name --member one --member two --tool code --json'],
  ['workset.remove', 'workset remove name --yes --json'],
  ['config.set', 'config --scope global set key value --string --allow-unknown'],
  ['config.unset', 'config unset key'],
  ['config.reset', 'config reset --all -y --yes'],
  ['config.profile', 'config profile core'],
  ['schema.fork', 'schema fork source name --json --force'],
  ['schema.init', 'schema init name --json --description text --artifacts proposal --default --no-default --force'],
]
const reads = [
  'version --json --check',
  'list --specs --changes --archived --all --sort name --json --store id --store-path path',
  'view --store id --store-path path',
  'change show name --json --deltas-only --requirements-only --diff --no-interactive',
  'change list --json --long', 'change validate name --strict --json --no-interactive',
  'validate name --all --changes --specs --archived --report findings --type change --strict --json --concurrency 2 --no-interactive --store id --store-path path',
  'show name --json --type change --no-interactive --deltas-only --requirements-only --diff --requirements --no-scenarios -r id --requirement id --store id --store-path path',
  'completion generate bash',
  'status --change id --all --schema custom --json --store id --store-path path',
  'instructions proposal --change id --schema custom --json --store id --store-path path',
  'templates --schema custom --json', 'schemas --json --store id --store-path path',
  'config --scope global path', 'config list --json', 'config get key',
  'schema which name --json --all', 'schema validate name --json --verbose',
  'store list --json', 'store ls --json', 'store doctor id --json',
  'workset list --json', 'workset --json ls',
]

describe('V2 audited invocation intent', () => {
  it.each([...reads, ...mutations.map(([, command]) => command)])('Audited commands and options are accepted: %s', async (command) => {
    const { run, exec, authorize } = setup()
    expect(await run(`--no-color ${command}`)).not.toHaveProperty('cancelled')
    expect(exec.records[0].argv).toEqual(parseCommand(`--no-color ${command}`).argv)
    if (reads.includes(command)) expect(authorize).not.toHaveBeenCalled()
  })

  it.each(mutations)('Each mutation uses its canonical action: %s', async (operation, command) => {
    const { run, authorize } = setup()
    await run(`--no-color ${command}`)
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(authorize.mock.calls[0][0]).toMatchObject({ operation: operation.replaceAll('.', ' '), action: `openspec.${operation}`, readOnly: false })
  })

  it.each(['future', 'store future id', 'list --write file', 'show x --future', 'experimental', '__complete change', 'context', 'doctor', 'spec show x', '"new change" --help', '"config edit" -h', '"store list" --json', '"config get" key'])('Unknown commands and flags fail closed: %s', async (command) => {
    const { run, exec, authorize } = setup()
    expect(await run(command)).toMatchObject({ cancelled: true, reason: 'unaudited-command', error: expect.any(String), hint: expect.stringContaining('1.14.1') })
    expect(exec.records).toHaveLength(0)
    expect(authorize).not.toHaveBeenCalled()
  })

  it.each(['new change', 'new change a b', 'status extra', 'store remove', 'config set key', 'config get key extra', 'schema fork', 'list --sort', 'new change x --description', 'status --change=x', 'archive x -yh', 'archive -- --yes', 'config --scope project list', 'config --scope', '--bad list'])('Unsupported option syntax and malformed arity fail closed: %s', async (command) => {
    const { run, exec, authorize } = setup()
    expect(await run(command)).toMatchObject({ reason: 'unaudited-command', cancelled: true })
    expect(exec.records).toHaveLength(0)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('Option values and help tokens do not change command intent', async () => {
    const { run, authorize, exec } = setup()
    for (const value of ['archive', '-h', 'x=y']) {
      await run(`new change x --description '${value}'`)
      expect(authorize).toHaveBeenCalled()
      expect(authorize.mock.lastCall[0].action).toBe('openspec.new.change')
      expect(exec.records.at(-2).argv.at(-1)).toBe(value)
    }
    expect(await run('store --help remove')).toMatchObject({ reason: 'unaudited-command' })
    for (const command of ['--help', 'new change --help', 'feedback --help', 'config edit -h']) {
      const count = authorize.mock.calls.length
      await run(command)
      expect(authorize).toHaveBeenCalledTimes(count)
    }
  })

  it('Lexical workdir and argument boundaries are preserved', async () => {
    const { run, authorize, exec } = setup()
    const command = String.raw`new change 'quoted * name' --description 'semi; $HOME "quote" \\ tail'`
    for (const workdir of ['relative/../symlink', '/repo-link/sub/..']) {
      await run(command, workdir)
      expect(authorize).toHaveBeenCalled()
      const intent = authorize.mock.lastCall[0]
      const actual = exec.records.at(-2)
      expect(intent.workdir).toBe(resolve(workdir))
      expect(intent.resource).toBe(JSON.stringify([actual.cwd, ...actual.argv]))
      expect(actual.argv).toEqual(parseCommand(command).argv)
    }
  })
})
