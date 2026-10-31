import { databasePath, openDatabase } from '../server/database/client'
import { seedDemo } from '../server/database/seed'

const db = openDatabase()
const result = seedDemo(db)
db.$client.close()
console.log(`Seeded ${databasePath()}: +${result.insertedAssets}/${result.totalAssets} assets, +${result.insertedValuations}/${result.totalValuations} valuations (existing rows untouched)`)
