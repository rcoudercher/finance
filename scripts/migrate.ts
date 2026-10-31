import { databasePath, openDatabase, runMigrations } from '../server/database/client'

const db = openDatabase()
runMigrations(db)
db.$client.close()
console.log(`Migrations applied to ${databasePath()}`)
