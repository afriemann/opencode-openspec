// test/helpers.test.js
// spec: openspec/changes/initial-plugin/specs/plugin/spec.md
// spec: openspec/changes/initial-plugin/specs/tools/spec.md

import { jest } from '@jest/globals'
import { isDestructive, logError } from '../src/lib/helpers.js'

// Note: `resolveWorkdir` is no longer exported from this module. The
// V1-shape `(args, context)` version that used to live here was dead code
// (superseded by `core.js`'s `resolveWorkdir(args, {defaultDir, sessionID,
// sessionDirs})`, which both adapters actually use) — a naming collision
// with an incompatible signature and no live importer. Its precedence
// behavior is exercised via `test/plugin.test.js` (V1, through
// `context.worktree`/`context.directory`) and
// `test/plugin.v2.test.js`'s "resolveWorkdir precedence" suite (V2).

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

  // security review finding: a leading zero-width space survives .trim() and
  // is not matched by \s, so a naive tokenizer would miss "archive" here —
  // confirmed reproducible before the normalizeCommand() fix.
  it('returns true for "archive" preceded by a zero-width space (U+200B)', () => {
    expect(isDestructive('\u200Barchive my-change --yes')).toBe(true)
  })

  it('returns true for "archive" with an embedded left-to-right mark (U+200E)', () => {
    expect(isDestructive('archive\u200E my-change --yes')).toBe(true)
  })

  it('returns true for "new change" with a zero-width joiner between tokens is unaffected (still two tokens)', () => {
    expect(isDestructive('new\u200B change my-feature')).toBe(true)
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
