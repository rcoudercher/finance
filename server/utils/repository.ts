import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import type { DB } from '../database/client'
import { assets, valuations, type Asset, type Valuation } from '../database/schema'
import { minorToDecimal } from '../../shared/utils/money'
import { parisDate } from '../../shared/utils/dates'
import { computeDashboard, RangeError400, resolveColors, type RangePreset } from '../../shared/utils/finance'
import { assetCreateSchema, assetUpdateSchema, valuationCreateSchema, valuationUpdateSchema } from '../../shared/utils/validation'

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

export function serializeValuation(v: Valuation) {
  return {
    id: v.id,
    assetId: v.assetId,
    date: v.date,
    value: minorToDecimal(v.value),
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

export function listAssets(db: DB) {
  const rows = db.select().from(assets).orderBy(asc(assets.createdAt), asc(assets.id)).all()
  const counts = valuationCounts(db)
  const colors = resolveColors(rows)
  const today = parisDate()
  return rows.map((a) => {
    const latest = latestValuation(db, a.id, today)
    return {
      ...serializeAsset(a, counts.get(a.id) ?? 0, colors.get(a.id)!),
      latestValuation: latest ? serializeValuation(latest) : null,
    }
  })
}

function latestValuation(db: DB, assetId: string, today: string) {
  return db.select().from(valuations)
    .where(and(eq(valuations.assetId, assetId), lte(valuations.date, today)))
    .orderBy(desc(valuations.date)).limit(1).get()
}

function findAsset(db: DB, id: string): Asset {
  const row = db.select().from(assets).where(eq(assets.id, id)).get()
  if (!row) throw new DomainError(404, 'Asset not found')
  return row
}

function countValuations(db: DB, assetId: string): number {
  return db.select({ n: count() }).from(valuations).where(eq(valuations.assetId, assetId)).get()?.n ?? 0
}

export function getAsset(db: DB, id: string) {
  const a = findAsset(db, id)
  const latest = latestValuation(db, id, parisDate())
  return {
    ...serializeAsset(a, countValuations(db, id), colorsFor(db).get(id)!),
    latestValuation: latest ? serializeValuation(latest) : null,
  }
}

export function createAsset(db: DB, input: z.output<typeof assetCreateSchema>, now = new Date()) {
  const row: Asset = { id: randomUUID(), ...input, createdAt: now, updatedAt: now }
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

export function listValuations(db: DB, assetId: string, range: { from?: string, to?: string }) {
  findAsset(db, assetId)
  const conds = [eq(valuations.assetId, assetId)]
  if (range.from) conds.push(gte(valuations.date, range.from))
  if (range.to) conds.push(lte(valuations.date, range.to))
  return db.select().from(valuations).where(and(...conds)).orderBy(desc(valuations.date)).all().map(serializeValuation)
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
  findAsset(db, assetId)
  const now = new Date()
  const row: Valuation = { id: randomUUID(), assetId, ...input, createdAt: now, updatedAt: now }
  wrapUnique(() => db.insert(valuations).values(row).run())
  return serializeValuation(row)
}

export function updateValuation(db: DB, id: string, input: z.output<typeof valuationUpdateSchema>) {
  const current = db.select().from(valuations).where(eq(valuations.id, id)).get()
  if (!current) throw new DomainError(404, 'Valuation not found')
  if (input.date) assertNotFuture(input.date)
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
  wrapUnique(() => db.update(valuations).set({ ...patch, updatedAt: new Date() }).where(eq(valuations.id, id)).run())
  return serializeValuation(db.select().from(valuations).where(eq(valuations.id, id)).get()!)
}

export function deleteValuation(db: DB, id: string) {
  const result = db.delete(valuations).where(eq(valuations.id, id)).run()
  if (result.changes === 0) throw new DomainError(404, 'Valuation not found')
}

export function dashboard(db: DB, q: { range?: RangePreset, from?: string, to?: string }, today = parisDate()) {
  const allAssets = db.select().from(assets).all()
  const allValuations = db.select({ id: valuations.id, assetId: valuations.assetId, date: valuations.date, value: valuations.value })
    .from(valuations).all()
  try {
    return computeDashboard(allAssets, allValuations, { today, preset: q.range ?? null, from: q.from, to: q.to })
  }
  catch (e) {
    if (e instanceof RangeError400) throw new DomainError(400, e.message)
    throw e
  }
}
