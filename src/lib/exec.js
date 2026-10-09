// src/lib/exec.js
// Spawns the `openspec` CLI with a hard timeout. Replaces the host-supplied
// Bun `$`, which has no kill API: a Promise.race timeout would leave the child
// (e.g. an `archive`) running after the tool reported failure.
//
// Not exported from the plugin entrypoints (see src/plugin.v1.js header): the
// plugin loader invokes every named export of a plugin module.

import { spawn } from 'node:child_process'

const DEFAULT_GRACE_MS = 2000

/**
 * @param {{ command?: string, graceMs?: number }} [opts]
 * @returns {(argv: string[], run: { cwd: string, timeoutMs: number }) =>
 *   Promise<{ stdout: string, stderr: string, exitCode: number | null, timedOut: boolean }>}
 *   Rejects only when the process cannot be spawned (e.g. ENOENT).
 */
export function createExec({ command = 'openspec', graceMs = DEFAULT_GRACE_MS } = {}) {
  return (argv, { cwd, timeoutMs }) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false
      const timers = []

      const finish = (exitCode) => {
        if (settled) return
        settled = true
        timers.forEach(clearTimeout)
        resolve({ stdout, stderr, exitCode, timedOut })
      }
      const signalGroup = (sig) => {
        try {
          process.kill(-child.pid, sig)
        } catch {
          child.kill(sig)
        }
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', (err) => {
        if (settled) return
        settled = true
        timers.forEach(clearTimeout)
        reject(err)
      })
      child.on('close', (code) => finish(timedOut ? null : code))

      timers.push(
        setTimeout(() => {
          timedOut = true
          signalGroup('SIGTERM')
          timers.push(
            setTimeout(() => {
              signalGroup('SIGKILL')
              // Settle even if the process never closes, so the tool cannot hang.
              timers.push(setTimeout(() => finish(null), graceMs))
            }, graceMs),
          )
        }, timeoutMs),
      )
    })
}
