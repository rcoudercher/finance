import { describe, expect, it } from 'vitest'
import { compoundProjection } from '../shared/utils/compound'

describe('compound interest projection', () => {
  it('compounds monthly at the rate equivalent to the effective annual rate', () => {
    const points = compoundProjection({ initialCapital: 10_000, monthlySavings: 100, years: 20, annualRatePercent: 5 })
    expect(points).toHaveLength(21)
    expect(points[0]).toEqual({ year: 0, contributions: 10_000, balance: 10_000 })
    const r = 1.05 ** (1 / 12) - 1
    const n = 240
    const expected = 10_000 * 1.05 ** 20 + 100 * (((1 + r) ** n - 1) / r)
    expect(points[20]!.contributions).toBe(34_000)
    expect(points[20]!.balance).toBeCloseTo(expected, 6)
    expect(points[20]!.balance).toBeCloseTo(67_113.43, 2)
    // With no savings, one year grows by exactly the annual rate.
    expect(compoundProjection({ initialCapital: 1000, monthlySavings: 0, years: 1, annualRatePercent: 5 })[1]!.balance).toBeCloseTo(1050, 9)
  })

  it('is just the sum of contributions at 0 %', () => {
    const last = compoundProjection({ initialCapital: 500, monthlySavings: 50, years: 3, annualRatePercent: 0 }).at(-1)!
    expect(last).toEqual({ year: 3, contributions: 2_300, balance: 2_300 })
  })
})
