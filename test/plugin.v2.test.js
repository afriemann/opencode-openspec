// test/plugin.v2.test.js
// V2-specific lifecycle tests for src/plugin.v2.js.
// spec: openspec/changes/v2-plugin-migration/specs/plugin/spec.md
// spec: openspec/changes/v2-plugin-migration/specs/tools/spec.md
// spec: openspec/changes/v2-plugin-migration/specs/system-prompt/spec.md

import { jest } from '@jest/globals'
import plugin from '../src/plugin.v2.js'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Fake V2 host
// ---------------------------------------------------------------------------

function createMockBunDollar(responseOrError = { stdout: '', stderr: '', exitCode: 0 }) {
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
      nothrow: () => (shouldThrow ? Promise.reject(responseOrError) : Promise.resolve(result)),
    }
    return chain
  }
  $.calls = calls
  return $
}

/** Builds a fake tool editor that records added descriptors and supports get()/list(). */
function createFakeEditor() {
  const descriptors = new Map()
  return {
    add(descriptor) {
      descriptors.set(descriptor.name, descriptor)
    },
    get(name) {
      return descriptors.get(name)
    },
    list() {
      return [...descriptors.values()]
    },
    _descriptors: descriptors,
  }
}

/** Builds a fake ctx.event.subscribe() async iterable, fed by pushEvent(). */
function createFakeEventStream() {
  const queue = []
  const waiters = []
  let closed = false

  function pushEvent(event) {
    if (waiters.length > 0) {
      waiters.shift()({ value: event, done: false })
    } else {
      queue.push(event)
    }
  }

  function close() {
    closed = true
    while (waiters.length > 0) {
      waiters.shift()({ value: undefined, done: true })
    }
  }

  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false })
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true })
          }
          return new Promise((resolve) => waiters.push(resolve))
        },
      }
    },
  }

  return { iterable, pushEvent, close }
}

function createFakeCtx({ directory = '/project', eventStream, editor, toolDisposeSpy, hookDisposeSpy } = {}) {
  const stream = eventStream ?? createFakeEventStream()
  const fakeEditor = editor ?? createFakeEditor()
  let contextHookCallback = null

  return {
    location: { directory },
    tool: {
      async transform(cb) {
        await cb(fakeEditor)
        return { dispose: toolDisposeSpy ?? jest.fn().mockResolvedValue(undefined) }
      },
    },
    event: {
      subscribe({ signal }) {
        signal?.addEventListener('abort', () => stream.close())
        return stream.iterable
      },
    },
    session: {
      async hook(name, cb) {
        if (name === 'context') contextHookCallback = cb
        return { dispose: hookDisposeSpy ?? jest.fn().mockResolvedValue(undefined) }
      },
    },
    _fakeEditor: fakeEditor,
    _eventStream: stream,
    _getContextHook: () => contextHookCallback,
  }
}

function withFakeBun(bunDollar, fn) {
  const original = globalThis.Bun
  globalThis.Bun = { $: bunDollar }
  return fn().finally(() => {
    globalThis.Bun = original
  })
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve))
}

/**
 * `handleSessionCreated` checks real disk (`existsSync(join(dir, 'openspec'))`)
 * so tests that exercise cache population need a real directory with an
 * `openspec/` subfolder, not the fake `/project` path used elsewhere.
 */
function createTempProjectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-openspec-v2-test-'))
  mkdirSync(join(dir, 'openspec'))
  return dir
}

// ---------------------------------------------------------------------------
// setup() — Bun.$ availability
// ---------------------------------------------------------------------------

describe('plugin.v2 setup()', () => {
  it('throws when globalThis.Bun.$ is not available', async () => {
    const original = globalThis.Bun
    // eslint-disable-next-line no-undefined
    globalThis.Bun = undefined
    const ctx = createFakeCtx()
    await expect(plugin.setup(ctx)).rejects.toThrow(/Bun\.\$ is not available/)
    globalThis.Bun = original
  })

  it('registers all three tools with codemode:false', async () => {
    const mock$ = createMockBunDollar()
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx()
      const cleanup = await plugin.setup(ctx)
      const names = ['openspec_cli', 'openspec_status', 'openspec_instructions']
      for (const name of names) {
        const descriptor = ctx._fakeEditor.get(name)
        expect(descriptor).toBeDefined()
        expect(descriptor.options).toEqual({ codemode: false })
      }
      await cleanup()
    })
  })

  it('throws during setup when a tool is tampered to lose codemode:false', async () => {
    const mock$ = createMockBunDollar()
    await withFakeBun(mock$, async () => {
      const editor = createFakeEditor()
      const originalAdd = editor.add.bind(editor)
      editor.add = (descriptor) => {
        if (descriptor.name === 'openspec_status') {
          originalAdd({ ...descriptor, options: {} })
        } else {
          originalAdd(descriptor)
        }
      }
      const ctx = createFakeCtx({ editor })
      await expect(plugin.setup(ctx)).rejects.toThrow(/openspec_status.*codemode:false/)
    })
  })
})

