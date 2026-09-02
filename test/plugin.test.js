// test/plugin.test.js
// Integration tests for the plugin factory, tools, cache, and transform hook.
// spec: openspec/changes/initial-plugin/specs/plugin/spec.md
// spec: openspec/changes/initial-plugin/specs/tools/spec.md
// spec: openspec/changes/initial-plugin/specs/system-prompt/spec.md

import { jest } from '@jest/globals'
import OpenSpecPlugin, { runOpenspec, populateCache } from '../src/index.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock Bun `$` tagged-template-literal function.
 * Each call to $ returns a chainable object that resolves to `response` on .nothrow().
 *
 * @param {object|Error} responseOrError - response object OR Error to throw from nothrow
 */
function createMock$(responseOrError = { stdout: '', stderr: '', exitCode: 0 }) {
  const calls = []
  function $(strings, ...values) {
    // Reconstruct the command string for tracking
    const cmd = Array.isArray(strings)
      ? strings.reduce((acc, s, i) => {
          const v = values[i]
          if (v == null) return acc + s
          if (Array.isArray(v)) return acc + s + v.join(' ')
          return acc + s + String(v)
        }, '')
      : String(strings)
    calls.push(cmd.trim())

    const shouldThrow = responseOrError instanceof Error
    const result = shouldThrow
      ? null
      : {
          stdout: Buffer.from(responseOrError.stdout ?? ''),
          stderr: Buffer.from(responseOrError.stderr ?? ''),
          exitCode: responseOrError.exitCode ?? 0,
        }

    const chain = {
      cwd: () => chain,
      quiet: () => chain,
      nothrow: () =>
        shouldThrow
          ? Promise.reject(responseOrError)
          : Promise.resolve(result),
    }
    return chain
  }
  $.calls = calls
  return $
}

function createMockClient() {
  const logs = []
  return {
    logs,
    app: {
      log: (opts) => {
        logs.push(opts)
        return Promise.resolve()
      },
    },
  }
}

function makeContext(overrides = {}) {
  return {
    worktree: '/project',
    directory: '/project',
    agent: 'engineer',
    ask: jest.fn().mockResolvedValue(undefined), // resolves by default (approved)
    ...overrides,
  }
}

const SAMPLE_LIST_JSON = JSON.stringify({
  changes: [
    { name: 'my-feature', completedTasks: 3, totalTasks: 10, status: 'in-progress' },
  ],
})

const SAMPLE_STATUS_JSON = JSON.stringify({
  isPlanningComplete: true,
  isComplete: false,
  artifacts: [
    { id: 'proposal', status: 'complete' },
    { id: 'specs',    status: 'complete' },
    { id: 'design',   status: 'complete' },
    { id: 'tasks',    status: 'complete' },
  ],
})

const SAMPLE_INSTRUCTIONS_JSON = JSON.stringify({
  template: '## Why\n\n<!-- ... -->',
  instruction: 'Write the proposal...',
  resolvedOutputPath: '/project/openspec/changes/my-change/proposal.md',
  otherField: 'should not appear in output',
})

// ---------------------------------------------------------------------------
// runOpenspec
// Scenario: Read-only command returns stdout and exit code
// Scenario: Non-zero exit from CLI is a normal return
// ---------------------------------------------------------------------------

describe('runOpenspec', () => {
  it('returns stdout, stderr, exitCode on success', async () => {
    const mock$ = createMock$({ stdout: 'hello', stderr: '', exitCode: 0 })
    const result = await runOpenspec(mock$, '/dir', ['list', '--json'])
    expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 })
  })

  it('returns non-zero exitCode as a normal result', async () => {
    const mock$ = createMock$({ stdout: '', stderr: 'error msg', exitCode: 1 })
    const result = await runOpenspec(mock$, '/dir', ['validate', 'bad'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('error msg')
  })

  it('throws on infrastructure failure (spawn error)', async () => {
    const mock$ = createMock$(new Error('spawn ENOENT'))
    await expect(runOpenspec(mock$, '/dir', ['list'])).rejects.toThrow('spawn ENOENT')
  })
})

