// test/adapter-conformance.test.js
// Layer 2 — shared adapter-conformance suite (design.md D-7, tasks.md 6.1–6.2).
// Drives both src/plugin.v1.js and src/plugin.v2.js with equivalent inputs
// and asserts they invoke the `openspec` CLI identically and produce
// identical (unwrapped) results, except for the one asserted divergence:
// destructive-verb handling with no confirmation mechanism.

import { jest } from '@jest/globals'
import OpenSpecPluginV1 from '../src/plugin.v1.js'
import pluginV2 from '../src/plugin.v2.js'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Shared mock $ (tracks argv + cwd per call, for both adapters)
// ---------------------------------------------------------------------------

function createTrackedMock$(responseOrError = { stdout: '', stderr: '', exitCode: 0 }) {
  const calls = []
  function $(strings, ...values) {
    const cmd = Array.isArray(strings)
      ? strings.reduce((acc, s, i) => {
          const v = values[i]
          if (v == null) return acc + s
          if (Array.isArray(v)) return acc + s + v.join(' ')
          return acc + s + String(v)
        }, '')
      : String(strings)
    const call = { cmd: cmd.trim(), cwd: undefined }
    calls.push(call)

    const shouldThrow = responseOrError instanceof Error
    const result = shouldThrow
      ? null
      : {
          stdout: Buffer.from(responseOrError.stdout ?? ''),
          stderr: Buffer.from(responseOrError.stderr ?? ''),
          exitCode: responseOrError.exitCode ?? 0,
        }
    const chain = {
      cwd: (dir) => {
        call.cwd = dir
        return chain
      },
      quiet: () => chain,
      nothrow: () => (shouldThrow ? Promise.reject(responseOrError) : Promise.resolve(result)),
    }
    return chain
  }
  $.calls = calls
  return $
}

function createMockV1Client() {
  return { logs: [], app: { log: (opts) => { return Promise.resolve() } } }
}

function makeV1Context(overrides = {}) {
  return {
    worktree: '/project',
    directory: '/project',
    ask: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function createFakeV2Editor() {
  const descriptors = new Map()
  return {
    add: (d) => descriptors.set(d.name, d),
    get: (name) => descriptors.get(name),
    list: () => [...descriptors.values()],
  }
}

function createFakeV2Ctx({ directory = '/project' } = {}) {
  const editor = createFakeV2Editor()
  return {
    location: { directory },
    tool: {
      async transform(cb) {
        await cb(editor)
        return { dispose: jest.fn().mockResolvedValue(undefined) }
      },
    },
    event: {
      subscribe() {
        return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }
      },
    },
    session: {
      async hook() {
        return { dispose: jest.fn().mockResolvedValue(undefined) }
      },
    },
    _editor: editor,
  }
}

// ---------------------------------------------------------------------------
// Same argv + cwd for read-only calls, all three tools
// ---------------------------------------------------------------------------

describe('adapter conformance — CLI invocation', () => {
  it('openspec_cli issues identical argv and cwd on both adapters', async () => {
    const responseJson = { stdout: '{"changes":[]}', stderr: '', exitCode: 0 }

    const mockV1$ = createTrackedMock$(responseJson)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', $: mockV1$ })
    await v1Plugin.tool.openspec_cli.execute({ command: 'list --json' }, makeV1Context())

    const mockV2$ = createTrackedMock$(responseJson)
    globalThis.Bun = { $: mockV2$ }
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx)
    await v2Ctx._editor.get('openspec_cli').execute({ command: 'list --json' }, { sessionID: 's1' })
    delete globalThis.Bun

    const v1Call = mockV1$.calls.find((c) => c.cmd.includes('list'))
    const v2Call = mockV2$.calls.find((c) => c.cmd.includes('list'))
    expect(v1Call.cmd).toBe(v2Call.cmd)
    expect(v1Call.cwd).toBe(v2Call.cwd)
    expect(v1Call.cwd).toBe('/project')
  })

  it('openspec_status issues identical argv and cwd on both adapters', async () => {
    const responseJson = { stdout: '{"artifacts":[]}', stderr: '', exitCode: 0 }

    const mockV1$ = createTrackedMock$(responseJson)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', $: mockV1$ })
    await v1Plugin.tool.openspec_status.execute({ change: 'my-change' }, makeV1Context())

    const mockV2$ = createTrackedMock$(responseJson)
    globalThis.Bun = { $: mockV2$ }
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx)
    await v2Ctx._editor.get('openspec_status').execute({ change: 'my-change' }, { sessionID: 's1' })
    delete globalThis.Bun

    expect(mockV1$.calls[0].cmd).toBe(mockV2$.calls[0].cmd)
    expect(mockV1$.calls[0].cwd).toBe(mockV2$.calls[0].cwd)
  })

  it('openspec_instructions issues identical argv and cwd on both adapters', async () => {
    const responseJson = {
      stdout: JSON.stringify({ template: 't', instruction: 'i', resolvedOutputPath: '/project/x.md' }),
      stderr: '',
      exitCode: 0,
    }

    const mockV1$ = createTrackedMock$(responseJson)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', $: mockV1$ })
    await v1Plugin.tool.openspec_instructions.execute({ artifact: 'proposal', change: 'my-change' }, makeV1Context())

    const mockV2$ = createTrackedMock$(responseJson)
    globalThis.Bun = { $: mockV2$ }
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx)
    await v2Ctx._editor
      .get('openspec_instructions')
      .execute({ artifact: 'proposal', change: 'my-change' }, { sessionID: 's1' })
    delete globalThis.Bun

    expect(mockV1$.calls[0].cmd).toBe(mockV2$.calls[0].cmd)
    expect(mockV1$.calls[0].cwd).toBe(mockV2$.calls[0].cwd)
  })
})

