// One run at a time per run folder (ab.ts, resend.ts): two runs on one folder would each send every
// job, and in ab.ts one's repair of a cut line could drop the other's row.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Whether process `pid` is running; one owned by another user answers EPERM, and is running. */
function isRunning(pid: number): boolean {
  try {
    return process.kill(pid, 0)
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/**
 * Holds `out` for this process until it exits, before anything costly runs. A lock whose process has
 * gone, as after a crash, is taken over. Throws where a running process holds the folder.
 */
export function lock(out: string) {
  mkdirSync(out, { recursive: true })
  const file = join(out, 'run.lock')
  try {
    writeFileSync(file, String(process.pid), { flag: 'wx' })
  } catch {
    const holder = Number(readFileSync(file, 'utf8'))
    if (Number.isInteger(holder) && holder > 0 && isRunning(holder)) throw new Error(`${out} is in use by another run (process ${holder}); wait for it, or use another --out`)
    writeFileSync(file, String(process.pid))
  }
  process.on('exit', () => rmSync(file, { force: true }))
}
