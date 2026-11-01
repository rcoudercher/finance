import { databasePath, openDatabase, runMigrations } from '../server/database/client'

const db = openDatabase()
const { renamedAssets } = runMigrations(db)
db.$client.close()
console.log(`Migrations applied to ${databasePath()}`)
for (const { oldId, newId } of renamedAssets) console.log(`  asset ${oldId} -> ${newId}`)
