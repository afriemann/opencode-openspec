// test/cli-pipeline.test.js
// spec: openspec/changes/full-cli-support/specs/tools/spec.md

import { jest } from '@jest/globals'
import { executeOpenspecCli, executeOpenspecStatus, executeOpenspecInstructions } from '../src/core.js'
import { createMockExec } from './support/mock-exec.js'

const resolveCtx = { defaultDir: '/project' }

function setup({ response, confirm = null } = {}) {
  const exec = createMockExec(response)
  const cacheByDir = new Map()
  const log = jest.fn()
  const run = async (args) => JSON.parse(await executeOpenspecCli(args, resolveCtx, { exec, log, confirm, cacheByDir }))
  return { exec, run, cacheByDir, log }
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
  })

  describe('execution', () => {
    it('Commands run with stdin closed and no injected flags', async () => {
      const { exec, run } = setup()
      await run({ command: 'archive my-change' })
      expect(exec.records[0].argv).toEqual(['archive', 'my-change'])
    })

    it('returns { stdout, stderr, exitCode } without extra fields on a normal run', async () => {
      const { run } = setup({ response: { stdout: 'o', stderr: 'e', exitCode: 2 } })
      expect(await run({ command: 'validate x' })).toEqual({ stdout: 'o', stderr: 'e', exitCode: 2 })
    })

    it('returns spawn-failed with exitCode null and logs when the process cannot start', async () => {
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

    it('passes an explicit timeout through', async () => {
      const { exec, run } = setup()
      await run({ command: 'list', timeout: 5000 })
      expect(exec.records[0].timeoutMs).toBe(5000)
    })

    it.each([10, 600001, 1.5, '1000'])('Out-of-range timeout %p is rejected', async (timeout) => {
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
    it('Destructive verb is refused when no confirmation mechanism is available', async () => {
      const { exec, run } = setup({ confirm: null })
      const r = await run({ command: 'archive my-change --yes' })
      expect(exec.records[0].argv).toEqual(['archive', 'my-change', '--yes'])
      expect(r).not.toHaveProperty('cancelled')
    })

    it('archive command triggers confirmation', async () => {
      const confirm = jest.fn().mockResolvedValue(undefined)
      const { exec, run } = setup({ confirm })
      await run({ command: 'archive my-change --yes' })
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(exec.records.map((r) => r.argv[0])).toContain('archive')
    })

    it('User denial returns cancelled result', async () => {
      const confirm = jest.fn().mockRejectedValue(new Error('denied'))
      const { exec, run } = setup({ confirm })
      expect(await run({ command: 'new change x' })).toEqual({ cancelled: true })
      expect(exec.records).toHaveLength(0)
    })

    it('Leading global option does not bypass the gate', async () => {
      const confirm = jest.fn().mockResolvedValue(undefined)
      const { run } = setup({ confirm })
      await run({ command: '--no-color archive my-change --yes' })
      expect(confirm).toHaveBeenCalledTimes(1)
    })

    it('Read-only command with change name containing archive is not gated', async () => {
      const confirm = jest.fn()
      const { run } = setup({ confirm })
      await run({ command: 'status --change archive-cleanup --json' })
      expect(confirm).not.toHaveBeenCalled()
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

    it('keeps the previous cache entry when the refresh fails or times out', async () => {
      const previous = { present: true, changes: [{ name: 'old', done: 1, total: 2 }], at: 1 }
      for (const bad of [{ exitCode: 1 }, { timedOut: true, exitCode: null }]) {
        const { run, cacheByDir } = setup({ response: (argv) => (argv[0] === 'list' ? bad : {}) })
        cacheByDir.set('/project', previous)
        await run({ command: 'archive x --yes' })
        expect(cacheByDir.get('/project')).toBe(previous)
      }
    })

    it('refreshes after a verb unknown to the plugin', async () => {
      const { exec, run } = setup({ response })
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
