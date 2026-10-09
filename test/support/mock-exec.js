// Fake of the `exec` capability (src/lib/exec.js). Records each call as
// { cmd: 'openspec <argv...>', argv, cwd, timeoutMs }; `calls` holds the cmd strings.

/**
 * @param {object|Error|((argv: string[]) => object)} [response]
 *   An Error rejects every call (spawn failure); a function picks a response per argv.
 */
export function createMockExec(response = { stdout: '', stderr: '', exitCode: 0 }) {
  const records = []
  async function exec(argv, { cwd, timeoutMs } = {}) {
    records.push({ cmd: `openspec ${argv.join(' ')}`, argv, cwd, timeoutMs })
    const r = typeof response === 'function' ? response(argv) : response
    if (r instanceof Error) throw r
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? 0, timedOut: r.timedOut ?? false }
  }
  exec.records = records
  Object.defineProperty(exec, 'calls', { get: () => records.map((r) => r.cmd) })
  return exec
}
