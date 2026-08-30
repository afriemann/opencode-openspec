// test/helpers.test.js
// spec: openspec/changes/initial-plugin/specs/plugin/spec.md
// spec: openspec/changes/initial-plugin/specs/tools/spec.md
// spec: openspec/changes/fix-cli-tokenizer/specs/tools/spec.md

import { jest } from '@jest/globals'
import { resolveCwd, isDestructive, logError, parseTokens } from '../src/lib/helpers.js'

// ---------------------------------------------------------------------------
// resolveCwd
// Scenario: Tool uses worktree when no explicit cwd provided
// Scenario: Explicit cwd overrides context
// ---------------------------------------------------------------------------

describe('resolveCwd', () => {
  it('returns args.cwd when provided and non-empty', () => {
    const result = resolveCwd({ cwd: '/explicit' }, { worktree: '/tree', directory: '/dir' })
    expect(result).toBe('/explicit')
  })

  it('returns context.worktree when args.cwd is absent', () => {
    const result = resolveCwd({}, { worktree: '/tree', directory: '/dir' })
    expect(result).toBe('/tree')
  })

  it('returns context.worktree when args.cwd is an empty string', () => {
    const result = resolveCwd({ cwd: '' }, { worktree: '/tree', directory: '/dir' })
    expect(result).toBe('/tree')
  })

  it('returns context.directory when worktree is absent', () => {
    const result = resolveCwd({}, { directory: '/dir' })
    expect(result).toBe('/dir')
  })

  it('returns context.directory when worktree is empty string', () => {
    const result = resolveCwd({}, { worktree: '', directory: '/dir' })
    expect(result).toBe('/dir')
  })
})

// ---------------------------------------------------------------------------
// isDestructive
// Scenario: archive command triggers confirmation
// Scenario: User denial returns cancelled result
// Scenario: Read-only command with change name containing archive is not gated
// ---------------------------------------------------------------------------

describe('isDestructive', () => {
  it('returns true for "archive ..."', () => {
    expect(isDestructive('archive my-change --yes')).toBe(true)
  })

  it('returns true for bare "archive"', () => {
    expect(isDestructive('archive')).toBe(true)
  })

  it('returns true for "new change ..."', () => {
    expect(isDestructive('new change my-feature')).toBe(true)
  })

  it('returns false for "list --json"', () => {
    expect(isDestructive('list --json')).toBe(false)
  })

  it('returns false for "status --change archive-foo --json" (change name contains archive)', () => {
    expect(isDestructive('status --change archive-foo --json')).toBe(false)
  })

  it('returns false for "validate my-change"', () => {
    expect(isDestructive('validate my-change')).toBe(false)
  })

  it('returns false for "new" without "change" as second token', () => {
    expect(isDestructive('new something-else')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isDestructive('')).toBe(false)
  })

  it('returns false for "instructions proposal --change archive-cleanup --json"', () => {
    expect(isDestructive('instructions proposal --change archive-cleanup --json')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseTokens
// Scenario: Double-quoted change name reaches openspec without quotes
// Scenario: Single-quoted token is stripped
// Scenario: Unquoted tokens pass through unchanged
// ---------------------------------------------------------------------------

describe('parseTokens', () => {
  it('Unquoted tokens pass through unchanged', () => {
    expect(parseTokens('list --json')).toEqual(['list', '--json'])
  })

  it('Double-quoted change name reaches openspec without quotes', () => {
    expect(parseTokens('new change "my-feature"')).toEqual(['new', 'change', 'my-feature'])
  })

  it('Single-quoted token is stripped', () => {
    expect(parseTokens("validate 'my-change'")).toEqual(['validate', 'my-change'])
  })

  it('treats a quoted string with embedded spaces as one token', () => {
    expect(parseTokens('cmd "hello world"')).toEqual(['cmd', 'hello world'])
  })

  it('resolves backslash escapes outside quotes', () => {
    expect(parseTokens('cmd foo\\ bar')).toEqual(['cmd', 'foo bar'])
  })

  it('returns [] for empty string', () => {
    expect(parseTokens('')).toEqual([])
  })

  it('returns [] for whitespace-only string', () => {
    expect(parseTokens('   ')).toEqual([])
  })

  it('handles adjacent quoted tokens without space between them', () => {
    expect(parseTokens('"foo""bar"')).toEqual(['foobar'])
  })
})

// ---------------------------------------------------------------------------
// logError
// Scenario: Logging falls back to stderr, not console
// ---------------------------------------------------------------------------

describe('logError', () => {
  it('calls client.app.log with the error message', () => {
    const logged = []
    const client = {
      app: {
        log: (opts) => {
          logged.push(opts)
          return Promise.resolve()
        },
      },
    }
    logError(client, 'something went wrong', new Error('oops'))
    expect(logged.length).toBe(1)
    expect(logged[0].body.service).toBe('opencode-openspec')
    expect(logged[0].body.level).toBe('error')
    expect(logged[0].body.message).toContain('something went wrong')
    expect(logged[0].body.message).toContain('oops')
  })

  it('falls back to process.stderr.write when client.app.log throws', () => {
    const stderrWrites = []
    const originalStderr = process.stderr.write.bind(process.stderr)
    process.stderr.write = (msg) => { stderrWrites.push(msg); return true }
    try {
      const client = { app: { log: () => { throw new Error('log failed') } } }
      logError(client, 'test', null)
      expect(stderrWrites.length).toBeGreaterThan(0)
    } finally {
      process.stderr.write = originalStderr
    }
  })

  it('never calls console.*', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const client = { app: { log: () => Promise.resolve() } }
    logError(client, 'msg', null)
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