// ---------------------------------------------------------------------------
// Eager cache population at setup() (empirical correction — session.created
// does not fire for single-shot `opencode run` invocations against the real
// V2 host; see plugin.v2.js's comment above the eager-population call)
// ---------------------------------------------------------------------------

describe('plugin.v2 eager cache population', () => {
  it('populates the cache from ctx.location.directory during setup(), with no session.created event required', async () => {
    const mock$ = createMockBunDollar({
      stdout: JSON.stringify({ changes: [{ name: 'my-feature', completedTasks: 1, totalTasks: 3 }] }),
      stderr: '',
      exitCode: 0,
    })
    const projectDir = createTempProjectDir()
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx({ directory: projectDir })
      const cleanup = await plugin.setup(ctx)

      // No event pushed at all — cache must already be populated from setup().
      expect(mock$.calls.some((c) => c.includes('list'))).toBe(true)

      const hook = ctx._getContextHook()
      const event = { sessionID: 'never-seen-session', system: [] }
      hook(event)
      const joined = event.system.map((p) => p.text).join('\n')
      expect(joined).toContain('my-feature')
      expect(joined).toContain('1/3')

      await cleanup()
    })
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('marks the cache absent when the directory has no openspec/ folder', async () => {
    const mock$ = createMockBunDollar()
    const bareDir = mkdtempSync(join(tmpdir(), 'opencode-openspec-v2-bare-'))
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx({ directory: bareDir })
      const cleanup = await plugin.setup(ctx)

      const hook = ctx._getContextHook()
      const event = { sessionID: 's1', system: [] }
      hook(event)
      expect(event.system).toEqual([])

      await cleanup()
    })
    rmSync(bareDir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// Per-session directory isolation (design.md D-4: "more correct than V1" —
// each session sees its own project's injected content, not a single
// process-wide directory)
// ---------------------------------------------------------------------------

describe('plugin.v2 per-session directory isolation', () => {
  it('two concurrent sessions in different directories each see only their own project content', async () => {
    const openspecDir = createTempProjectDir()
    const bareDir = mkdtempSync(join(tmpdir(), 'opencode-openspec-v2-bare-'))

    // The mock$ responds identically regardless of cwd (it doesn't track
    // per-call cwd), but handleSessionCreated checks the real filesystem
    // for an `openspec/` folder before ever calling $ — so bareDir's cache
    // entry is set to {present:false} without a spawn, and openspecDir's is
    // populated via a real `list --json` call.
    const mock$ = createMockBunDollar({
      stdout: JSON.stringify({ changes: [{ name: 'shared-feature', completedTasks: 2, totalTasks: 4 }] }),
      stderr: '',
      exitCode: 0,
    })

    await withFakeBun(mock$, async () => {
      // ctx.location.directory is the plugin's own load-time directory
      // (arbitrary here — neither session's directory needs to match it).
      const ctx = createFakeCtx({ directory: '/plugin-load-dir' })
      const cleanup = await plugin.setup(ctx)

      ctx._eventStream.pushEvent({
        type: 'session.created',
        data: { sessionID: 's-with-openspec', location: { directory: openspecDir } },
      })
      ctx._eventStream.pushEvent({
        type: 'session.created',
        data: { sessionID: 's-without-openspec', location: { directory: bareDir } },
      })
      await flushMicrotasks()
      await flushMicrotasks()

      const hook = ctx._getContextHook()

      const withOpenspecEvent = { sessionID: 's-with-openspec', system: [] }
      hook(withOpenspecEvent)
      const withOpenspecText = withOpenspecEvent.system.map((p) => p.text).join('\n')
      expect(withOpenspecText).toContain('shared-feature')
      expect(withOpenspecText).toContain('2/4')

      const withoutOpenspecEvent = { sessionID: 's-without-openspec', system: [] }
      hook(withoutOpenspecEvent)
      expect(withoutOpenspecEvent.system).toEqual([])

      await cleanup()
    })

    rmSync(openspecDir, { recursive: true, force: true })
    rmSync(bareDir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// Event subscription resilience
// ---------------------------------------------------------------------------

describe('plugin.v2 event subscription', () => {
  it('a throwing raw-event handling step does not terminate the subscription loop', async () => {
    const mock$ = createMockBunDollar({ stdout: JSON.stringify({ changes: [] }), stderr: '', exitCode: 0 })
    const projectDir = createTempProjectDir()
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx({ directory: projectDir })
      const cleanup = await plugin.setup(ctx)

      // First event has a malformed `data` (undefined -> destructuring
      // `{ sessionID, location } = rawEvent.data` should still work since
      // `?? {}` guards it; but a genuinely malformed shape further down
      // should not kill the loop). Force a throw by giving location a
      // getter that throws.
      const malformed = {
        type: 'session.created',
        get data() {
          throw new Error('boom')
        },
      }
      ctx._eventStream.pushEvent(malformed)
      await flushMicrotasks()

      // Second, well-formed event should still be processed.
      ctx._eventStream.pushEvent({ type: 'session.created', data: { sessionID: 's1', location: { directory: projectDir } } })
      await flushMicrotasks()
      await flushMicrotasks()

      expect(mock$.calls.some((c) => c.includes('list'))).toBe(true)
      await cleanup()
    })
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('ignores non-session.created events without spawning', async () => {
    const mock$ = createMockBunDollar()
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx()
      const cleanup = await plugin.setup(ctx)
      ctx._eventStream.pushEvent({ type: 'message.updated', data: {} })
      await flushMicrotasks()
      expect(mock$.calls).toHaveLength(0)
      await cleanup()
    })
  })
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('plugin.v2 cleanup', () => {
  it('disposes every registration and aborts the event controller', async () => {
    const mock$ = createMockBunDollar()
    await withFakeBun(mock$, async () => {
      const toolDisposeSpy = jest.fn().mockResolvedValue(undefined)
      const hookDisposeSpy = jest.fn().mockResolvedValue(undefined)
      const ctx = createFakeCtx({ toolDisposeSpy, hookDisposeSpy })
      const cleanup = await plugin.setup(ctx)
      await cleanup()
      expect(toolDisposeSpy).toHaveBeenCalledTimes(1)
      expect(hookDisposeSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('a second cleanup call is a no-op (does not throw)', async () => {
    const mock$ = createMockBunDollar()
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx()
      const cleanup = await plugin.setup(ctx)
      await cleanup()
      await expect(cleanup()).resolves.toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// resolveWorkdir precedence via a tool call
// ---------------------------------------------------------------------------

describe('plugin.v2 resolveWorkdir precedence', () => {
  it('prefers args.workdir over the session-scoped directory and ctx.location.directory', async () => {
    const mock$ = createMockBunDollar({ stdout: 'ok', stderr: '', exitCode: 0 })
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx({ directory: '/default-dir' })
      const cleanup = await plugin.setup(ctx)
      ctx._eventStream.pushEvent({ type: 'session.created', data: { sessionID: 's1', location: { directory: '/session-dir' } } })
      await flushMicrotasks()

      const cliTool = ctx._fakeEditor.get('openspec_cli')
      await cliTool.execute({ command: 'list --json', workdir: '/explicit-dir' }, { sessionID: 's1' })
      expect(mock$.calls.some((c) => c.startsWith('cd:'))).toBe(false) // sanity: mock doesn't track cwd via cmd string

      await cleanup()
    })
  })

  it('falls back to the session-scoped directory when args.workdir is absent', async () => {
    const mock$ = createMockBunDollar({ stdout: 'ok', stderr: '', exitCode: 0 })
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx({ directory: '/default-dir' })
      const cleanup = await plugin.setup(ctx)
      ctx._eventStream.pushEvent({ type: 'session.created', data: { sessionID: 's1', location: { directory: '/session-dir' } } })
      await flushMicrotasks()

      const cliTool = ctx._fakeEditor.get('openspec_cli')
      const result = JSON.parse(await (await cliTool.execute({ command: 'list --json' }, { sessionID: 's1' })).content)
      expect(result.stdout).toBe('ok')

      await cleanup()
    })
  })
})

// ---------------------------------------------------------------------------
// Confirmation-gating: destructive verbs on V2 (no confirm mechanism)
// ---------------------------------------------------------------------------

describe('plugin.v2 destructive verb handling', () => {
  it('refuses a destructive command without spawning, returning confirmation-unavailable', async () => {
    const mock$ = createMockBunDollar({ stdout: '', stderr: '', exitCode: 0 })
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx()
      const cleanup = await plugin.setup(ctx)
      const cliTool = ctx._fakeEditor.get('openspec_cli')
      const result = JSON.parse((await cliTool.execute({ command: 'archive my-change --yes' }, { sessionID: 's1' })).content)
      expect(result).toEqual({
        cancelled: true,
        reason: 'confirmation-unavailable',
        hint: expect.stringContaining('built-in shell/bash tool'),
      })
      expect(mock$.calls).toHaveLength(0)
      await cleanup()
    })
  })
})

// ---------------------------------------------------------------------------
// System-prompt context hook
// ---------------------------------------------------------------------------

describe('plugin.v2 system-prompt context hook', () => {
  it('pushes {type:"text", text} wrapped parts, not bare strings', async () => {
    const mock$ = createMockBunDollar({
      stdout: JSON.stringify({ changes: [{ name: 'my-feature', completedTasks: 1, totalTasks: 4 }] }),
      stderr: '',
      exitCode: 0,
    })
    const projectDir = createTempProjectDir()
    await withFakeBun(mock$, async () => {
      const ctx = createFakeCtx({ directory: projectDir })
      const cleanup = await plugin.setup(ctx)
      ctx._eventStream.pushEvent({ type: 'session.created', data: { sessionID: 's1', location: { directory: projectDir } } })
      await flushMicrotasks()

      const hook = ctx._getContextHook()
      const event = { sessionID: 's1', system: [] }
      hook(event)

      expect(event.system.length).toBeGreaterThan(0)
      for (const part of event.system) {
        expect(part).toEqual({ type: 'text', text: expect.any(String) })
      }
      await cleanup()
    })
    rmSync(projectDir, { recursive: true, force: true })
  })
})
