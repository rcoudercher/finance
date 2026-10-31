import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dbCredentials: { url: process.env.DATABASE_PATH ?? './data/finance.sqlite' },
  strict: true,
  verbose: true,
})
