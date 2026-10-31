// Online SQLite backup: safe while the app is running (uses SQLite's backup API, includes WAL contents).
// Usage: node scripts/backup.mjs [backupDir]   (default ~/backups/finance; keeps BACKUP_KEEP_DAYS=30 days)
import { createReadStream, createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import Database from 'better-sqlite3'

const source = resolve(process.env.DATABASE_PATH ?? './data/finance.sqlite')
const dir = resolve(process.argv[2] ?? join(homedir(), 'backups', 'finance'))
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 30)
mkdirSync(dir, { recursive: true, mode: 0o700 })

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) // 2026-10-31-18-05-00 (UTC)
const tmp = join(dir, `.finance-${stamp}.sqlite`)
const final = join(dir, `finance-${stamp}.sqlite.gz`)

const db = new Database(source, { readonly: true, fileMustExist: true })
await db.backup(tmp)
db.close()

// Verify the snapshot before keeping it.
const check = new Database(tmp)
check.pragma('journal_mode = DELETE') // self-contained file, no -wal/-shm siblings
const integrity = check.pragma('integrity_check', { simple: true })
const counts = check.prepare('select (select count(*) from assets) a, (select count(*) from valuations) v').get()
check.close()
if (integrity !== 'ok') {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) rmSync(f, { force: true })
  throw new Error(`Backup integrity check failed: ${integrity}`)
}

await pipeline(createReadStream(tmp), createGzip({ level: 9 }), createWriteStream(`${final}.part`, { mode: 0o600 }))
renameSync(`${final}.part`, final)
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) rmSync(f, { force: true })

// Rotate.
const cutoff = Date.now() - keepDays * 86_400_000
let removed = 0
for (const f of readdirSync(dir)) {
  if (/^finance-.*\.sqlite\.gz$/.test(f) && statSync(join(dir, f)).mtimeMs < cutoff) {
    rmSync(join(dir, f))
    removed++
  }
}
console.log(`${new Date().toISOString()} backup ok: ${final} (${counts.a} assets, ${counts.v} valuations, ${statSync(final).size} bytes, ${removed} old removed)`)