// ---------------------------------------------------------------------------
// Identical returned content across success / non-zero exit / spawn failure /
// unparseable JSON
// ---------------------------------------------------------------------------

describe('adapter conformance — result parity', () => {
  const cases = [
    { name: 'success', response: { stdout: '{"changes":[]}', stderr: '', exitCode: 0 } },
    { name: 'non-zero exit', response: { stdout: '', stderr: 'boom', exitCode: 1 } },
    { name: 'spawn failure', response: new Error('spawn ENOENT') },
  ]

  for (const { name, response } of cases) {
    it(`openspec_cli returns identical content on ${name}`, async () => {
      const mockV1$ = createTrackedMock$(response)
      const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', $: mockV1$ })
      const v1Result = await v1Plugin.tool.openspec_cli.execute({ command: 'list --json' }, makeV1Context())

      const mockV2$ = createTrackedMock$(response)
      globalThis.Bun = { $: mockV2$ }
      const v2Ctx = createFakeV2Ctx({ directory: '/project' })
      await pluginV2.setup(v2Ctx)
      const v2Raw = await v2Ctx._editor.get('openspec_cli').execute({ command: 'list --json' }, { sessionID: 's1' })
      delete globalThis.Bun

      // Unwrap V2's {content} envelope for comparison.
      expect(v2Raw.content).toBe(v1Result)
    })
  }

  it('openspec_status returns identical content on unparseable JSON', async () => {
    const response = { stdout: 'not-json', stderr: '', exitCode: 0 }

    const mockV1$ = createTrackedMock$(response)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', $: mockV1$ })
    const v1Result = await v1Plugin.tool.openspec_status.execute({ change: 'my-change' }, makeV1Context())

    const mockV2$ = createTrackedMock$(response)
    globalThis.Bun = { $: mockV2$ }
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx)
    const v2Raw = await v2Ctx._editor.get('openspec_status').execute({ change: 'my-change' }, { sessionID: 's1' })
    delete globalThis.Bun

    expect(v2Raw.content).toBe(v1Result)
  })
})

// ---------------------------------------------------------------------------
// Identical cache population from a session.created-equivalent event
// ---------------------------------------------------------------------------

