import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const ASSET_CATEGORIES = ['bank', 'investment', 'crypto', 'real_estate', 'cash', 'other'] as const
export const VALUATION_SOURCES = ['manual', 'import', 'api'] as const

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category', { enum: ASSET_CATEGORIES }).notNull(),
  currency: text('currency').notNull(),
  description: text('description'),
  color: text('color'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [
  check('assets_category_check', sql`${t.category} in ('bank', 'investment', 'crypto', 'real_estate', 'cash', 'other')`),
  check('assets_currency_check', sql`${t.currency} in ('EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD')`),
  check('assets_name_check', sql`length(trim(${t.name})) > 0`),
])

export const valuations = sqliteTable('valuations', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  date: text('date').notNull(), // YYYY-MM-DD calendar date (Europe/Paris)
  value: integer('value', { mode: 'number' }).notNull(), // integer minor units
  source: text('source', { enum: VALUATION_SOURCES }).notNull().default('manual'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [
  uniqueIndex('valuations_asset_date_unique').on(t.assetId, t.date),
  index('valuations_date_idx').on(t.date),
  check('valuations_source_check', sql`${t.source} in ('manual', 'import', 'api')`),
  check('valuations_date_check', sql`${t.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
  check('valuations_value_check', sql`typeof(${t.value}) = 'integer' and abs(${t.value}) <= 999999999999999`),
])

export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert
export type Valuation = typeof valuations.$inferSelect
export type NewValuation = typeof valuations.$inferInsert
