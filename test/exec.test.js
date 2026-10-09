// test/exec.test.js
// spec: openspec/changes/full-cli-support/specs/tools/spec.md
// Real child processes: the timeout/kill contract cannot be shown with fakes.

import { createExec } from '../src/lib/exec.js'

const node = (code) => createExec({ command: process.execPath, graceMs: 200 })(['-e', code], { cwd: process.cwd(), timeoutMs: 5000 })

describe('exec', () => {
  it('returns stdout, stderr and exit code', async () => {
    const r = await node(`console.log('out'); console.error('err'); process.exit(3)`)
    expect(r).toMatchObject({ stdout: 'out\n', stderr: 'err\n', exitCode: 3, timedOut: false })
  })

  it('closes stdin so a reader sees EOF immediately', async () => {
    const r = await node(`process.stdin.on('end',()=>console.log('eof')); process.stdin.resume()`)
    expect(r.stdout).toBe('eof\n')
  })

  it('passes the host environment through unchanged', async () => {
    const r = await node(`console.log(process.env.PATH)`)
    expect(r.stdout).toBe(`${process.env.PATH}\n`)
  })

  it('Hanging command is killed at the timeout, returning partial output', async () => {
    const run = createExec({ command: process.execPath, graceMs: 200 })
    const started = Date.now()
    const r = await run(['-e', `console.log('partial'); setInterval(()=>{},1000)`], { cwd: process.cwd(), timeoutMs: 500 })
    expect(r).toMatchObject({ timedOut: true, exitCode: null })
    expect(r.stdout).toBe('partial\n')
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('kills a child that ignores SIGTERM after the grace period', async () => {
    const run = createExec({ command: process.execPath, graceMs: 200 })
    const r = await run(['-e', `process.on('SIGTERM',()=>{}); console.log('up'); setInterval(()=>{},1000)`],
      { cwd: process.cwd(), timeoutMs: 500 })
    expect(r.timedOut).toBe(true)
  })

  it('kills grandchildren in the process group on timeout', async () => {
    const run = createExec({ command: process.execPath, graceMs: 200 })
    const code = `const {spawn}=require('child_process');
      const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
      console.log(g.pid); setInterval(()=>{},1000)`
    const r = await run(['-e', code], { cwd: process.cwd(), timeoutMs: 500 })
    const pid = Number(r.stdout.trim())
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/)
  })

  it('decodes multibyte output split across chunks', async () => {
    const r = await node(`const b=Buffer.from('é'); process.stdout.write(b.subarray(0,1)); setTimeout(()=>process.stdout.write(b.subarray(1)),50)`)
    expect(r.stdout).toBe('é')
  })

  it('rejects when the binary cannot be spawned', async () => {
    const run = createExec({ command: '/nonexistent/openspec-binary' })
    await expect(run([], { cwd: process.cwd(), timeoutMs: 1000 })).rejects.toThrow(/ENOENT/)
  })
})
