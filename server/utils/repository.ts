import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DB } from '../database/client'
import { assets, rates, valuations, type Asset, type Valuation } from '../database/schema'
import { CONVERTED_CURRENCIES, convertMinor, currencyDecimals, minorToDecimal, MoneyError, parseDecimalToMinor } from '../../shared/utils/money'
import { parisDate } from '../../shared/utils/dates'
import { isUlid, ulid } from '../../shared/utils/ulid'
import { computeDashboard, isAggregated, latestOnOrBefore, RangeError400, resolveColors, STALE_AFTER_DAYS, type RangePreset } from '../../shared/utils/finance'
import { computePerformance } from '../../shared/utils/performance'
import { diffDays } from '../../shared/utils/dates'
import { assetCreateSchema, assetUpdateSchema, ratesUpsertSchema, valuationCreateSchema, valuationUpdateSchema } from '../../shared/utils/validation'

// Domain errors mapped to HTTP status codes by the route handlers.
export class DomainError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message)
  }
}

export function serializeAsset(a: Asset, valuationCount: number, color: string) {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    currency: a.currency,
    description: a.description,
    color: a.color,
    displayColor: color,
    currencyLocked: valuationCount > 0,
    valuationCount,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }
}

/** `currency` is the asset's currency; it sets the decimals of `value` (2 for fiat, 8 for BTC). */
export function serializeValuation(v: Valuation, currency: string) {
  return {
    id: v.id,
    assetId: v.assetId,
    date: v.date,
    value: minorToDecimal(v.value, currencyDecimals(currency)),
    /** EUR, whatever the asset's currency. */
    paidIn: v.paidIn == null ? null : minorToDecimal(v.paidIn),
    source: v.source,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }
}

export type AssetDTO = ReturnType<typeof serializeAsset>
export type ValuationDTO = ReturnType<typeof serializeValuation>

function valuationCounts(db: DB): Map<string, number> {
  const rows = db.select({ assetId: valuations.assetId, n: count() }).from(valuations).groupBy(valuations.assetId).all()
  return new Map(rows.map(r => [r.assetId, r.n]))
}

function colorsFor(db: DB) {
  const all = db.select().from(assets).all()
  return resolveColors(all)
}

/**
 * Current EUR value of a converted asset (BTC): latest balance x latest rate, both on or before today.
 * Null for EUR and other currencies, or when there is no balance or rate yet.
 */
function latestEurValue(db: DB, a: Asset, latest: Valuation | undefined, today: string) {
  if (!latest || !CONVERTED_CURRENCIES.includes(a.currency)) return null
  const rate = db.select().from(rates)
    .where(and(eq(rates.currency, a.currency), lte(rates.date, today)))
    .orderBy(desc(rates.date)).limit(1).get()
  if (!rate) return null
  return {
    value: minorToDecimal(convertMinor(latest.value, currencyDecimals(a.currency), rate.rate)),
    rate: rate.rate,
    rateDate: rate.date,
    rateStale: diffDays(today, rate.date) > STALE_AFTER_DAYS,
  }
}

/**
 * Gains and return from the valuations that record a paid-in amount (on or before today), valued in EUR
 * (BTC with the rate on each date). Null when none does, or for currencies that are not converted to EUR.
 */
function assetPerformance(db: DB, a: Asset, today: string) {
  if (!isAggregated(a.currency)) return null
  const tracked = db.select().from(valuations)
    .where(and(eq(valuations.assetId, a.id), lte(valuations.date, today), isNotNull(valuations.paidIn)))
    .orderBy(asc(valuations.date)).all()
  if (!tracked.length) return null
  const assetRates = CONVERTED_CURRENCIES.includes(a.currency)
    ? db.select({ date: rates.date, rate: rates.rate }).from(rates).where(eq(rates.currency, a.currency)).orderBy(asc(rates.date)).all()
    : []
  const observations = []
  for (const v of tracked) {
    let cents = v.value
    if (CONVERTED_CURRENCIES.includes(a.currency)) {
      const rate = latestOnOrBefore(assetRates, v.date)
      if (!rate) continue
      cents = Number(convertMinor(v.value, currencyDecimals(a.currency), rate.rate))
    }
    observations.push({ date: v.date, valueCents: cents, paidInCents: v.paidIn! })
  }
  return computePerformance(observations)
}

