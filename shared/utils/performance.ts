// Asset performance from valuations that also record "paid in": the total net amount (deposits minus withdrawals)
// put into the asset so far, in EUR. Gains = value - paid in. Return = money-weighted (IRR), so deposits
// count only from when they were made.

import { diffDays, addDays } from './dates'
import { minorToDecimal } from './money'

export interface PerformanceObservation {
  date: string
  /** EUR value in cents on that date. */
  valueCents: number
  /** Total net paid in up to that date, EUR cents. */
  paidInCents: number
}

export interface PerformanceResult {
  /** Date of the latest observation used. */
  asOf: string
  value: string
  paidIn: string
  /** value - paidIn: everything the asset earned over its life (as far as paid in is known). */
  gain: string
  /** gain / paidIn, as a fraction (0.192 = 19.2 %). Null when paid in is zero or negative. */
  gainRatio: number | null
  /** First observation with a paid-in figure: the return is measured from here. */
  since: string
  days: number
  /** Money-weighted return over [since, asOf], not annualized. Null with a single observation or no solution. */
  periodReturn: number | null
  /** Money-weighted return per year. Null under MIN_ANNUALIZE_DAYS: annualizing a short period is misleading. */
  annualReturn: number | null
}

export const MIN_ANNUALIZE_DAYS = 365

interface Flow {
  /** Days since the first observation. */
  t: number
  /** Positive = money out of the asset to you (final value), negative = money in. */
  amount: number
}

function npv(flows: Flow[], rate: number): number {
  let sum = 0
  for (const f of flows) sum += f.amount / (1 + rate) ** (f.t / 365)
  return sum
}

/** Annual internal rate of return of dated flows, by bisection. Null when there is no sign change in range. */
export function irr(flows: Flow[]): number | null {
  let lo = -0.9999
  let hi = 100
  let fLo = npv(flows, lo)
  const fHi = npv(flows, hi)
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo === 0 || Math.sign(fLo) === Math.sign(fHi)) {
    return fLo === 0 ? lo : null
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fMid = npv(flows, mid)
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid
      fLo = fMid
    }
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Performance from observations sorted by date (each with a value and a paid-in figure).
 * The return starts from the first observation's value, as if it were invested on that day. Money added between
 * two observations (the change in paid in) is assumed to arrive halfway between them.
 */
export function computePerformance(observations: PerformanceObservation[]): PerformanceResult | null {
  const obs = [...observations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const first = obs[0]
  const last = obs.at(-1)
  if (!first || !last) return null

  const gainCents = last.valueCents - last.paidInCents
  const days = diffDays(last.date, first.date)

  let periodReturn: number | null = null
  let annualReturn: number | null = null
  if (days > 0) {
    const flows: Flow[] = [{ t: 0, amount: -first.valueCents }]
    for (let i = 1; i < obs.length; i++) {
      const added = obs[i]!.paidInCents - obs[i - 1]!.paidInCents
      if (added === 0) continue
      const mid = addDays(obs[i - 1]!.date, Math.floor(diffDays(obs[i]!.date, obs[i - 1]!.date) / 2))
      flows.push({ t: diffDays(mid, first.date), amount: -added })
    }
    flows.push({ t: days, amount: last.valueCents })
    const r = irr(flows)
    if (r !== null) {
      periodReturn = (1 + r) ** (days / 365) - 1
      if (days >= MIN_ANNUALIZE_DAYS) annualReturn = r
    }
  }

  return {
    asOf: last.date,
    value: minorToDecimal(last.valueCents),
    paidIn: minorToDecimal(last.paidInCents),
    gain: minorToDecimal(gainCents),
    gainRatio: last.paidInCents > 0 ? gainCents / last.paidInCents : null,
    since: first.date,
    days,
    periodReturn,
    annualReturn,
  }
}
