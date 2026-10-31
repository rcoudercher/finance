// Integration tests against a fresh, isolated SQLite database (in-memory) with real migrations.
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase, runMigrations, type DB } from '../server/database/client'
import { assets, valuations } from '../server/database/schema'
import { buildSeed, seedDates, seedDemo } from '../server/database/seed'
import {
  createAsset, createValuation, dashboard, deleteValuation, DomainError, getAsset, listValuations,
  updateAsset, updateValuation,
} from '../server/utils/repository'

let db: DB
beforeEach(() => {
  db = openDatabase(':memory:')
  runMigrations(db)
})

const expectDomain = (fn: () => unknown, status: number) => {
  try {
    fn()
  }
  catch (e) {
    expect(e).toBeInstanceOf(DomainError)
    expect((e as DomainError).status).toBe(status)
    return
  }
  throw new Error(`expected DomainError ${status}`)
}

describe('schema and constraints', () => {
  it('enables foreign keys and enforces them', () => {
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1)
    const now = new Date()
    expect(() => db.insert(valuations).values({ id: 'x', assetId: 'missing', date: '2024-01-01', value: 1, source: 'manual', createdAt: now, updatedAt: now }).run()).toThrow()
  })

  it('enforces unique (assetId, date) as a 409', () => {
    const a = createAsset(db, { name: 'A', category: 'bank', currency: 'EUR', description: null, color: null })
    createValuation(db, a.id, { date: '2024-01-01', value: 100, source: 'manual' })
    expectDomain(() => createValuation(db, a.id, { date: '2024-01-01', value: 200, source: 'manual' }), 409)
    const v2 = createValuation(db, a.id, { date: '2024-01-02', value: 200, source: 'manual' })
    expectDomain(() => updateValuation(db, v2.id, { date: '2024-01-01' }), 409)
  })
})

describe('repository rules', () => {
  it('locks currency after the first valuation', () => {
    const a = createAsset(db, { name: 'A', category: 'bank', currency: 'EUR', description: null, color: null })
    expect(updateAsset(db, a.id, { currency: 'USD' }).currency).toBe('USD')
    createValuation(db, a.id, { date: '2024-01-01', value: 100, source: 'manual' })
    expect(getAsset(db, a.id).currencyLocked).toBe(true)
    expectDomain(() => updateAsset(db, a.id, { currency: 'EUR' }), 409)
    expect(updateAsset(db, a.id, { name: 'Renamed', currency: 'USD' }).name).toBe('Renamed')
  })

  it('creates, corrects, filters and deletes valuations', () => {
    const a = createAsset(db, { name: 'A', category: 'cash', currency: 'EUR', description: null, color: '#123456' })
    const v = createValuation(db, a.id, { date: '2024-01-10', value: 12345, source: 'manual' })
    expect(v.value).toBe('123.45')
    createValuation(db, a.id, { date: '2024-02-10', value: 1, source: 'manual' })
    createValuation(db, a.id, { date: '2024-03-10', value: 2, source: 'manual' })
    expect(listValuations(db, a.id, { from: '2024-01-10', to: '2024-02-10' }).map(x => x.date)).toEqual(['2024-02-10', '2024-01-10'])
    expect(updateValuation(db, v.id, { value: 99 }).value).toBe('0.99')
    deleteValuation(db, v.id)
    expectDomain(() => deleteValuation(db, v.id), 404)
    expectDomain(() => updateValuation(db, 'nope', { value: 1 }), 404)
    expectDomain(() => getAsset(db, 'nope'), 404)
    expectDomain(() => listValuations(db, 'nope', {}), 404)
    expectDomain(() => createValuation(db, a.id, { date: '2999-01-01', value: 1, source: 'manual' }), 400)
  })
})

describe('seeder', () => {
  const today = '2026-10-31'

  it('produces 61 month-end dates per asset, capped at today', () => {
    expect(seedDates('2026-10-15')).toHaveLength(61)
    expect(seedDates('2026-10-15')[0]).toBe('2021-10-31')
    expect(seedDates('2026-10-15').at(-1)).toBe('2026-10-15')
    expect(seedDates('2026-02-10')).toContain('2024-02-29')
    const { assetRows, valuationRows } = buildSeed(today, new Date())
    expect(assetRows).toHaveLength(6)
    expect(assetRows.every(a => a.name.startsWith('[Demo]') && a.currency === 'EUR')).toBe(true)
    expect(valuationRows).toHaveLength(366)
    expect(valuationRows.every(v => Number.isSafeInteger(v.value) && v.value >= 0)).toBe(true)
  })

  it('is deterministic', () => {
    const a = buildSeed(today, new Date(0)).valuationRows.map(v => v.value)
    const b = buildSeed(today, new Date(0)).valuationRows.map(v => v.value)
    expect(a).toEqual(b)
  })

  it('is idempotent and never overwrites existing or user-edited records', () => {
    const first = seedDemo(db, today)
    expect(first).toMatchObject({ insertedAssets: 6, insertedValuations: 366 })

    // User edits a demo asset and a demo valuation, deletes one, and adds their own.
    db.update(assets).set({ name: 'My edited checking' }).where(eq(assets.id, 'demo-checking')).run()
    db.update(valuations).set({ value: 42 }).where(eq(valuations.id, 'demo-pea-2026-10-31')).run()
    db.delete(valuations).where(eq(valuations.id, 'demo-cash-2026-09-30')).run()
    const mine = createAsset(db, { name: 'Mine', category: 'other', currency: 'EUR', description: null, color: null })
    createValuation(db, mine.id, { date: '2024-01-01', value: 7, source: 'manual' })

    const second = seedDemo(db, today)
    expect(second.insertedAssets).toBe(0)
    // Only the row the user removed is re-added; nothing else is duplicated or overwritten.
    expect(second.insertedValuations).toBe(1)
    expect(db.select().from(assets).all()).toHaveLength(7)
    expect(db.select().from(valuations).all()).toHaveLength(367)
    expect(getAsset(db, 'demo-checking').name).toBe('My edited checking')
    expect(db.select().from(valuations).where(eq(valuations.id, 'demo-pea-2026-10-31')).get()!.value).toBe(42)

    expect(seedDemo(db, today)).toMatchObject({ insertedAssets: 0, insertedValuations: 0 })
  })

  it('produces a complete dashboard over the seeded period', () => {
    seedDemo(db, today)
    const d = dashboard(db, { range: 'ALL' }, today)
    expect(d.assets).toHaveLength(6)
    expect(d.current.complete).toBe(true)
    expect(d.current.total).not.toBeNull()
    expect(d.history.at(-1)!.date).toBe(today)
  })
})
