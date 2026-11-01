import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
  check('assets_currency_check', sql`${t.currency} in ('EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'BTC')`),
  check('assets_name_check', sql`length(trim(${t.name})) > 0`),
])

export const valuations = sqliteTable('valuations', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  date: text('date').notNull(), // YYYY-MM-DD calendar date (Europe/Paris)
  value: integer('value', { mode: 'number' }).notNull(), // integer minor units
  // Optional: total net amount paid into the asset up to this date, in EUR cents, whatever the asset's currency
  // (deposits minus withdrawals, as a broker shows it, e.g. a PEA's "Versements"). Null = not tracked.
  paidIn: integer('paid_in', { mode: 'number' }),
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

// Daily EUR rates used to convert non-EUR assets (BTC) for totals: 1 unit of `currency` = `rate` EUR on `date`.
// Stored as an exact decimal string. One rate per currency per day.
export const rates = sqliteTable('rates', {
  currency: text('currency').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  rate: text('rate').notNull(), // decimal string, EUR per unit, e.g. "69987.075"
  source: text('source').notNull(), // e.g. "coinbase:spot", "coinbase:daily-close"
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [
  primaryKey({ columns: [t.currency, t.date] }),
  check('rates_currency_check', sql`${t.currency} in ('BTC')`),
  check('rates_date_check', sql`${t.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
  check('rates_rate_check', sql`${t.rate} glob '[0-9]*' and ${t.rate} not glob '*[^0-9.]*'`),
])

// Budget: recurring monthly items (income or expense). Their amounts are versioned by month: each
// row in budget_amounts sets the item's monthly amount from that month on, until the next row. 0 = stopped.
export const BUDGET_KINDS = ['income', 'expense'] as const

export const budgetItems = sqliteTable('budget_items', {
  id: text('id').primaryKey(), // lowercase ULID
  name: text('name').notNull(),
  kind: text('kind', { enum: BUDGET_KINDS }).notNull(),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [
  check('budget_items_kind_check', sql`${t.kind} in ('income', 'expense')`),
  check('budget_items_name_check', sql`length(trim(${t.name})) > 0`),
])

export const budgetAmounts = sqliteTable('budget_amounts', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => budgetItems.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  month: text('month').notNull(), // YYYY-MM, effective from this month on
  amount: integer('amount', { mode: 'number' }).notNull(), // EUR cents per month, >= 0 (0 = stopped)
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [
  uniqueIndex('budget_amounts_item_month_unique').on(t.itemId, t.month),
  index('budget_amounts_month_idx').on(t.month),
  check('budget_amounts_month_check', sql`${t.month} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'`),
  check('budget_amounts_amount_check', sql`typeof(${t.amount}) = 'integer' and ${t.amount} >= 0 and ${t.amount} <= 999999999999999`),
])

export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert
export type Valuation = typeof valuations.$inferSelect
export type NewValuation = typeof valuations.$inferInsert
export type Rate = typeof rates.$inferSelect
export type BudgetItem = typeof budgetItems.$inferSelect
export type BudgetAmount = typeof budgetAmounts.$inferSelect
