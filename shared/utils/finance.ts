// Pure, deterministic portfolio/history computations shared by the API and tests.
//
// Rules (see README "Financial rules"):
// - Valuations are total balances observed on a calendar date, not flows or returns.
// - The value of an asset on day D is its latest observation dated on or before D (carry forward).
//   Observations dated after D (and after "today") are never used.
// - An asset participates from min(creation date, earliest observation date). On a participating day
//   with no observation yet, its value is unknown (null), never zero.
// - Only EUR assets are aggregated; other currencies are reported as excluded.
// - Observations older than STALE_AFTER_DAYS on day D are flagged stale but still counted.

import { AGGREGATION_CURRENCY, minorToDecimal } from './money'
import { addDays, addMonths, diffDays, minDate, parisDate } from './dates'

export const STALE_AFTER_DAYS = 30
export const MAX_RANGE_DAYS = 36_600
export const RANGE_PRESETS = ['1M', '3M', '6M', '1Y', 'ALL'] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b',
] as const

export interface AssetInput {
  id: string
  name: string
  category: string
  currency: string
  color: string | null
  createdAt: Date | number
}

export interface ValuationInput {
  id: string
  assetId: string
  date: string
  value: number // minor units
}

export interface AssetSummary {
  id: string
  name: string
  category: string
  currency: string
  color: string
  included: boolean
  participatesFrom: string
  latestValue: string | null
  latestDate: string | null
  ageDays: number | null
  stale: boolean
  valuationCount: number
}

export interface HistoryPoint {
  date: string
  /** Sum of known EUR values, or null when no participating asset is known. */
  total: string | null
  values: Record<string, string | null>
  participating: number
  known: number
  stale: number
  complete: boolean
}

export interface DashboardResult {
  today: string
  currency: string
  range: { from: string, to: string, preset: RangePreset | null }
  current: {
    total: string | null
    participating: number
    known: number
    complete: boolean
    unknownAssetIds: string[]
    staleAssetIds: string[]
  }
  assets: AssetSummary[]
  excluded: { id: string, name: string, currency: string }[]
  series: { id: string, name: string, color: string }[]
  history: HistoryPoint[]
  completeness: {
    days: number
    completeDays: number
    incompleteDays: number
    staleDays: number
    firstCompleteDate: string | null
  }
}

export class RangeError400 extends Error {}

export function resolveColors(assets: AssetInput[]): Map<string, string> {
  const map = new Map<string, string>()
  let i = 0
  for (const a of sortAssets(assets)) {
    map.set(a.id, a.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]!)
    i++
  }
  return map
}

function sortAssets<T extends AssetInput>(assets: T[]): T[] {
  return [...assets].sort((a, b) => +a.createdAt - +b.createdAt || a.id.localeCompare(b.id))
}

/** Group valuations per asset, sorted by date, dropping any dated after `today`. */
function indexValuations(valuations: ValuationInput[], today: string): Map<string, ValuationInput[]> {
  const byAsset = new Map<string, ValuationInput[]>()
  for (const v of valuations) {
    if (v.date > today) continue
    let list = byAsset.get(v.assetId)
    if (!list) byAsset.set(v.assetId, (list = []))
    list.push(v)
  }
  for (const list of byAsset.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return byAsset
}

export function participationStart(asset: AssetInput, sortedValuations: ValuationInput[] | undefined): string {
  const created = parisDate(asset.createdAt)
  const first = sortedValuations?.[0]?.date
  return first ? minDate(created, first) : created
}

export function resolveRange(
  opts: { preset?: RangePreset | null, from?: string | null, to?: string | null },
  today: string,
  earliest: string,
): { from: string, to: string, preset: RangePreset | null } {
  if (opts.from || opts.to) {
    if (!opts.from || !opts.to) throw new RangeError400('Both from and to are required for a custom range')
    const to = minDate(opts.to, today)
    if (opts.from > to) throw new RangeError400('from must be on or before to (and not after today)')
    if (diffDays(to, opts.from) > MAX_RANGE_DAYS) throw new RangeError400('Range is too long')
    return { from: opts.from, to, preset: null }
  }
  const preset = opts.preset ?? '1Y'
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 } as const
  const from = preset === 'ALL' ? minDate(earliest, today) : addMonths(today, -months[preset])
  return { from, to: today, preset }
}

export interface AssetHistoryPoint {
  date: string
  value: string | null
  observedOn: string | null
  stale: boolean
}

/**
 * Daily carried-forward history for a single asset (any currency) between from and to (inclusive, capped at today).
 * Days before the asset participates, or with no observation yet, are null.
 */