function withLatest(db: DB, a: Asset, valuationCount: number, color: string, today: string) {
  const latest = latestValuation(db, a.id, today)
  return {
    ...serializeAsset(a, valuationCount, color),
    latestValuation: latest ? serializeValuation(latest, a.currency) : null,
    latestEurValue: latestEurValue(db, a, latest, today),
    performance: assetPerformance(db, a, today),
  }
}

export function listAssets(db: DB) {
  const rows = db.select().from(assets).orderBy(asc(assets.createdAt), asc(assets.id)).all()
  const counts = valuationCounts(db)
  const colors = resolveColors(rows)
  const today = parisDate()
  return rows.map(a => withLatest(db, a, counts.get(a.id) ?? 0, colors.get(a.id)!, today))
}

function latestValuation(db: DB, assetId: string, today: string) {
  return db.select().from(valuations)
    .where(and(eq(valuations.assetId, assetId), lte(valuations.date, today)))
    .orderBy(desc(valuations.date)).limit(1).get()
}

function findAsset(db: DB, id: string): Asset {
  if (!isUlid(id)) throw new DomainError(404, 'Asset not found')
  const row = db.select().from(assets).where(eq(assets.id, id)).get()
  if (!row) throw new DomainError(404, 'Asset not found')
  return row
}

function countValuations(db: DB, assetId: string): number {
  return db.select({ n: count() }).from(valuations).where(eq(valuations.assetId, assetId)).get()?.n ?? 0
}

export function getAsset(db: DB, id: string) {
  const a = findAsset(db, id)
  return withLatest(db, a, countValuations(db, id), colorsFor(db).get(id)!, parisDate())
}

export function createAsset(db: DB, input: z.output<typeof assetCreateSchema>, now = new Date()) {
  const row: Asset = { id: ulid(now), ...input, createdAt: now, updatedAt: now }
  db.insert(assets).values(row).run()
  return getAsset(db, row.id)
}

export function updateAsset(db: DB, id: string, input: z.output<typeof assetUpdateSchema>) {
  return db.transaction((tx) => {
    const current = findAsset(tx as unknown as DB, id)
    if (input.currency && input.currency !== current.currency && countValuations(tx as unknown as DB, id) > 0) {
      throw new DomainError(409, 'Currency is locked once the asset has a valuation')
    }
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
    tx.update(assets).set({ ...patch, updatedAt: new Date() }).where(eq(assets.id, id)).run()
    return getAsset(tx as unknown as DB, id)
  })
}

/** Permanently delete an asset and all of its valuations in one transaction. Returns how many valuations were removed. */
export function deleteAsset(db: DB, id: string): { valuationsDeleted: number } {
  return db.transaction((tx) => {
    findAsset(tx as unknown as DB, id)
    const removed = tx.delete(valuations).where(eq(valuations.assetId, id)).run()
    tx.delete(assets).where(eq(assets.id, id)).run()
    return { valuationsDeleted: removed.changes }
  })
}

export function listValuations(db: DB, assetId: string, range: { from?: string, to?: string }) {
  const asset = findAsset(db, assetId)
  const conds = [eq(valuations.assetId, assetId)]
  if (range.from) conds.push(gte(valuations.date, range.from))
  if (range.to) conds.push(lte(valuations.date, range.to))
  return db.select().from(valuations).where(and(...conds)).orderBy(desc(valuations.date)).all().map(v => serializeValuation(v, asset.currency))
}

/** Decimal string -> minor units with the currency's precision (2 decimals for fiat, 8 for BTC). */
function toMinor(value: string, currency: string): number {
  try {
    return parseDecimalToMinor(value, currencyDecimals(currency))
  }
  catch (e) {
    if (e instanceof MoneyError) throw new DomainError(400, `${currency} amount: ${e.message}`)
    throw e
  }
}

