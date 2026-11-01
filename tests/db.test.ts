// Integration tests against a fresh, isolated SQLite database (in-memory) with real migrations.
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase, runMigrations, type DB } from '../server/database/client'
import { assets, valuations } from '../server/database/schema'
import { buildSeed, DEMO_ASSET_IDS, seedDates, seedDemo } from '../server/database/seed'
import { migrateAssetIdsToUlid } from '../server/database/asset-ids'
import { isUlid, isUlidAnyCase, ulid, ulidTime } from '../shared/utils/ulid'
import {
  createAsset, createValuation, dashboard, deleteAsset, deleteValuation, DomainError, getAsset, listAssets, listRates,
  listValuations, updateAsset, updateValuation, upsertRates,
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
    createValuation(db, a.id, { date: '2024-01-01', value: '1.00', source: 'manual' })
    expectDomain(() => createValuation(db, a.id, { date: '2024-01-01', value: '2.00', source: 'manual' }), 409)
    const v2 = createValuation(db, a.id, { date: '2024-01-02', value: '2.00', source: 'manual' })
    expectDomain(() => updateValuation(db, v2.id, { date: '2024-01-01' }), 409)
  })
})

describe('repository rules', () => {
  it('locks currency after the first valuation', () => {
    const a = createAsset(db, { name: 'A', category: 'bank', currency: 'EUR', description: null, color: null })
    expect(updateAsset(db, a.id, { currency: 'USD' }).currency).toBe('USD')
    createValuation(db, a.id, { date: '2024-01-01', value: '1.00', source: 'manual' })
    expect(getAsset(db, a.id).currencyLocked).toBe(true)
    expectDomain(() => updateAsset(db, a.id, { currency: 'EUR' }), 409)
    expect(updateAsset(db, a.id, { name: 'Renamed', currency: 'USD' }).name).toBe('Renamed')
  })

  it('deletes an asset together with its valuations, leaving others untouched', () => {
    const a = createAsset(db, { name: 'A', category: 'bank', currency: 'EUR', description: null, color: null })
    const b = createAsset(db, { name: 'B', category: 'bank', currency: 'EUR', description: null, color: null })
    createValuation(db, a.id, { date: '2024-01-01', value: '1.00', source: 'manual' })
    createValuation(db, a.id, { date: '2024-02-01', value: '2.00', source: 'manual' })
    createValuation(db, b.id, { date: '2024-01-01', value: '3.00', source: 'manual' })
    expect(deleteAsset(db, a.id)).toEqual({ valuationsDeleted: 2 })
    expectDomain(() => getAsset(db, a.id), 404)
    expect(db.select().from(valuations).where(eq(valuations.assetId, a.id)).all()).toEqual([])
    expect(listValuations(db, b.id, {})).toHaveLength(1)
    expectDomain(() => deleteAsset(db, a.id), 404)
    // An asset with no valuations can be deleted too.
    const c = createAsset(db, { name: 'C', category: 'cash', currency: 'EUR', description: null, color: null })
    expect(deleteAsset(db, c.id)).toEqual({ valuationsDeleted: 0 })
  })

  it('creates, corrects, filters and deletes valuations', () => {
    const a = createAsset(db, { name: 'A', category: 'cash', currency: 'EUR', description: null, color: '#123456' })
    const v = createValuation(db, a.id, { date: '2024-01-10', value: '123.45', source: 'manual' })
    expect(v.value).toBe('123.45')
    createValuation(db, a.id, { date: '2024-02-10', value: '0.01', source: 'manual' })
    createValuation(db, a.id, { date: '2024-03-10', value: '0.02', source: 'manual' })
    expect(listValuations(db, a.id, { from: '2024-01-10', to: '2024-02-10' }).map(x => x.date)).toEqual(['2024-02-10', '2024-01-10'])
    expect(updateValuation(db, v.id, { value: '0.99' }).value).toBe('0.99')
    deleteValuation(db, v.id)
    expectDomain(() => deleteValuation(db, v.id), 404)
    expectDomain(() => updateValuation(db, 'nope', { value: '0.01' }), 404)
    expectDomain(() => getAsset(db, 'nope'), 404)
    expectDomain(() => listValuations(db, 'nope', {}), 404)
    expectDomain(() => createValuation(db, a.id, { date: '2999-01-01', value: '0.01', source: 'manual' }), 400)
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
    db.update(assets).set({ name: 'My edited checking' }).where(eq(assets.id, DEMO_ASSET_IDS['demo-checking']!)).run()
    db.update(valuations).set({ value: 42 }).where(eq(valuations.id, 'demo-pea-2026-10-31')).run()
    db.delete(valuations).where(eq(valuations.id, 'demo-cash-2026-09-30')).run()
    const mine = createAsset(db, { name: 'Mine', category: 'other', currency: 'EUR', description: null, color: null })
    createValuation(db, mine.id, { date: '2024-01-01', value: '0.07', source: 'manual' })

    const second = seedDemo(db, today)
    expect(second.insertedAssets).toBe(0)
    // Only the row the user removed is re-added; nothing else is duplicated or overwritten.
    expect(second.insertedValuations).toBe(1)
    expect(db.select().from(assets).all()).toHaveLength(7)
    expect(db.select().from(valuations).all()).toHaveLength(367)
    expect(getAsset(db, DEMO_ASSET_IDS['demo-checking']!).name).toBe('My edited checking')
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

describe('asset IDs', () => {
  it('generates valid, time-ordered ULIDs', () => {
    const id = ulid(Date.UTC(2026, 10, 1))
    expect(isUlid(id)).toBe(true)
    expect(ulidTime(id)).toBe(Date.UTC(2026, 10, 1))
    expect(ulid(1) < ulid(2)).toBe(true)
    expect(new Set(Array.from({ length: 1000 }, () => ulid(0))).size).toBe(1000)
    expect(isUlid('demo-checking')).toBe(false)
    expect(id).toBe(id.toLowerCase())
    expect(isUlid('01fk9tan00q4q9spd2afb1xnvk')).toBe(true)
    expect(isUlid('01FK9TAN00Q4Q9SPD2AFB1XNVK')).toBe(false)
    expect(isUlidAnyCase('01FK9TAN00Q4Q9SPD2AFB1XNVK')).toBe(true)
    expect(isUlid('81fk9tan00q4q9spd2afb1xnvk')).toBe(false) // first char > 7 overflows 48 bits
  })

  it('creates assets with ULIDs and 404s on non-ULID IDs', () => {
    const a = createAsset(db, { name: 'A', category: 'bank', currency: 'EUR', description: null, color: null })
    expect(isUlid(a.id)).toBe(true)
    expectDomain(() => getAsset(db, 'demo-checking'), 404)
    expect(Object.values(DEMO_ASSET_IDS).every(isUlid)).toBe(true)
  })

  it('migrates legacy asset IDs to ULIDs, keeping valuations and data', () => {
    const created = new Date('2025-03-04T05:06:07.000Z')
    const legacy = (id: string) => db.insert(assets).values({ id, name: id, category: 'bank', currency: 'EUR', description: 'd', color: '#123456', createdAt: created, updatedAt: created }).run()
    legacy('demo-pea')
    legacy('2f0c8d5e-9a43-4c1e-8f43-1b9e2f6a7c10')
    legacy('01HZX3Y4Z5ABCDEFGHJKMNPQRS')
    for (const [i, assetId] of ['demo-pea', 'demo-pea', '2f0c8d5e-9a43-4c1e-8f43-1b9e2f6a7c10'].entries()) {
      db.insert(valuations).values({ id: `v${i}`, assetId, date: `2025-0${i + 1}-01`, value: 100 + i, source: 'manual', createdAt: created, updatedAt: created }).run()
    }
    const keep = createAsset(db, { name: 'Already ULID', category: 'cash', currency: 'EUR', description: null, color: null })

    const renamed = migrateAssetIdsToUlid(db)
    expect(renamed).toHaveLength(3)
    expect(renamed.find(r => r.oldId === '01HZX3Y4Z5ABCDEFGHJKMNPQRS')!.newId).toBe('01hzx3y4z5abcdefghjkmnpqrs')
    expect(renamed.find(r => r.oldId === 'demo-pea')!.newId).toBe(DEMO_ASSET_IDS['demo-pea'])
    const uuidNew = renamed.find(r => r.oldId.startsWith('2f0c'))!.newId
    expect(ulidTime(uuidNew)).toBe(created.getTime())

    const all = db.select().from(assets).all()
    expect(all.map(a => a.id).every(isUlid)).toBe(true)
    expect(all.map(a => a.id)).toContain(keep.id)
    const pea = getAsset(db, DEMO_ASSET_IDS['demo-pea']!)
    expect(pea).toMatchObject({ name: 'demo-pea', description: 'd', color: '#123456', valuationCount: 2, createdAt: created.toISOString() })
    expect(listValuations(db, uuidNew, {}).map(v => v.id)).toEqual(['v2'])

    // Running it again changes nothing, and seeding afterwards does not duplicate the migrated demo asset.
    expect(migrateAssetIdsToUlid(db)).toEqual([])
    seedDemo(db, '2026-10-31')
    expect(db.select().from(assets).where(eq(assets.id, DEMO_ASSET_IDS['demo-pea']!)).all()).toHaveLength(1)
  })
})

describe('BTC assets and rates', () => {
  const btcAsset = () => createAsset(db, { name: 'Bitcoin', category: 'crypto', currency: 'BTC', description: null, color: null })

  it('stores BTC balances with 8 decimals and rejects more', () => {
    const a = btcAsset()
    const v = createValuation(db, a.id, { date: '2024-01-01', value: '0.1', source: 'manual' })
    expect(v.value).toBe('0.10000000')
    expect(db.select().from(valuations).where(eq(valuations.id, v.id)).get()!.value).toBe(10_000_000)
    expect(updateValuation(db, v.id, { value: '0.12345678' }).value).toBe('0.12345678')
    expectDomain(() => updateValuation(db, v.id, { value: '0.123456789' }), 400)
    // EUR keeps two decimals
    const e = createAsset(db, { name: 'E', category: 'bank', currency: 'EUR', description: null, color: null })
    expectDomain(() => createValuation(db, e.id, { date: '2024-01-01', value: '1.001', source: 'manual' }), 400)
  })

  it('upserts rates, rejects future dates, and converts BTC in the dashboard and asset views', () => {
    const a = btcAsset()
    createValuation(db, a.id, { date: '2024-03-01', value: '0.1', source: 'manual' })
    expect(getAsset(db, a.id).latestEurValue).toBeNull() // no rate yet

    upsertRates(db, { currency: 'BTC', source: 'test', rates: [{ date: '2024-03-01', rate: '60000' }, { date: '2024-03-02', rate: '1' }] })
    upsertRates(db, { currency: 'BTC', source: 'fix', rates: [{ date: '2024-03-02', rate: '69987.075' }] }) // replaces
    expect(listRates(db, { currency: 'BTC' })).toEqual([
      { date: '2024-03-01', rate: '60000', source: 'test' },
      { date: '2024-03-02', rate: '69987.075', source: 'fix' },
    ])
    expectDomain(() => upsertRates(db, { currency: 'BTC', source: 't', rates: [{ date: '2999-01-01', rate: '1' }] }), 400)

    expect(getAsset(db, a.id).latestEurValue).toMatchObject({ value: '6998.71', rate: '69987.075', rateDate: '2024-03-02' })
    expect(listAssets(db)[0]!.latestValuation!.value).toBe('0.10000000')

    const d = dashboard(db, { from: '2024-03-01', to: '2024-03-02' }, '2024-03-02')
    expect(d.history.map(h => h.total)).toEqual(['6000.00', '6998.71'])
    expect(d.current.total).toBe('6998.71')
  })

  it('migrates the assets table to accept BTC without breaking valuation references', () => {
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.$client.pragma('foreign_key_check')).toEqual([])
    const a = btcAsset()
    expect(a.currency).toBe('BTC')
  })
})
