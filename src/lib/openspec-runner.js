// src/lib/openspec-runner.js
// Spawns the `openspec` CLI and shapes its output. Not exported from
// src/index.js (see that file's top comment): opencode-ai@dev's plugin
// loader speculatively invokes every named export of a plugin module with
// the same argument it passes to the real factory, and these functions'
// positional, type-assuming parameters throw when given a mismatched
// argument — crashing the whole module's load. Import them here directly.

import { logError } from './helpers.js'

/**
 * Run `openspec <argsArray>` in cwd.
 * Returns { stdout, stderr, exitCode }. A non-zero exit is a normal result, not an error.
 * Throws on infrastructure failure (spawn error, openspec not on PATH).
 *
 * @param {Function} $ - Bun shell tagged-template-literal function
 * @param {string} cwd
 * @param {string[]} argsArray
 * @returns {Promise<{stdout:string, stderr:string, exitCode:number}>}
 */
export async function runOpenspec($, cwd, argsArray) {
  const proc = await $`openspec ${argsArray}`.cwd(cwd).quiet().nothrow()
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 0,
  }
}

/**
 * Populate (or refresh) the injection cache entry for a project directory.
 * Runs `openspec list --json` and stores parsed changes.
 *
 * @param {Map<string, object>} cacheByDir
 * @param {Function} $
 * @param {object} client
 * @param {string} dir
 */
export async function populateCache(cacheByDir, $, client, dir) {
  try {
    const proc = await $`openspec list --json`.cwd(dir).quiet().nothrow()
    let changes = []
    try {
      const parsed = JSON.parse(proc.stdout.toString())
      changes = (parsed.changes ?? []).map(c => ({
        name: c.name,
        done: c.completedTasks ?? 0,
        total: c.totalTasks ?? 0,
      }))
    } catch {
      // JSON parse failure — leave changes empty, cache still marked present
    }
    cacheByDir.set(dir, { present: true, changes, at: Date.now() })
  } catch (err) {
    logError(client, `populateCache failed for ${dir}`, err)
    if (!cacheByDir.has(dir)) {
      cacheByDir.set(dir, { present: true, changes: [], at: Date.now() })
    }
  }
}
