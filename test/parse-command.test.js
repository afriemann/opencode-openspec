// test/parse-command.test.js
// spec: openspec/changes/full-cli-support/specs/tools/spec.md

import { parseCommand, classifyCommand, isDestructive } from '../src/lib/helpers.js'

describe('parseCommand — openspec_cli parses the command shell-style without expansion', () => {
  it.each([
    ['Quoted argument with spaces reaches the CLI intact',
      `new change "my-feature" --description 'two words'`,
      ['new', 'change', 'my-feature', '--description', 'two words']],
    ['Shell metacharacters are inert', 'list ; rm -rf $HOME', ['list', ';', 'rm', '-rf', '$HOME']],
    ['Leading openspec token is ignored', 'openspec list --json', ['list', '--json']],
    ['adjacent segments concatenate', `--x="a b"c`, ['--x=a bc']],
    ['empty quoted argument is kept', `feedback ''`, ['feedback', '']],
    ['backslash escapes inside double quotes only for quote and backslash', `"a\\"b\\\\c\\n"`, ['a"b\\c\\n']],
    ['backslash escapes outside quotes', 'a\\ b', ['a b']],
    ['zero-width characters are stripped', '\u200Barchive x', ['archive', 'x']],
  ])('%s', (_title, command, argv) => {
    expect(parseCommand(command)).toMatchObject({ ok: true, argv })
  })

  it.each([
    ['Unterminated quote is rejected', 'show "my-change'],
    ['trailing backslash is rejected', 'show x\\'],
    ['empty command is rejected', '   '],
  ])('%s', (_title, command) => {
    expect(parseCommand(command)).toMatchObject({ ok: false, reason: 'parse-error' })
  })

  it('resolves verb and subverb past leading global options', () => {
    expect(parseCommand('--no-color new change x')).toMatchObject({ verb: 'new', subverb: 'change' })
  })

  it('skips the value of config --scope when resolving the subverb', () => {
    expect(parseCommand('config --scope global edit')).toMatchObject({ verb: 'config', subverb: 'edit' })
    expect(parseCommand('config --scope=global edit')).toMatchObject({ verb: 'config', subverb: 'edit' })
  })
})

describe('classifyCommand', () => {
  const cls = (c) => classifyCommand(parseCommand(c))

  it.each([
    ['config edit', 'interactive'],
    ['workset open foo', 'interactive'],
    ['completion install bash', 'out-of-scope-side-effect'],
    ['completion uninstall', 'out-of-scope-side-effect'],
    ['feedback hi', 'out-of-scope-side-effect'],
  ])('blocks %s as %s', (c, reason) => {
    expect(cls(c)).toMatchObject({ blocked: reason })
  })

  it('Help for a blocked command is allowed', () => {
    expect(cls('feedback --help').blocked).toBeFalsy()
    expect(cls('config edit -h').blocked).toBeFalsy()
  })

  it.each([
    'feedback hi --body -h', 'feedback -- -h', 'feedback hi --body --help',
    'new change foo --description -h', 'archive -- --help',
  ])('a help token that is not the whole invocation does not exempt %s', (c) => {
    const r = cls(c)
    expect(Boolean(r.blocked) || r.destructive).toBe(true)
    expect(r.readOnly).toBe(false)
  })

  it.each(['archive --help', 'new change --help', '--no-color feedback -h'])(
    'bare help for %s is read-only and never gated', (c) => {
      const r = cls(c)
      expect(r.readOnly).toBe(true)
      expect(r.destructive).toBe(false)
      expect(r.blocked).toBeFalsy()
    })

  it.each(['archive x --yes', 'new change x', 'store remove s', '--no-color archive x',
    'store unregister s', 'workset remove w', 'config reset', 'config unset k'])(
    'Leading global option does not bypass the gate: %s is destructive', (c) => {
      expect(cls(c).destructive).toBe(true)
      expect(isDestructive(c)).toBe(true)
    })

  it.each(['list --json', 'show x', 'validate', 'status --change archive-x', 'config get k', 'store list',
    'workset ls', 'completion generate bash', '--version', '--help', 'instructions apply --change x', 'change show x'])(
    'treats %s as read-only', (c) => {
      expect(cls(c).readOnly).toBe(true)
    })

  it.each(['init --tools none', 'update', 'archive x', 'new change x', 'config set a b', 'some-future-verb'])(
    'treats %s as mutating', (c) => {
      expect(cls(c).readOnly).toBe(false)
    })

  it('does not classify a parse failure as destructive', () => {
    expect(isDestructive('')).toBe(false)
  })
})
