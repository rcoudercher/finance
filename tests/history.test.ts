import { describe, expect, it } from 'vitest'
import { assetHistory, computeDashboard, type AssetInput, type RateInput, type ValuationInput } from '../shared/utils/finance'

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
    expect(d.assets.find(a => a.id === 'usd')).toMatchObject({ included: false, latestValue: null, latestNativeValue: '50.00' })
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

describe('BTC assets (balances in BTC, converted to EUR with daily rates)', () => {
  const today = '2024-03-10'
  const rate = (date: string, r: string): RateInput => ({ currency: 'BTC', date, rate: r })
  // 0.1 BTC = 10 000 000 satoshis
  const btc = () => asset('btc', '2024-03-01', 'BTC')

  it('values each day as the carried-forward balance times the latest rate on or before that day', () => {
    const d = computeDashboard([btc(), asset('eur', '2024-03-01')], [
      val('btc', '2024-03-02', 10_000_000),
      val('btc', '2024-03-06', 20_000_000),
      val('eur', '2024-03-01', 100_00),
    ], { today, from: '2024-03-01', to: today, rates: [rate('2024-03-03', '60000'), rate('2024-03-05', '69987.075')] })

    expect(byDate(d, '2024-03-02').values.btc).toBeNull() // balance known, no rate yet: unknown, not zero
    expect(byDate(d, '2024-03-02').complete).toBe(false)
    expect(byDate(d, '2024-03-03').values.btc).toBe('6000.00')
    expect(byDate(d, '2024-03-04').values.btc).toBe('6000.00') // rate carried forward
    expect(byDate(d, '2024-03-05').values.btc).toBe('6998.71') // 0.1 x 69987.075 = 6998.7075, rounded
    expect(byDate(d, '2024-03-06').values.btc).toBe('13997.42') // new balance, same rate
    expect(byDate(d, '2024-03-06').total).toBe('14097.42')

    expect(d.current.total).toBe('14097.42')
    expect(d.series.map(s => s.id)).toContain('btc')
    expect(d.excluded).toEqual([])
    expect(d.assets.find(a => a.id === 'btc')).toMatchObject({
      included: true,
      latestValue: '13997.42',
      latestNativeValue: '0.20000000',
      latestRate: { rate: '69987.075', date: '2024-03-05' },
    })
  })

  it('reports a BTC asset as unknown until a rate exists, and ignores future rates', () => {
    const d = computeDashboard([btc()], [val('btc', '2024-03-02', 10_000_000)], {
      today, preset: '1M', rates: [rate('2024-03-20', '70000')],
    })
    expect(d.current).toMatchObject({ total: null, participating: 1, known: 0, unknownAssetIds: ['btc'] })
    expect(d.assets[0]).toMatchObject({ latestValue: null, latestNativeValue: '0.10000000', latestRate: null })
  })

  it('never flags an old BTC quantity as stale while the rate is fresh', () => {
    const d = computeDashboard([btc()], [val('btc', '2023-01-01', 10_000_000)], {
      today, preset: '1M', rates: [rate('2024-03-10', '60000')],
    })
    expect(d.current.staleAssetIds).toEqual([])
    expect(d.assets[0]).toMatchObject({ stale: false, latestValue: '6000.00' })
    expect(byDate(d, today).stale).toBe(0)
  })

  it('flags a stale rate even when the balance is recent', () => {
    const d = computeDashboard([btc()], [val('btc', '2024-03-09', 10_000_000)], {
      today: '2024-04-20', preset: '1M', rates: [rate('2024-03-01', '50000')],
    })
    expect(d.current.staleAssetIds).toEqual(['btc'])
    expect(d.current.total).toBe('5000.00')
  })
})
