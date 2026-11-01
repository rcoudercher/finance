// Compound interest projection: a starting capital plus a fixed monthly saving, growing at an annual rate.
// Convention: the annual rate is an effective yearly return. It compounds monthly at the equivalent monthly rate
// (1 + annualRate)^(1/12) - 1, so a full year grows by exactly annualRate; each monthly saving is added at the end of
// its month. 10 000 + 100/month for 20 years at 5 % -> 67 113.43.
// Floating point is fine here: this is a projection shown rounded to the euro, not stored money.

export interface CompoundInput {
  initialCapital: number
  monthlySavings: number
  /** Investment horizon in whole years. */
  years: number
  /** Annual interest rate in percent, e.g. 5 for 5 %. */
  annualRatePercent: number
}

export interface CompoundPoint {
  /** 0 = start, then the end of each year. */
  year: number
  /** Total paid in so far: initial capital + monthly savings. */
  contributions: number
  /** Value including interest. */
  balance: number
}

export const COMPOUND_LIMITS = {
  initialCapital: { min: 0, max: 100_000_000 },
  monthlySavings: { min: 0, max: 1_000_000 },
  years: { min: 1, max: 80 },
  annualRatePercent: { min: -20, max: 50 },
} as const

export function compoundProjection(input: CompoundInput): CompoundPoint[] {
  const rate = (1 + input.annualRatePercent / 100) ** (1 / 12) - 1
  let balance = input.initialCapital
  let contributions = input.initialCapital
  const points: CompoundPoint[] = [{ year: 0, contributions, balance }]
  for (let year = 1; year <= input.years; year++) {
    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + rate) + input.monthlySavings
      contributions += input.monthlySavings
    }
    points.push({ year, contributions, balance })
  }
  return points
}
