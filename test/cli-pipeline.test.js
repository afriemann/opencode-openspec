// test/cli-pipeline.test.js
// spec: openspec/specs/tools/spec.md

import { jest } from '@jest/globals'
import { executeOpenspecCli, executeOpenspecStatus, executeOpenspecInstructions } from '../src/core.js'
import { createMockExec } from './support/mock-exec.js'

const resolveCtx = { defaultDir: '/project' }

function setup({ response, confirm = null, runtime = 'v2', authorize = jest.fn().mockResolvedValue(undefined), context = resolveCtx } = {}) {
  const exec = createMockExec(response)
  const cacheByDir = new Map()
  const log = jest.fn()
  const run = async (args) => JSON.parse(await executeOpenspecCli(args, context, { exec, log, confirm, cacheByDir, runtime, authorize }))
  return { exec, run, cacheByDir, log, authorize }
}

const LIST = (names) => JSON.stringify({ changes: names.map((name) => ({ name, completedTasks: 0, totalTasks: 1 })) })

describe('openspec_cli pipeline', () => {
  describe('parsing', () => {
    it('Quoted argument with spaces reaches the CLI intact', async () => {
      const { exec, run } = setup()
      await run({ command: `new change "my-feature" --description 'two words'` })
      expect(exec.records[0].argv).toEqual(['new', 'change', 'my-feature', '--description', 'two words'])
    })

    it('Unterminated quote is rejected', async () => {
      const { exec, run } = setup()
      expect(await run({ command: 'show "my-change' })).toMatchObject({ reason: 'parse-error', exitCode: null })
      expect(exec.records).toHaveLength(0)
    })
  })

  describe('blocklist', () => {
    it('Editor-launching command fails fast', async () => {
      const { exec, run } = setup()
      expect(await run({ command: 'config edit' })).toMatchObject({ cancelled: true, reason: 'interactive' })
      expect(exec.records).toHaveLength(0)
    })

    it('Out-of-project side effect is refused', async () => {
      const { exec, run } = setup()
      const r = await run({ command: 'completion install bash' })
      expect(r).toMatchObject({ cancelled: true, reason: 'out-of-scope-side-effect' })
      expect(r.hint).toMatch(/terminal/)
      expect(exec.records).toHaveLength(0)
    })

    it('Help for a blocked command is allowed', async () => {
      const { exec, run } = setup()
      await run({ command: 'feedback --help' })
      expect(exec.records).toHaveLength(1)
    })

    it('Help flag used as an option value does not bypass the blocklist', async () => {
      const { run, exec, authorize } = setup()
      expect(await run({ command: 'feedback hi --body -h' })).toMatchObject({ reason: 'out-of-scope-side-effect', cancelled: true })
      expect(exec.records).toHaveLength(0)
      expect(authorize).not.toHaveBeenCalled()
    })
  })

  describe('execution', () => {
    it('Commands run with stdin closed and no injected flags', async () => {
      const { exec, run } = setup()
      await run({ command: 'archive my-change' })
      expect(exec.records[0].argv).toEqual(['archive', 'my-change'])
    })

    it('Non-zero exit from CLI is a normal return', async () => {
      const { run } = setup({ response: { stdout: 'o', stderr: 'e', exitCode: 2 } })
      expect(await run({ command: 'validate x' })).toEqual({ stdout: 'o', stderr: 'e', exitCode: 2 })
    })

    it('openspec not on PATH returns a structured error', async () => {
      const { run, log } = setup({ response: new Error('spawn ENOENT') })
      expect(await run({ command: 'list' })).toMatchObject({ reason: 'spawn-failed', exitCode: null })
      expect(log).toHaveBeenCalledWith('error', expect.any(String), expect.any(Error))
    })
  })

  describe('timeout', () => {
    it('Default timeout applies when omitted', async () => {
      const { exec, run } = setup()
      await run({ command: 'list' })
      expect(exec.records[0].timeoutMs).toBe(120000)
    })

    it('Default timeout applies when omitted: an explicit timeout overrides it', async () => {
      const { exec, run } = setup()
      await run({ command: 'list', timeout: 5000 })
      expect(exec.records[0].timeoutMs).toBe(5000)
    })

    it.each([10, 600001, 1.5, '1000'])('Out-of-range timeout is rejected: %p', async (timeout) => {
      const { exec, run } = setup()
      expect(await run({ command: 'list', timeout })).toMatchObject({ reason: 'invalid-timeout', exitCode: null })
      expect(exec.records).toHaveLength(0)
    })

    it('Hanging command is killed at the timeout', async () => {
      const { run } = setup({ response: { stdout: 'partial', timedOut: true, exitCode: null } })
      expect(await run({ command: 'list' })).toMatchObject({
        timedOut: true, reason: 'timeout', exitCode: null, stdout: 'partial',
      })
    })
  })

  describe('gating', () => {
    it('Destructive verb executes when no confirmation mechanism is available', async () => {
      const authorize = jest.fn().mockResolvedValue(undefined)
      const { exec, run } = setup({ runtime: 'v2', authorize })
      const r = await run({ command: 'archive my-change --yes' })
      expect(exec.records[0].argv).toEqual(['archive', 'my-change', '--yes'])
      expect(r).not.toHaveProperty('cancelled')
      expect(authorize).toHaveBeenCalledTimes(1)
    })

    it('archive command triggers confirmation', async () => {
      const confirm = jest.fn().mockResolvedValue(undefined)
      const { exec, run } = setup({ confirm, runtime: 'v1' })
      await run({ command: 'archive my-change --yes' })
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(exec.records.map((r) => r.argv[0])).toContain('archive')
    })

    it('User denial returns cancelled result', async () => {
      const confirm = jest.fn().mockRejectedValue(new Error('denied'))
      const { exec, run } = setup({ confirm, runtime: 'v1' })
      expect(await run({ command: 'new change x' })).toEqual({ cancelled: true })
      expect(exec.records).toHaveLength(0)
    })

    it('Leading global option does not bypass the gate', async () => {
      const confirm = jest.fn().mockResolvedValue(undefined)
      const { run } = setup({ confirm, runtime: 'v1' })
      await run({ command: '--no-color archive my-change --yes' })
      expect(confirm).toHaveBeenCalledTimes(1)
    })

    it('Read-only command with change name containing archive is not gated', async () => {
      const confirm = jest.fn()
      const { run, authorize } = setup({ confirm })
      await run({ command: 'status --change archive-cleanup --json' })
      expect(confirm).not.toHaveBeenCalled()
      expect(authorize).not.toHaveBeenCalled()
    })
  })

  describe('cache refresh', () => {
    const response = (argv) => (argv[0] === 'list' ? { stdout: LIST(['a']) } : { stdout: '' })

    it('Cache is refreshed after new change creation', async () => {
      const { exec, run, cacheByDir } = setup({ response })
      await run({ command: 'new change a' })
      expect(exec.calls).toEqual(['openspec new change a', 'openspec list --json'])
      expect(cacheByDir.get('/project').changes).toEqual([{ name: 'a', done: 0, total: 1 }])
    })

    it('Cache is refreshed after a failed or timed-out mutating command', async () => {
      const failing = (argv) => (argv[0] === 'list' ? { stdout: LIST([]) } : { exitCode: 1 })
      const a = setup({ response: failing })
      await a.run({ command: 'archive x --yes' })
      expect(a.exec.calls).toContain('openspec list --json')
      const b = setup({ response: (argv) => (argv[0] === 'list' ? { stdout: LIST([]) } : { timedOut: true, exitCode: null }) })
      await b.run({ command: 'update' })
      expect(b.exec.calls).toContain('openspec list --json')
    })

    it('Failed refresh keeps the previous cache entry', async () => {
      const previous = { present: true, changes: [{ name: 'old', done: 1, total: 2 }], at: 1 }
      for (const bad of [{ exitCode: 1 }, { timedOut: true, exitCode: null }]) {
        const { run, cacheByDir } = setup({ response: (argv) => (argv[0] === 'list' ? bad : {}) })
        cacheByDir.set('/project', previous)
        await run({ command: 'archive x --yes' })
        expect(cacheByDir.get('/project')).toBe(previous)
      }
    })

    it('refreshes after a verb unknown to the plugin (V1)', async () => {
      const { exec, run } = setup({ response, runtime: 'v1' })
      await run({ command: 'some-future-verb' })
      expect(exec.calls).toContain('openspec list --json')
    })

    it('Read-only command does not refresh the cache', async () => {
      const { exec, run } = setup({ response })
      await run({ command: 'list --json' })
      expect(exec.calls).toEqual(['openspec list --json'])
    })
  })
})