describe('adapter conformance — cache population and system-prompt injection', () => {
  function createTempProjectDir() {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-openspec-conformance-'))
    mkdirSync(join(dir, 'openspec'))
    return dir
  }

  it('injects the same textual content (unwrapping the V2 envelope)', async () => {
    const projectDir = createTempProjectDir()
    const listResponse = {
      stdout: JSON.stringify({ changes: [{ name: 'my-feature', completedTasks: 2, totalTasks: 5 }] }),
      stderr: '',
      exitCode: 0,
    }

    // --- V1: event() then experimental.chat.system.transform ---
    const mockV1$ = createTrackedMock$(listResponse)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: projectDir, $: mockV1$ })
    await v1Plugin.event({ event: { type: 'session.created', properties: { directory: projectDir } } })
    const v1Output = { system: [] }
    await v1Plugin['experimental.chat.system.transform']({}, v1Output)

    // --- V2: push a session.created event through the subscribe loop, then the context hook ---
    const mockV2$ = createTrackedMock$(listResponse)
    globalThis.Bun = { $: mockV2$ }
    let contextHook
    const v2Ctx = {
      location: { directory: projectDir },
      tool: {
        async transform(cb) {
          await cb(createFakeV2Editor())
          return { dispose: jest.fn().mockResolvedValue(undefined) }
        },
      },
      event: {
        subscribe() {
          return {
            [Symbol.asyncIterator]() {
              let delivered = false
              return {
                next() {
                  if (!delivered) {
                    delivered = true
                    return Promise.resolve({
                      value: { type: 'session.created', data: { sessionID: 's1', location: { directory: projectDir } } },
                      done: false,
                    })
                  }
                  return new Promise(() => {})
                },
              }
            },
          }
        },
      },
      session: {
        async hook(name, cb) {
          if (name === 'context') contextHook = cb
          return { dispose: jest.fn().mockResolvedValue(undefined) }
        },
      },
    }
    await pluginV2.setup(v2Ctx)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    delete globalThis.Bun

    const v2Event = { sessionID: 's1', system: [] }
    contextHook(v2Event)
    const v2Texts = v2Event.system.map((part) => part.text)

    expect(v2Texts).toEqual(v1Output.system)

    rmSync(projectDir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// The one asserted divergence: destructive-verb handling
// ---------------------------------------------------------------------------

describe('adapter conformance — destructive verb divergence', () => {
  it('V1 prompts via context.ask and returns {cancelled:true} on denial; neither adapter spawns', async () => {
    const response = { stdout: '', stderr: '', exitCode: 0 }

    const mockV1$ = createTrackedMock$(response)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', $: mockV1$ })
    const v1Ctx = makeV1Context({ ask: jest.fn().mockRejectedValue(new Error('denied')) })
    const v1Result = JSON.parse(
      await v1Plugin.tool.openspec_cli.execute({ command: 'archive my-change --yes' }, v1Ctx),
    )
    expect(v1Ctx.ask).toHaveBeenCalledTimes(1)
    expect(v1Result).toEqual({ cancelled: true })
    expect(mockV1$.calls.filter((c) => c.cmd.includes('archive'))).toHaveLength(0)

    const mockV2$ = createTrackedMock$(response)
    globalThis.Bun = { $: mockV2$ }
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx)
    const v2Raw = await v2Ctx._editor.get('openspec_cli').execute({ command: 'archive my-change --yes' }, { sessionID: 's1' })
    delete globalThis.Bun
    const v2Result = JSON.parse(v2Raw.content)

    // The one asserted divergence: V2 has no confirm mechanism, so it
    // refuses with a structured, distinct reason instead of prompting.
    expect(v2Result).toEqual({
      cancelled: true,
      reason: 'confirmation-unavailable',
      hint: expect.any(String),
    })
    expect(mockV2$.calls.filter((c) => c.cmd.includes('archive'))).toHaveLength(0)

    // Both agree on the shared invariant: neither adapter ever spawns a
    // subprocess for a denied/refused destructive command.
    expect(v1Result.cancelled).toBe(true)
    expect(v2Result.cancelled).toBe(true)
  })
})