function assertNotFuture(date: string) {
  if (date > parisDate()) throw new DomainError(400, 'Valuation date cannot be in the future')
}

/** True when a better-sqlite3 error is a UNIQUE constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}

function wrapUnique<T>(fn: () => T): T {
  try {
    return fn()
  }
  catch (e) {
    if (isUniqueViolation(e)) throw new DomainError(409, 'A valuation already exists for this asset on this date')
    throw e
  }
}

export function createValuation(db: DB, assetId: string, input: z.output<typeof valuationCreateSchema>) {
  assertNotFuture(input.date)
  const asset = findAsset(db, assetId)
  const now = new Date()
  const row: Valuation = { id: randomUUID(), assetId, ...input, value: toMinor(input.value, asset.currency), paidIn: input.paidIn ?? null, createdAt: now, updatedAt: now }
  wrapUnique(() => db.insert(valuations).values(row).run())
  return serializeValuation(row, asset.currency)
}

export function updateValuation(db: DB, id: string, input: z.output<typeof valuationUpdateSchema>) {
  const current = db.select().from(valuations).where(eq(valuations.id, id)).get()
  if (!current) throw new DomainError(404, 'Valuation not found')
  if (input.date) assertNotFuture(input.date)
  const asset = findAsset(db, current.assetId)
  const { value, ...rest } = input
  const patch: Partial<Valuation> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  if (value !== undefined) patch.value = toMinor(value, asset.currency)
  wrapUnique(() => db.update(valuations).set({ ...patch, updatedAt: new Date() }).where(eq(valuations.id, id)).run())
  return serializeValuation(db.select().from(valuations).where(eq(valuations.id, id)).get()!, asset.currency)
}

export function deleteValuation(db: DB, id: string) {
  const result = db.delete(valuations).where(eq(valuations.id, id)).run()
  if (result.changes === 0) throw new DomainError(404, 'Valuation not found')
}

export function dashboard(db: DB, q: { range?: RangePreset, from?: string, to?: string }, today = parisDate()) {
  const allAssets = db.select().from(assets).all()
  const allValuations = db.select({ id: valuations.id, assetId: valuations.assetId, date: valuations.date, value: valuations.value })
    .from(valuations).all()
  const allRates = db.select({ currency: rates.currency, date: rates.date, rate: rates.rate }).from(rates).all()
  try {
    return computeDashboard(allAssets, allValuations, { today, preset: q.range ?? null, from: q.from, to: q.to, rates: allRates })
  }
  catch (e) {
    if (e instanceof RangeError400) throw new DomainError(400, e.message)
    throw e
  }
}

export function listRates(db: DB, q: { currency: string, from?: string, to?: string }) {
  const conds = [eq(rates.currency, q.currency)]
  if (q.from) conds.push(gte(rates.date, q.from))
  if (q.to) conds.push(lte(rates.date, q.to))
  return db.select({ date: rates.date, rate: rates.rate, source: rates.source }).from(rates)
    .where(and(...conds)).orderBy(asc(rates.date)).all()
}

/** Insert or replace daily rates for one currency. Future dates are rejected. */
export function upsertRates(db: DB, input: z.output<typeof ratesUpsertSchema>, now = new Date()) {
  const today = parisDate(now)
  for (const r of input.rates) {
    if (r.date > today) throw new DomainError(400, `Rate date ${r.date} is in the future`)
  }
  return db.transaction((tx) => {
    for (const r of input.rates) {
      tx.insert(rates)
        .values({ currency: input.currency, date: r.date, rate: r.rate, source: input.source, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [rates.currency, rates.date],
          set: { rate: sql`excluded.rate`, source: sql`excluded.source`, updatedAt: now },
        })
        .run()
    }
    return { currency: input.currency, upserted: input.rates.length }
  })
}
