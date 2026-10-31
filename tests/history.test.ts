import { describe, expect, it } from 'vitest'
import { assetHistory, computeDashboard, type AssetInput, type ValuationInput } from '../shared/utils/finance'

// Noon UTC is the same calendar day in Paris, so creation dates are unambiguous.
const at = (date: string) => new Date(`${date}T12:00:00Z`)

function asset(id: string, created: string, currency = 'EUR', color: string | null = null): AssetInput {
  return { id, name: id.toUpperCase(), category: 'bank', currency, color, createdAt: at(created) }
}
let n = 0
function val(assetId: string, date: string, value: number): ValuationInput {
  return { id: `v${n++}`, assetId, date, value }
}
const byDate = (d: ReturnType<typeof computeDashboard>, date: string) => d.history.find(h => h.date === date)!

describe('daily history (carry forward)', () => {
  const today = '2024-03-10'

  it('carries the latest observation on or before each day forward', () => {
    const d = computeDashboard([asset('a', '2024-03-01')], [val('a', '2024-03-02', 1000), val('a', '2024-03-05', 2550)], {
      today, from: '2024-03-01', to: '2024-03-10',
    })
    expect(d.history.map(h => h.total)).toEqual([
      null, '10.00', '10.00', '10.00', '25.50', '25.50', '25.50', '25.50', '25.50', '25.50',
    ])
    expect(d.history).toHaveLength(10) // generated per day, inclusive
    expect(d.current.total).toBe('25.50')
  })

  it('treats missing observations as unknown, never zero', () => {
    const d = computeDashboard(
      [asset('a', '2024-03-01'), asset('b', '2024-03-01')],
      [val('a', '2024-03-01', 500), val('b', '2024-03-04', 300)],
      { today, from: '2024-03-01', to: '2024-03-05' },
    )
    const day2 = byDate(d, '2024-03-02')
    expect(day2.values).toEqual({ a: '5.00', b: null })
    expect(day2.total).toBe('5.00') // known total only
    expect(day2).toMatchObject({ participating: 2, known: 1, complete: false })
    expect(byDate(d, '2024-03-04')).toMatchObject({ total: '8.00', known: 2, complete: true })
    expect(d.completeness).toMatchObject({ days: 5, completeDays: 2, incompleteDays: 3, firstCompleteDate: '2024-03-04' })
  })

  it('asset participates from min(creation date, earliest observation)', () => {
    // Created on 5 Mar, but a backdated observation exists on 2 Mar.
    const backdated = computeDashboard([asset('a', '2024-03-05')], [val('a', '2024-03-02', 100)], {
      today, from: '2024-03-01', to: '2024-03-06',
    })
    expect(backdated.assets[0]!.participatesFrom).toBe('2024-03-02')
    expect(byDate(backdated, '2024-03-01').participating).toBe(0)
    expect(byDate(backdated, '2024-03-02')).toMatchObject({ participating: 1, total: '1.00' })

    // Created on 3 Mar with no observation: unknown from 3 Mar onward, not participating before.
    const empty = computeDashboard([asset('a', '2024-03-03')], [], { today, from: '2024-03-01', to: '2024-03-04' })
    expect(byDate(empty, '2024-03-02')).toMatchObject({ participating: 0, known: 0, total: null })
    expect(byDate(empty, '2024-03-03')).toMatchObject({ participating: 1, known: 0, total: null, complete: false })
    expect(empty.current).toMatchObject({ total: null, participating: 1, known: 0, unknownAssetIds: ['a'] })
  })

  it('never uses future observations', () => {
    const d = computeDashboard([asset('a', '2024-01-01')], [val('a', '2024-03-01', 100), val('a', '2024-03-20', 999_99)], {
      today, from: '2024-03-01', to: '2024-03-31',
    })
    expect(d.range.to).toBe(today) // range capped at today
    expect(d.history.at(-1)!.date).toBe(today)
    expect(d.history.every(h => h.total === '1.00')).toBe(true)
    expect(d.current.total).toBe('1.00')
    expect(d.assets[0]).toMatchObject({ latestDate: '2024-03-01', valuationCount: 1 })
  })

  it('aggregates EUR only and lists excluded currencies', () => {
    const d = computeDashboard(
      [asset('eur', '2024-03-01'), asset('usd', '2024-03-01', 'USD'), asset('gbp', '2024-03-01', 'GBP')],
      [val('eur', '2024-03-01', 1000), val('usd', '2024-03-01', 5000), val('gbp', '2024-03-01', 7000)],
      { today, preset: '1M' },
    )
    expect(d.current.total).toBe('10.00')
    expect(d.current.participating).toBe(1)
    expect(d.excluded.map(e => e.currency).sort()).toEqual(['GBP', 'USD'])
    expect(d.series.map(s => s.id)).toEqual(['eur'])
    expect(Object.keys(byDate(d, today).values)).toEqual(['eur'])
    expect(d.assets.find(a => a.id === 'usd')).toMatchObject({ included: false, latestValue: '50.00' })
  })

  it('flags observations older than 30 days as stale but keeps them in totals', () => {
    const d = computeDashboard([asset('a', '2024-01-01')], [val('a', '2024-01-15', 4200)], {
      today: '2024-03-10', from: '2024-02-13', to: '2024-02-15',
    })
    expect(byDate(d, '2024-02-14')).toMatchObject({ stale: 0, total: '42.00' }) // exactly 30 days
    expect(byDate(d, '2024-02-15')).toMatchObject({ stale: 1, total: '42.00', complete: true }) // 31 days
    expect(d.completeness.staleDays).toBe(1)
    expect(d.assets[0]).toMatchObject({ stale: true, ageDays: 55 })
    expect(d.current).toMatchObject({ total: '42.00', staleAssetIds: ['a'] })
  })

  it('sums exactly in minor units', () => {
    const d = computeDashboard(
      [asset('a', '2024-03-01'), asset('b', '2024-03-01'), asset('c', '2024-03-01')],
      [val('a', '2024-03-01', 10), val('b', '2024-03-01', 20), val('c', '2024-03-01', 999_999_999_999_999)],
      { today, preset: '1M' },
    )
    expect(d.current.total).toBe('10000000000000.29')
  })

  it('resolves presets and rejects invalid custom ranges', () => {
    const assets = [asset('a', '2020-02-01')]
    expect(computeDashboard(assets, [], { today, preset: '1M' }).range).toEqual({ from: '2024-02-10', to: today, preset: '1M' })
    expect(computeDashboard(assets, [], { today, preset: '1Y' }).range.from).toBe('2023-03-10')
    expect(computeDashboard(assets, [], { today, preset: 'ALL' }).range.from).toBe('2020-02-01')
    expect(computeDashboard(assets, [], { today }).range.preset).toBe('1Y')
    expect(() => computeDashboard(assets, [], { today, from: '2024-03-05', to: '2024-03-01' })).toThrow()
    expect(() => computeDashboard(assets, [], { today, from: '2024-03-05' })).toThrow()
  })
})

describe('single-asset history', () => {
  it('carries forward, keeps unknown gaps and ignores future observations', () => {
    const h = assetHistory(
      [{ date: '2024-03-02', value: '1.00' }, { date: '2024-03-04', value: '2.00' }, { date: '2024-03-09', value: '9.00' }],
      { from: '2024-03-01', to: '2024-03-10', today: '2024-03-05', participatesFrom: '2024-03-02' },
    )
    expect(h.map(p => p.value)).toEqual([null, '1.00', '1.00', '2.00', '2.00'])
  })
})
