import { openDatabase, type DB } from '../database/client'

let instance: DB | undefined

/** Lazily opened, process-wide database connection. */
export function useDb(): DB {
  instance ??= openDatabase()
  return instance
}