export function assetHistory(
  valuations: { date: string, value: string }[],
  options: { from: string, to: string, today: string, participatesFrom: string },
): AssetHistoryPoint[] {
  const sorted = valuations.filter(v => v.date <= options.today).sort((a, b) => (a.date < b.date ? -1 : 1))
  const to = minDate(options.to, options.today)
  const out: AssetHistoryPoint[] = []
  let p = -1
  for (let day = options.from; day <= to; day = addDays(day, 1)) {
    while (p + 1 < sorted.length && sorted[p + 1]!.date <= day) p++
    const obs = p >= 0 ? sorted[p]! : null
    if (!obs || day < options.participatesFrom) {
      out.push({ date: day, value: null, observedOn: null, stale: false })
    }
    else {
      out.push({ date: day, value: obs.value, observedOn: obs.date, stale: diffDays(day, obs.date) > STALE_AFTER_DAYS })
    }
  }
  return out
}

export function computeDashboard(
  assets: AssetInput[],
  valuations: ValuationInput[],
  options: { today: string, preset?: RangePreset | null, from?: string | null, to?: string | null },
): DashboardResult {
  const { today } = options
  const colors = resolveColors(assets)
  const byAsset = indexValuations(valuations, today)
  const ordered = sortAssets(assets)

  const summaries: AssetSummary[] = ordered.map((a) => {
    const list = byAsset.get(a.id) ?? []
    const latest = list.at(-1)
    const ageDays = latest ? diffDays(today, latest.date) : null
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      currency: a.currency,
      color: colors.get(a.id)!,
      included: a.currency === AGGREGATION_CURRENCY,
      participatesFrom: participationStart(a, list),
      latestValue: latest ? minorToDecimal(latest.value) : null,
      latestDate: latest?.date ?? null,
      ageDays,
      stale: ageDays !== null && ageDays > STALE_AFTER_DAYS,
      valuationCount: list.length,
    }
  })

  const included = summaries.filter(s => s.included)
  const earliest = included.reduce((acc, s) => minDate(acc, s.participatesFrom), today)
  const range = resolveRange(options, today, earliest)

  // Current state (as of today).
  const participatingNow = included.filter(s => s.participatesFrom <= today)
  const knownNow = participatingNow.filter(s => s.latestValue !== null)
  let currentTotal = 0n
  for (const s of knownNow) currentTotal += BigInt(byAsset.get(s.id)!.at(-1)!.value)

  // Daily history, generated at query time. Never persisted.
  const history: HistoryPoint[] = []
  const pointers = new Map<string, number>(included.map(s => [s.id, -1]))
  // Advance pointers to the last observation strictly before range.from.
  const advance = (id: string, day: string) => {
    const list = byAsset.get(id) ?? []
    let p = pointers.get(id)!
    while (p + 1 < list.length && list[p + 1]!.date <= day) p++
    pointers.set(id, p)
    return p >= 0 ? list[p]! : null
  }
  let completeDays = 0
  let staleDays = 0
  let firstCompleteDate: string | null = null
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const values: Record<string, string | null> = {}
    let participating = 0
    let known = 0
    let stale = 0
    let total = 0n
    for (const s of included) {
      const obs = advance(s.id, day)
      if (day < s.participatesFrom) {
        values[s.id] = null
        continue
      }
      participating++
      if (!obs) {
        values[s.id] = null
        continue
      }
      known++
      total += BigInt(obs.value)
      values[s.id] = minorToDecimal(obs.value)
      if (diffDays(day, obs.date) > STALE_AFTER_DAYS) stale++
    }
    const complete = participating > 0 && known === participating
    if (complete) {
      completeDays++
      firstCompleteDate ??= day
    }
    if (stale > 0) staleDays++
    history.push({
      date: day,
      total: known > 0 ? minorToDecimal(total) : null,
      values,
      participating,
      known,
      stale,
      complete,
    })
  }

  return {
    today,
    currency: AGGREGATION_CURRENCY,
    range,
    current: {
      total: knownNow.length > 0 ? minorToDecimal(currentTotal) : null,
      participating: participatingNow.length,
      known: knownNow.length,
      complete: participatingNow.length > 0 && knownNow.length === participatingNow.length,
      unknownAssetIds: participatingNow.filter(s => s.latestValue === null).map(s => s.id),
      staleAssetIds: knownNow.filter(s => s.stale).map(s => s.id),
    },
    assets: summaries,
    excluded: summaries.filter(s => !s.included).map(s => ({ id: s.id, name: s.name, currency: s.currency })),
    series: included.map(s => ({ id: s.id, name: s.name, color: s.color })),
    history,
    completeness: {
      days: history.length,
      completeDays,
      incompleteDays: history.length - completeDays,
      staleDays,
      firstCompleteDate,
    },
  }
}
