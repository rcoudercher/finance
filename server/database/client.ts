import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

export function databasePath(): string {
  return resolve(process.env.DATABASE_PATH ?? './data/finance.sqlite')
}

/** Open a SQLite database with WAL and foreign keys enabled. */
export function openDatabase(path = databasePath()): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('synchronous = NORMAL')
  return drizzle({ client: sqlite, schema }) as DB
}

export function migrationsFolder(): string {
  return resolve(process.env.MIGRATIONS_PATH ?? './server/database/migrations')
}

export function runMigrations(db: DB, folder = migrationsFolder()): void {
  migrate(db, { migrationsFolder: folder })
}