describe('V2 native authorization boundary', () => {
  it('Allowed invocation proceeds without plugin confirmation', async () => {
    const confirm = jest.fn()
    const authorize = jest.fn().mockResolvedValue(undefined)
    const { exec, run } = setup({ runtime: 'v2', authorize, confirm })
    await run({ command: 'new change x' })
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
    expect(exec.records[0].argv).toEqual(['new', 'change', 'x'])
  })

  it('Pending ask prevents execution until approval', async () => {
    let approve
    const pending = new Promise((resolve) => { approve = resolve })
    const authorize = jest.fn(() => pending)
    const { exec, run } = setup({ runtime: 'v2', authorize })
    const result = run({ command: 'archive x --yes' })
    await Promise.resolve()
    expect(exec.records).toHaveLength(0)
    approve()
    await result
    expect(exec.records.map(r => r.argv[0])).toEqual(['archive', 'list'])
  })

  it('Pending approval cannot change the executed invocation', async () => {
    let approve
    const pending = new Promise((resolve) => { approve = resolve })
    const context = { defaultDir: '/fallback', sessionID: 's1', sessionDirs: new Map([['s1', '/original']]) }
    const authorize = jest.fn((intent) => {
      expect(() => { intent.argv[2] = 'tampered' }).toThrow(TypeError)
      return pending
    })
    const { exec, run } = setup({ runtime: 'v2', authorize, context })
    const args = { command: 'new change original', timeout: 5000 }
    const result = run(args)
    await Promise.resolve()
    expect(authorize).toHaveBeenCalledTimes(1)
    context.sessionDirs.set('s1', '/changed')
    args.command = 'store remove everything'
    args.workdir = '/elsewhere'
    args.timeout = 1000
    approve()
    await result
    expect(exec.records[0]).toMatchObject({ cwd: '/original', argv: ['new', 'change', 'original'], timeoutMs: 5000 })
  })

  it.each([
    ['Configured denial propagates before spawn', new Error('denied')],
    ['Plain rejection preserves step-ending control flow', new Error('declined')],
    ['Corrective feedback rejection is preserved', Object.assign(new Error('corrected'), { feedback: 'use a different change' })],
    ['Permission service failure fails closed', new Error('service unavailable')],
  ])('%s', async (_title, error) => {
    for (const authorize of [jest.fn(() => { throw error }), jest.fn().mockRejectedValue(error)]) {
      const { exec, run, log, cacheByDir } = setup({ runtime: 'v2', authorize })
      const previous = { present: true, changes: [], at: 1 }
      cacheByDir.set('/project', previous)
      await expect(run({ command: 'archive x --yes' })).rejects.toBe(error)
      expect(exec.records).toHaveLength(0)
      expect(cacheByDir.get('/project')).toBe(previous)
      expect(log).not.toHaveBeenCalled()
    }
  })
})

describe('openspec_status / openspec_instructions timeouts', () => {
  it.each([
    ['openspec_status', executeOpenspecStatus, { change: 'c' }],
    ['openspec_instructions', executeOpenspecInstructions, { artifact: 'proposal', change: 'c' }],
  ])('%s maps a timed-out run to reason "timeout"', async (_n, fn, args) => {
    const exec = createMockExec({ timedOut: true, exitCode: null })
    const r = JSON.parse(await fn(args, resolveCtx, { exec, log: jest.fn(), confirm: null, cacheByDir: new Map() }))
    expect(r).toMatchObject({ reason: 'timeout', exitCode: null })
    expect(r.error).toBeTruthy()
  })
})