// ---------------------------------------------------------------------------
// populateCache
// Scenario: Cache is populated when openspec is present
// ---------------------------------------------------------------------------

describe('populateCache', () => {
  it('populates cache with parsed changes on success', async () => {
    const mock$ = createMock$({ stdout: SAMPLE_LIST_JSON, stderr: '', exitCode: 0 })
    const client = createMockClient()
    const cache = new Map()
    await populateCache(cache, mock$, client, '/project')
    const entry = cache.get('/project')
    expect(entry.present).toBe(true)
    expect(entry.changes).toHaveLength(1)
    expect(entry.changes[0].name).toBe('my-feature')
    expect(entry.changes[0].done).toBe(3)
    expect(entry.changes[0].total).toBe(10)
  })

  it('sets changes to [] when JSON parse fails', async () => {
    const mock$ = createMock$({ stdout: 'not-json', stderr: '', exitCode: 0 })
    const client = createMockClient()
    const cache = new Map()
    await populateCache(cache, mock$, client, '/project')
    const entry = cache.get('/project')
    expect(entry.present).toBe(true)
    expect(entry.changes).toEqual([])
  })

  it('logs and sets a fallback entry on spawn failure', async () => {
    const mock$ = createMock$(new Error('spawn failed'))
    const client = createMockClient()
    const cache = new Map()
    await populateCache(cache, mock$, client, '/project')
    expect(client.logs.length).toBeGreaterThan(0)
    // Fallback entry written (present:true, empty changes)
    const entry = cache.get('/project')
    expect(entry).toBeDefined()
    expect(entry.present).toBe(true)
    expect(entry.changes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

describe('OpenSpecPlugin factory', () => {
  it('returns event, tool, and experimental.chat.system.transform hooks', async () => {
    const plugin = await OpenSpecPlugin({
      client: createMockClient(),
      directory: '/project',
      $: createMock$(),
    })
    expect(typeof plugin.event).toBe('function')
    expect(plugin.tool).toBeDefined()
    expect(plugin.tool.openspec_cli).toBeDefined()
    expect(plugin.tool.openspec_status).toBeDefined()
    expect(plugin.tool.openspec_instructions).toBeDefined()
    expect(typeof plugin['experimental.chat.system.transform']).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// openspec_cli
// Scenario: Read-only command returns stdout and exit code
// Scenario: Non-zero exit from CLI is a normal return
// Scenario: openspec not on PATH returns a structured error
// Scenario: archive command triggers confirmation
// Scenario: User denial returns cancelled result
// Scenario: Read-only command with change name containing archive is not gated
// Scenario: Cache is refreshed after new change creation
// ---------------------------------------------------------------------------

describe('openspec_cli', () => {
  async function makePlugin(shellResponse) {
    const mock$ = typeof shellResponse === 'object' && shellResponse instanceof Error
      ? createMock$(shellResponse)
      : createMock$(shellResponse)
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    return { plugin, mock$, client }
  }

  it('runs a read-only command and returns {stdout, stderr, exitCode}', async () => {
    const { plugin } = await makePlugin({ stdout: '{"changes":[]}', stderr: '', exitCode: 0 })
    const result = JSON.parse(
      await plugin.tool.openspec_cli.execute({ command: 'list --json' }, makeContext()),
    )
    expect(result).toEqual({ stdout: '{"changes":[]}', stderr: '', exitCode: 0 })
  })

  it('returns a non-zero exitCode as a normal result', async () => {
    const { plugin } = await makePlugin({ stdout: '', stderr: 'invalid', exitCode: 1 })
    const result = JSON.parse(
      await plugin.tool.openspec_cli.execute({ command: 'validate bad-change' }, makeContext()),
    )
    expect(result.exitCode).toBe(1)
  })

  it('returns {error, exitCode:null} on spawn failure', async () => {
    const { plugin, client } = await makePlugin(new Error('spawn ENOENT'))
    const result = JSON.parse(
      await plugin.tool.openspec_cli.execute({ command: 'list --json' }, makeContext()),
    )
    expect(result.error).toBeTruthy()
    expect(result.exitCode).toBeNull()
    expect(client.logs.length).toBeGreaterThan(0)
  })

  it('calls context.ask before spawning an archive command, and returns normal result on approval', async () => {
    const { plugin } = await makePlugin({ stdout: '', stderr: '', exitCode: 0 })
    const ctx = makeContext() // ask resolves by default (approved)
    const result = JSON.parse(
      await plugin.tool.openspec_cli.execute({ command: 'archive my-change --yes' }, ctx),
    )
    expect(ctx.ask).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ exitCode: 0 }) // normal result, not cancelled
  })

  it('calls context.ask before spawning a "new change" command, and returns normal result on approval', async () => {
    const { plugin } = await makePlugin({ stdout: '', stderr: '', exitCode: 0 })
    const ctx = makeContext() // ask resolves by default (approved)
    const result = JSON.parse(
      await plugin.tool.openspec_cli.execute({ command: 'new change my-feature' }, ctx),
    )
    expect(ctx.ask).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ exitCode: 0 }) // normal result, not cancelled
  })

  it('returns {cancelled:true} and does not spawn when user denies', async () => {
    const { plugin, mock$ } = await makePlugin({ stdout: '', stderr: '', exitCode: 0 })
    const ctx = makeContext({ ask: jest.fn().mockRejectedValue(new Error('denied')) })
    const result = JSON.parse(
      await plugin.tool.openspec_cli.execute({ command: 'archive my-change --yes' }, ctx),
    )
    expect(result).toEqual({ cancelled: true })
    // The mock$ was called for populateCache at factory init — archive spawn should NOT add calls
    const archiveCalls = mock$.calls.filter(c => c.includes('archive'))
    expect(archiveCalls.length).toBe(0)
  })

  it('does NOT call context.ask for "status --change archive-foo --json"', async () => {
    const { plugin } = await makePlugin({ stdout: '{}', stderr: '', exitCode: 0 })
    const ctx = makeContext()
    await plugin.tool.openspec_cli.execute(
      { command: 'status --change archive-foo --json' },
      ctx,
    )
    expect(ctx.ask).not.toHaveBeenCalled()
  })

  it('refreshes cache after a successful mutation', async () => {
    let callCount = 0
    // First response is for the mutation; second for the cache refresh list
    const responses = [
      { stdout: '', stderr: '', exitCode: 0 },           // archive command
      { stdout: SAMPLE_LIST_JSON, stderr: '', exitCode: 0 }, // populateCache list
    ]
    const mock$ = function(strings, ...values) {
      const resp = responses[callCount] ?? responses[responses.length - 1]
      callCount++
      const result = {
        stdout: Buffer.from(resp.stdout ?? ''),
        stderr: Buffer.from(resp.stderr ?? ''),
        exitCode: resp.exitCode ?? 0,
      }
      const chain = { cwd: () => chain, quiet: () => chain, nothrow: () => Promise.resolve(result) }
      return chain
    }
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    const ctx = makeContext()
    await plugin.tool.openspec_cli.execute({ command: 'archive my-change --yes' }, ctx)
    // After mutation the cache entry should be present with the refreshed data.
    // The transform should push both the static notice AND the changes summary.
    const output = { system: [] }
    await plugin['experimental.chat.system.transform']({}, output)
    const joined = output.system.join('\n')
    // Static notice present
    expect(joined).toContain('openspec_cli')
    // Changes summary present — SAMPLE_LIST_JSON has my-feature with 3/10 tasks
    expect(joined).toContain('my-feature')
    expect(joined).toContain('3/10')
  })
})

// ---------------------------------------------------------------------------
// openspec_status
// Scenario: Status returns canonical artifact order
// Scenario: isPlanningComplete is surfaced, not isComplete
// ---------------------------------------------------------------------------

describe('openspec_status', () => {
  async function makePlugin(shellResponse) {
    const mock$ = createMock$(shellResponse)
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    return { plugin, mock$, client }
  }

  it('returns canonical order: proposal → design → specs → tasks', async () => {
    const { plugin } = await makePlugin({ stdout: SAMPLE_STATUS_JSON, stderr: '', exitCode: 0 })
    const result = JSON.parse(
      await plugin.tool.openspec_status.execute({ change: 'my-change' }, makeContext()),
    )
    expect(result.order.map(o => o.artifact)).toEqual(['proposal', 'design', 'specs', 'tasks'])
  })

  it('surfaces isPlanningComplete from CLI response', async () => {
    const { plugin } = await makePlugin({ stdout: SAMPLE_STATUS_JSON, stderr: '', exitCode: 0 })
    const result = JSON.parse(
      await plugin.tool.openspec_status.execute({ change: 'my-change' }, makeContext()),
    )
    expect(result.isPlanningComplete).toBe(true)
  })

  it('does NOT surface isComplete as a top-level headline field', async () => {
    const { plugin } = await makePlugin({ stdout: SAMPLE_STATUS_JSON, stderr: '', exitCode: 0 })
    const result = JSON.parse(
      await plugin.tool.openspec_status.execute({ change: 'my-change' }, makeContext()),
    )
    expect(result).not.toHaveProperty('isComplete')
  })

  it('includes the raw CLI response under "raw"', async () => {
    const { plugin } = await makePlugin({ stdout: SAMPLE_STATUS_JSON, stderr: '', exitCode: 0 })
    const result = JSON.parse(
      await plugin.tool.openspec_status.execute({ change: 'my-change' }, makeContext()),
    )
    expect(result.raw).toBeDefined()
  })

  it('returns {error, exitCode} on non-zero CLI exit', async () => {
    const { plugin } = await makePlugin({ stdout: '', stderr: 'not found', exitCode: 1 })
    const result = JSON.parse(
      await plugin.tool.openspec_status.execute({ change: 'bad' }, makeContext()),
    )
    expect(result.error).toBeTruthy()
    expect(result.exitCode).toBe(1)
  })

  it('returns {error} on spawn failure', async () => {
    const mock$ = createMock$(new Error('spawn ENOENT'))
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    const result = JSON.parse(
      await plugin.tool.openspec_status.execute({ change: 'any' }, makeContext()),
    )
    expect(result.error).toBeTruthy()
    expect(result.exitCode).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// openspec_instructions
// Scenario: Returns the three fields needed to write an artifact
// Scenario: resolvedOutputPath is the exact path to write
// ---------------------------------------------------------------------------

describe('openspec_instructions', () => {
  async function makePlugin(shellResponse) {
    const mock$ = createMock$(shellResponse)
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    return { plugin, mock$, client }
  }

  it('returns template, instruction, and resolvedOutputPath', async () => {
    const { plugin } = await makePlugin({ stdout: SAMPLE_INSTRUCTIONS_JSON, stderr: '', exitCode: 0 })
    const result = JSON.parse(
      await plugin.tool.openspec_instructions.execute(
        { artifact: 'proposal', change: 'my-change' },
        makeContext(),
      ),
    )
    expect(result.template).toBeTruthy()
    expect(result.instruction).toBeTruthy()
    expect(result.resolvedOutputPath).toBeTruthy()
  })

  it('does not include extra CLI fields in the output', async () => {
    const { plugin } = await makePlugin({ stdout: SAMPLE_INSTRUCTIONS_JSON, stderr: '', exitCode: 0 })
    const result = JSON.parse(
      await plugin.tool.openspec_instructions.execute(
        { artifact: 'proposal', change: 'my-change' },
        makeContext(),
      ),
    )
    expect(Object.keys(result)).toEqual(['template', 'instruction', 'resolvedOutputPath'])
  })

  it('resolvedOutputPath is the exact absolute path from the CLI', async () => {
    const { plugin } = await makePlugin({ stdout: SAMPLE_INSTRUCTIONS_JSON, stderr: '', exitCode: 0 })
    const result = JSON.parse(
      await plugin.tool.openspec_instructions.execute(
        { artifact: 'proposal', change: 'my-change' },
        makeContext(),
      ),
    )
    expect(result.resolvedOutputPath).toBe(
      '/project/openspec/changes/my-change/proposal.md',
    )
  })

  it('returns {error} on spawn failure', async () => {
    const mock$ = createMock$(new Error('spawn ENOENT'))
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    const result = JSON.parse(
      await plugin.tool.openspec_instructions.execute(
        { artifact: 'proposal', change: 'any' },
        makeContext(),
      ),
    )
    expect(result.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// workdir resolution (tools)
// Scenario: Tool uses worktree when no explicit cwd provided
// Scenario: Explicit cwd overrides context
// ---------------------------------------------------------------------------

describe('workdir resolution in tools', () => {
  it('uses context.worktree when no workdir arg provided', async () => {
    let usedWorkdir = null
    const mock$ = function(strings, ...values) {
      const chain = {
        cwd: (d) => { usedWorkdir = d; return chain },
        quiet: () => chain,
        nothrow: () => Promise.resolve({ stdout: Buffer.from('{"changes":[]}'), stderr: Buffer.from(''), exitCode: 0 }),
      }
      return chain
    }
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    await plugin.tool.openspec_status.execute(
      { change: 'my-change' },
      makeContext({ worktree: '/tree', directory: '/dir' }),
    )
    expect(usedWorkdir).toBe('/tree')
  })

  it('uses args.workdir when explicitly provided', async () => {
    let usedWorkdir = null
    const mock$ = function(strings, ...values) {
      const chain = {
        cwd: (d) => { usedWorkdir = d; return chain },
        quiet: () => chain,
        nothrow: () => Promise.resolve({ stdout: Buffer.from('{"changes":[]}'), stderr: Buffer.from(''), exitCode: 0 }),
      }
      return chain
    }
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    await plugin.tool.openspec_status.execute(
      { change: 'my-change', workdir: '/explicit' },
      makeContext({ worktree: '/tree', directory: '/dir' }),
    )
    expect(usedWorkdir).toBe('/explicit')
  })
})

// ---------------------------------------------------------------------------
// System-prompt injection (session.created + transform)
// Scenario: Cache is populated when openspec is present
// Scenario: Cache marks absence when openspec is not present
// Scenario: Transform reads cache and pushes strings only
// Scenario: Injection includes static tools notice
// Scenario: Injection includes active changes summary
// Scenario: Static notice is injected on cache miss
// Scenario: Nothing is injected in a non-openspec project
// Scenario: Cache reflects new change after creation via openspec_cli
// ---------------------------------------------------------------------------

describe('system-prompt injection', () => {
  /** Helper: build a plugin with a fake existsSync so event handling is testable */
  async function makeInjectionPlugin(presentDir = '/project') {
    const mock$ = createMock$({ stdout: SAMPLE_LIST_JSON, stderr: '', exitCode: 0 })
    const client = createMockClient()
    const fakeExistsSync = (path) => path === `${presentDir}/openspec`
    const plugin = await OpenSpecPlugin({
      client,
      directory: presentDir,
      $: mock$,
      existsSync: fakeExistsSync,
    })
    return { plugin, mock$, client }
  }

  it('injects tools notice and changes summary when openspec is present (via event)', async () => {
    const { plugin } = await makeInjectionPlugin('/project')
    // Fire session.created so the event hook populates the cache
    await plugin.event({
      event: { type: 'session.created', properties: { info: { directory: '/project' } } },
    })
    const output = { system: [] }
    plugin['experimental.chat.system.transform']({}, output)
    const joined = output.system.join('\n')
    expect(joined).toContain('openspec_cli')   // static notice
    expect(joined).toContain('my-feature')      // change name from SAMPLE_LIST_JSON
    expect(joined).toContain('3/10')            // task counts
  })

  it('transform pushes static notice on cache miss (no entry yet)', async () => {
    const mock$ = createMock$({ stdout: '', stderr: '', exitCode: 0 })
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    // Don't call event — leave cache empty
    const output = { system: [] }
    await plugin['experimental.chat.system.transform']({}, output)
    expect(output.system.some(s => s.includes('openspec_cli'))).toBe(true)
  })

  it('transform pushes nothing when cache entry has present:false', async () => {
    const mock$ = createMock$({ stdout: '', stderr: '', exitCode: 0 })
    const client = createMockClient()
    // Use injectable existsSync that always returns false (openspec absent)
    const plugin = await OpenSpecPlugin({
      client,
      directory: '/project',
      $: mock$,
      existsSync: () => false,
    })
    await plugin.event({
      event: { type: 'session.created', properties: { info: { directory: '/project' } } },
    })
    const output = { system: [] }
    plugin['experimental.chat.system.transform']({}, output)
    expect(output.system.length).toBe(0)
  })

  it('transform performs no I/O (no $ calls during transform)', async () => {
    const shellCalls = []
    const trackingMock$ = function(strings, ...values) {
      shellCalls.push('called')
      const chain = {
        cwd: () => chain,
        quiet: () => chain,
        nothrow: () => Promise.resolve({ stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 }),
      }
      return chain
    }
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: trackingMock$ })
    const countBefore = shellCalls.length
    const output = { system: [] }
    plugin['experimental.chat.system.transform']({}, output) // synchronous now
    expect(shellCalls.length).toBe(countBefore) // no additional $ calls during transform
  })

  it('transform includes changes summary from cached list (no filesystem dependency)', async () => {
    // Build the plugin with an injectable existsSync so the event handler can
    // detect openspec/ presence without touching the real filesystem.
    const mock$ = createMock$({ stdout: SAMPLE_LIST_JSON, stderr: '', exitCode: 0 })
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({
      client,
      directory: '/project',
      $: mock$,
      existsSync: (p) => p === '/project/openspec',
    })
    // Fire session.created → event handler sees present=true → populates cache
    await plugin.event({
      event: { type: 'session.created', properties: { info: { directory: '/project' } } },
    })
    const output = { system: [] }
    plugin['experimental.chat.system.transform']({}, output)
    const allText = output.system.join('\n')
    expect(allText).toContain('openspec_cli')  // static notice
    expect(allText).toContain('my-feature')     // changes summary from SAMPLE_LIST_JSON
  })
})

// ---------------------------------------------------------------------------
// Error handling — plugin safety
// Scenario: Error inside event hook is swallowed
// Scenario: Error inside transform hook is swallowed
// Scenario: openspec not on PATH returns a structured error
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('event hook swallows errors and does not rethrow', async () => {
    const mock$ = createMock$(new Error('spawn failed'))
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    // Should not throw even with a broken $
    await expect(
      plugin.event({ event: { type: 'session.created', properties: { info: { directory: '/project' } } } }),
    ).resolves.not.toThrow()
  })

  it('transform hook swallows errors and does not rethrow', async () => {
    const mock$ = createMock$()
    const client = { app: { log: () => { throw new Error('log broken') } } }
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    const output = { system: [] }
    expect(() => plugin['experimental.chat.system.transform']({}, output)).not.toThrow()
  })

  it('tool execute returns {error} rather than throwing on spawn failure', async () => {
    const mock$ = createMock$(new Error('ENOENT'))
    const client = createMockClient()
    const plugin = await OpenSpecPlugin({ client, directory: '/project', $: mock$ })
    const result = JSON.parse(
      await plugin.tool.openspec_cli.execute({ command: 'list' }, makeContext()),
    )
    expect(result.error).toBeTruthy()
    expect(result.exitCode).toBeNull()
  })

  it('does not call console.* anywhere in the plugin', async () => {
    // Source-level check: no console.* in any plugin source file
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
    const helpers = readFileSync(new URL('../src/lib/helpers.js', import.meta.url), 'utf8')
    const consoleUsages = (source + helpers).match(/console\.(log|warn|error|info|debug)/g)
    expect(consoleUsages).toBeNull()
  })
})
