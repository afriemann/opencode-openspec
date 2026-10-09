// test/adapter-conformance.test.js
// Layer 2 — shared adapter-conformance suite (design.md D-7, tasks.md 6.1–6.2).
// Drives both src/plugin.v1.js and src/plugin.v2.js with equivalent inputs
// and asserts they invoke the `openspec` CLI identically and produce
// identical (unwrapped) results, except for the one asserted divergence:
// destructive-verb confirmation (V1 only).

import { jest } from '@jest/globals'
import OpenSpecPluginV1 from '../src/plugin.v1.js'
import pluginV2 from '../src/plugin.v2.js'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMockExec } from './support/mock-exec.js'

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

    const mockV1Exec = createMockExec(responseJson)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', exec: mockV1Exec })
    await v1Plugin.tool.openspec_cli.execute({ command: 'list --json' }, makeV1Context())

    const mockV2Exec = createMockExec(responseJson)
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx, { exec: mockV2Exec })
    await v2Ctx._editor.get('openspec_cli').execute({ command: 'list --json' }, { sessionID: 's1' })

    const v1Call = mockV1Exec.records.find((c) => c.cmd.includes('list'))
    const v2Call = mockV2Exec.records.find((c) => c.cmd.includes('list'))
    expect(v1Call.cmd).toBe(v2Call.cmd)
    expect(v1Call.cwd).toBe(v2Call.cwd)
    expect(v1Call.cwd).toBe('/project')
  })

  it('openspec_status issues identical argv and cwd on both adapters', async () => {
    const responseJson = { stdout: '{"artifacts":[]}', stderr: '', exitCode: 0 }

    const mockV1Exec = createMockExec(responseJson)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', exec: mockV1Exec })
    await v1Plugin.tool.openspec_status.execute({ change: 'my-change' }, makeV1Context())

    const mockV2Exec = createMockExec(responseJson)
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx, { exec: mockV2Exec })
    await v2Ctx._editor.get('openspec_status').execute({ change: 'my-change' }, { sessionID: 's1' })

    expect(mockV1Exec.records[0].cmd).toBe(mockV2Exec.records[0].cmd)
    expect(mockV1Exec.records[0].cwd).toBe(mockV2Exec.records[0].cwd)
  })

  it('openspec_instructions issues identical argv and cwd on both adapters', async () => {
    const responseJson = {
      stdout: JSON.stringify({ template: 't', instruction: 'i', resolvedOutputPath: '/project/x.md' }),
      stderr: '',
      exitCode: 0,
    }

    const mockV1Exec = createMockExec(responseJson)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', exec: mockV1Exec })
    await v1Plugin.tool.openspec_instructions.execute({ artifact: 'proposal', change: 'my-change' }, makeV1Context())

    const mockV2Exec = createMockExec(responseJson)
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx, { exec: mockV2Exec })
    await v2Ctx._editor
      .get('openspec_instructions')
      .execute({ artifact: 'proposal', change: 'my-change' }, { sessionID: 's1' })

    expect(mockV1Exec.records[0].cmd).toBe(mockV2Exec.records[0].cmd)
    expect(mockV1Exec.records[0].cwd).toBe(mockV2Exec.records[0].cwd)
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
      const mockV1Exec = createMockExec(response)
      const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', exec: mockV1Exec })
      const v1Result = await v1Plugin.tool.openspec_cli.execute({ command: 'list --json' }, makeV1Context())

      const mockV2Exec = createMockExec(response)
      const v2Ctx = createFakeV2Ctx({ directory: '/project' })
      await pluginV2.setup(v2Ctx, { exec: mockV2Exec })
      const v2Raw = await v2Ctx._editor.get('openspec_cli').execute({ command: 'list --json' }, { sessionID: 's1' })

      // Unwrap V2's {content} envelope for comparison.
      expect(v2Raw.content).toBe(v1Result)
    })
  }

  it('openspec_status returns identical content on unparseable JSON', async () => {
    const response = { stdout: 'not-json', stderr: '', exitCode: 0 }

    const mockV1Exec = createMockExec(response)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', exec: mockV1Exec })
    const v1Result = await v1Plugin.tool.openspec_status.execute({ change: 'my-change' }, makeV1Context())

    const mockV2Exec = createMockExec(response)
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx, { exec: mockV2Exec })
    const v2Raw = await v2Ctx._editor.get('openspec_status').execute({ change: 'my-change' }, { sessionID: 's1' })

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
    const mockV1Exec = createMockExec(listResponse)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: projectDir, exec: mockV1Exec })
    await v1Plugin.event({ event: { type: 'session.created', properties: { directory: projectDir } } })
    const v1Output = { system: [] }
    await v1Plugin['experimental.chat.system.transform']({}, v1Output)

    // --- V2: push a session.created event through the subscribe loop, then the context hook ---
    const mockV2Exec = createMockExec(listResponse)
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
    await pluginV2.setup(v2Ctx, { exec: mockV2Exec })
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    const v2Event = { sessionID: 's1', system: [] }
    contextHook(v2Event)
    const v2Texts = v2Event.system.map((part) => part.text)

    expect(v2Texts).toEqual(v1Output.system)

    rmSync(projectDir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// The one asserted divergence: destructive-verb confirmation (V1 only)
// ---------------------------------------------------------------------------

describe('adapter conformance — destructive verb confirmation', () => {
  it('V1 asks via context.ask and does not spawn on denial', async () => {
    const mockV1Exec = createMockExec()
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', exec: mockV1Exec })
    const v1Ctx = makeV1Context({ ask: jest.fn().mockRejectedValue(new Error('denied')) })
    const v1Result = JSON.parse(
      await v1Plugin.tool.openspec_cli.execute({ command: 'archive my-change --yes' }, v1Ctx),
    )
    expect(v1Ctx.ask).toHaveBeenCalledTimes(1)
    expect(v1Result).toEqual({ cancelled: true })
    expect(mockV1Exec.records).toHaveLength(0)
  })

  it('V2 runs the same command with the same argv and result as an approved V1 call', async () => {
    const response = { stdout: 'archived', stderr: '', exitCode: 0 }
    const mockV1Exec = createMockExec(response)
    const v1Plugin = await OpenSpecPluginV1({ client: createMockV1Client(), directory: '/project', exec: mockV1Exec })
    const v1Result = JSON.parse(
      await v1Plugin.tool.openspec_cli.execute({ command: 'archive my-change --yes' }, makeV1Context()),
    )

    const mockV2Exec = createMockExec(response)
    const v2Ctx = createFakeV2Ctx({ directory: '/project' })
    await pluginV2.setup(v2Ctx, { exec: mockV2Exec })
    const v2Result = JSON.parse(
      (await v2Ctx._editor.get('openspec_cli').execute({ command: 'archive my-change --yes' }, { sessionID: 's1' })).content,
    )

    expect(v2Result).toEqual(v1Result)
    expect(mockV2Exec.records.filter((r) => r.cmd.includes('archive'))).toEqual(
      mockV1Exec.records.filter((r) => r.cmd.includes('archive')),
    )
  })
})
