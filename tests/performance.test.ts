import { describe, expect, it } from 'vitest'
import { computePerformance, irr } from '../shared/utils/performance'

describe('irr', () => {
  it('finds the yearly rate of a simple investment', () => {
    expect(irr([{ t: 0, amount: -100 }, { t: 365, amount: 105 }])).toBeCloseTo(0.05, 9)
    expect(irr([{ t: 0, amount: -100 }, { t: 730, amount: 81 }])).toBeCloseTo(-0.1, 9)
  })
})

describe('computePerformance', () => {
  it('returns null without observations', () => {
    expect(computePerformance([])).toBeNull()
  })

  it('reports gains with a single observation, but no return', () => {
    const p = computePerformance([{ date: '2026-11-01', valueCents: 2_000_000, paidInCents: 1_700_000 }])!
    expect(p).toMatchObject({ value: '20000.00', paidIn: '17000.00', gain: '3000.00', since: '2026-11-01', days: 0, periodReturn: null, annualReturn: null })
    expect(p.gainRatio).toBeCloseTo(0.17647, 4)
  })

  it('measures 5 % a year with no deposits', () => {
    const p = computePerformance([
      { date: '2024-01-01', valueCents: 1_000_000, paidInCents: 1_000_000 },
      { date: '2024-12-31', valueCents: 1_050_000, paidInCents: 1_000_000 },
    ])!
    expect(p.days).toBe(365)
    expect(p.annualReturn).toBeCloseTo(0.05, 6)
    expect(p.periodReturn).toBeCloseTo(0.05, 6)
    expect(p.gain).toBe('500.00')
  })

  it('does not count deposits as performance', () => {
    // 10 000 € grows 0 %, and 5 000 € added mid-way: the value rises by the deposit only.
    const p = computePerformance([
      { date: '2024-01-01', valueCents: 1_000_000, paidInCents: 1_000_000 },
      { date: '2025-01-01', valueCents: 1_500_000, paidInCents: 1_500_000 },
    ])!
    expect(p.gain).toBe('0.00')
    expect(p.annualReturn).toBeCloseTo(0, 6)
  })

  it('weights money by how long it was invested', () => {
    // Monthly deposits of 100 € into an asset growing 5 % a year: the return is ~5 %, while the gain ratio is far lower.
    const obs = []
    let value = 0
    let paid = 0
    const rate = 1.05 ** (1 / 12) - 1
    for (let m = 0; m <= 36; m++) {
      if (m > 0) value = value * (1 + rate)
      value += 100_00
      paid += 100_00
      const date = new Date(Date.UTC(2023, m, 15)).toISOString().slice(0, 10)
      obs.push({ date, valueCents: Math.round(value), paidInCents: paid })
    }
    const p = computePerformance(obs)!
    expect(p.annualReturn).toBeGreaterThan(0.045)
    expect(p.annualReturn).toBeLessThan(0.055)
    expect(p.gainRatio!).toBeLessThan(0.09)
  })

  it('does not annualize less than a year', () => {
    const p = computePerformance([
      { date: '2026-01-01', valueCents: 1_000_000, paidInCents: 1_000_000 },
      { date: '2026-04-01', valueCents: 1_030_000, paidInCents: 1_000_000 },
    ])!
    expect(p.periodReturn).toBeCloseTo(0.03, 6)
    expect(p.annualReturn).toBeNull()
  })

  it('handles withdrawals and a zero paid-in', () => {
    const p = computePerformance([
      { date: '2024-01-01', valueCents: 1_000_000, paidInCents: 1_000_000 },
      { date: '2025-01-01', valueCents: 0, paidInCents: -50_000 },
    ])!
    expect(p.gain).toBe('500.00')
    expect(p.gainRatio).toBeNull()
    // The withdrawal is assumed mid-period: 10 000 -> 10 500 in half a year is ~10.25 % a year.
    expect(p.annualReturn).toBeCloseTo(1.05 ** 2 - 1, 2)
  })
})

describe('asset performance through the repository', () => {
  it('stores paid in, computes gains in EUR, and clears it', async () => {
    const { openDatabase, runMigrations } = await import('../server/database/client')
    const { createAsset, createValuation, getAsset, listValuations, updateValuation, upsertRates } = await import('../server/utils/repository')
    const { valuationCreateSchema } = await import('../shared/utils/validation')
    const db = openDatabase(':memory:')
    runMigrations(db)

    const pea = createAsset(db, { name: 'PEA', category: 'investment', currency: 'EUR', description: null, color: null })
    expect(getAsset(db, pea.id).performance).toBeNull()
    createValuation(db, pea.id, valuationCreateSchema.parse({ date: '2024-11-01', value: '10000', paidIn: '10000' }))
    createValuation(db, pea.id, valuationCreateSchema.parse({ date: '2025-05-01', value: '12000' })) // no paid in: ignored
    const v = createValuation(db, pea.id, valuationCreateSchema.parse({ date: '2025-11-01', value: '11550', paidIn: '11000' }))
    expect(v.paidIn).toBe('11000.00')
    const perf = getAsset(db, pea.id).performance!
    expect(perf).toMatchObject({ asOf: '2025-11-01', value: '11550.00', paidIn: '11000.00', gain: '550.00', since: '2024-11-01', days: 365 })
    expect(perf.annualReturn).toBeGreaterThan(0.04)
    expect(listValuations(db, pea.id, {}).map(x => x.paidIn)).toEqual(['11000.00', null, '10000.00'])
    expect(() => valuationCreateSchema.parse({ date: '2025-01-01', value: '1', paidIn: '1.001' })).toThrow()
    updateValuation(db, v.id, { paidIn: null })
    expect(getAsset(db, pea.id).performance).toMatchObject({ asOf: '2024-11-01', gain: '0.00' })

    // BTC: paid in is EUR, the value is converted with the rate on that date.
    const btc = createAsset(db, { name: 'BTC', category: 'crypto', currency: 'BTC', description: null, color: null })
    upsertRates(db, { currency: 'BTC', source: 'test', rates: [{ date: '2026-10-01', rate: '60000' }] })
    createValuation(db, btc.id, valuationCreateSchema.parse({ date: '2026-10-01', value: '0.1', paidIn: '5000' }))
    expect(getAsset(db, btc.id).performance).toMatchObject({ value: '6000.00', paidIn: '5000.00', gain: '1000.00' })

    // Currencies not converted to EUR have no performance.
    const usd = createAsset(db, { name: 'USD', category: 'bank', currency: 'USD', description: null, color: null })
    createValuation(db, usd.id, valuationCreateSchema.parse({ date: '2026-10-01', value: '100', paidIn: '90' }))
    expect(getAsset(db, usd.id).performance).toBeNull()
  })
})
