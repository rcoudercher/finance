// Monthly budget: pure computations shared by the server and the client.
//
// A budget item (income or expense) has a history of monthly amounts. Each amount row applies from its
// month (YYYY-MM) onwards, until the item's next row. An amount of 0 means the item is stopped from that month.
// Amounts are integer EUR cents; totals are summed with BigInt.

import { minorToDecimal } from './money'

export const BUDGET_KIND_VALUES = ['income', 'expense'] as const
export type BudgetKind = (typeof BUDGET_KIND_VALUES)[number]

export const BUDGET_RANGE_PRESETS = ['12M', '24M', 'ALL'] as const
export type BudgetRangePreset = (typeof BUDGET_RANGE_PRESETS)[number]

/** Longest history the API returns, in months (50 years). */
export const MAX_BUDGET_MONTHS = 600

const MONTH_RE = /^(\d{4})-(\d{2})$/

export function isValidMonth(value: string): boolean {
  const m = MONTH_RE.exec(value)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  return y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12
}

/** Month (YYYY-MM) of a calendar date (YYYY-MM-DD). */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

function monthIndex(month: string): number {
  const m = MONTH_RE.exec(month)
  if (!m) throw new Error(`Invalid month: ${month}`)
  return Number(m[1]) * 12 + Number(m[2]) - 1
}

function fromMonthIndex(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function addMonthsToMonth(month: string, months: number): string {
  return fromMonthIndex(monthIndex(month) + months)
}

/** Number of months from `from` to `to`, inclusive of both (1 when equal). */
export function monthSpan(from: string, to: string): number {
  return monthIndex(to) - monthIndex(from) + 1
}

/** Every month from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let i = monthIndex(from); i <= monthIndex(to); i++) out.push(fromMonthIndex(i))
  return out
}

export interface BudgetItemInput {
  id: string
  name: string
  kind: BudgetKind
  notes: string | null
}

export interface BudgetAmountInput {
  id: string
  itemId: string
  month: string
  /** EUR cents per month, >= 0. */
  amount: number
}

/** Group amounts by item, each list sorted by month ascending. */
export function amountsByItem(amounts: BudgetAmountInput[]): Map<string, BudgetAmountInput[]> {
  const map = new Map<string, BudgetAmountInput[]>()
  for (const a of amounts) {
    let list = map.get(a.itemId)
    if (!list) map.set(a.itemId, (list = []))
    list.push(a)
  }
  for (const list of map.values()) list.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  return map
}

/** The amount row in effect in `month`: the latest one on or before it. Null before the item's first amount. */
export function amountInEffect(sorted: BudgetAmountInput[] | undefined, month: string): BudgetAmountInput | null {
  if (!sorted) return null
  let found: BudgetAmountInput | null = null
  for (const a of sorted) {
    if (a.month > month) break
    found = a
  }
  return found
}

export type BudgetChange = 'new' | 'changed' | 'stopped' | null

export interface BudgetLine {
  id: string
  name: string
  kind: BudgetKind
  notes: string | null
  /** Monthly amount in EUR, decimal string ("950.00"). "0.00" only for an item stopped this month. */
  amount: string
  /** Amount in the previous month, or null when the item had not started (or was stopped). */
  previousAmount: string | null
  /** Month the amount in effect was set. */
  effectiveFrom: string
  /** What happened to this item in this month compared with the previous month. */
  change: BudgetChange
}

export interface BudgetTotals {
  income: string
  expense: string
  /** income - expense: what is left each month. */
  remaining: string
}

export interface BudgetMonthResult {
  month: string
  currentMonth: string
  lines: BudgetLine[]
  totals: BudgetTotals
  previousTotals: BudgetTotals
  /** Number of items whose amount changed, started or stopped in this month. */
  changeCount: number
}

function totalsOf(amounts: { kind: BudgetKind, cents: bigint }[]): BudgetTotals {
  const sum = { income: 0n, expense: 0n }
  for (const a of amounts) sum[a.kind] += a.cents
  return {
    income: minorToDecimal(sum.income),
    expense: minorToDecimal(sum.expense),
    remaining: minorToDecimal(sum.income - sum.expense),
  }
}

function monthTotals(items: BudgetItemInput[], byItem: Map<string, BudgetAmountInput[]>, month: string): BudgetTotals {
  return totalsOf(items.map(i => ({ kind: i.kind, cents: BigInt(amountInEffect(byItem.get(i.id), month)?.amount ?? 0) })))
}

const KIND_ORDER: Record<BudgetKind, number> = { income: 0, expense: 1 }

/**
 * The budget of one month: every item with a non-zero amount in effect, plus items stopped in that month
 * (shown with 0 so the change is visible). Lines are sorted by kind, then amount (largest first), then name.
 */
export function computeBudgetMonth(
  items: BudgetItemInput[],
  amounts: BudgetAmountInput[],
  month: string,
  currentMonth: string,
): BudgetMonthResult {
  const byItem = amountsByItem(amounts)
  const previousMonth = addMonthsToMonth(month, -1)
  const lines: BudgetLine[] = []
  for (const item of items) {
    const list = byItem.get(item.id)
    const now = amountInEffect(list, month)
    if (!now) continue
    const before = amountInEffect(list, previousMonth)
    const prevAmount = before && before.amount > 0 ? before.amount : null
    if (now.amount === 0 && (prevAmount === null || now.month !== month)) continue
    let change: BudgetChange = null
    if (now.month === month) {
      if (now.amount === 0) change = 'stopped'
      else if (prevAmount === null) change = 'new'
      else if (prevAmount !== now.amount) change = 'changed'
    }
    lines.push({
      id: item.id,
      name: item.name,
      kind: item.kind,
      notes: item.notes,
      amount: minorToDecimal(now.amount),
      previousAmount: prevAmount === null ? null : minorToDecimal(prevAmount),
      effectiveFrom: now.month,
      change,
    })
  }
  lines.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || Number(BigInt(b.amount.replace('.', '')) - BigInt(a.amount.replace('.', '')))
    || a.name.localeCompare(b.name))
  return {
    month,
    currentMonth,
    lines,
    totals: monthTotals(items, byItem, month),
    previousTotals: monthTotals(items, byItem, previousMonth),
    changeCount: lines.filter(l => l.change !== null).length,
  }
}

export interface BudgetHistoryPoint extends BudgetTotals {
  month: string
}

export interface BudgetChangeEntry {
  itemId: string
  name: string
  kind: BudgetKind
  month: string
  /** New monthly amount ("0.00" = stopped). */
  amount: string
  /** Amount in effect just before this change, or null for the item's first amount. */
  previousAmount: string | null
}

export interface BudgetHistoryResult {
  range: { from: string, to: string, preset: BudgetRangePreset | null }
  currentMonth: string
  points: BudgetHistoryPoint[]
  /** Amount changes within the range, newest first. */
  changes: BudgetChangeEntry[]
}

export class BudgetRangeError extends Error {}

/**
 * Resolve a history range. Presets end at the later of the current month and the last planned change, so
 * scheduled future changes are visible. ALL starts at the earliest amount.
 */
export function resolveBudgetRange(
  amounts: BudgetAmountInput[],
  currentMonth: string,
  q: { preset?: BudgetRangePreset | null, from?: string, to?: string },
): { from: string, to: string, preset: BudgetRangePreset | null } {
  if (q.from && q.to) {
    if (q.from > q.to) throw new BudgetRangeError('from must be on or before to')
    if (monthSpan(q.from, q.to) > MAX_BUDGET_MONTHS) throw new BudgetRangeError(`Range is limited to ${MAX_BUDGET_MONTHS} months`)
    return { from: q.from, to: q.to, preset: null }
  }
  const preset = q.preset ?? '12M'
  let last = currentMonth
  let first = currentMonth
  for (const a of amounts) {
    if (a.month > last) last = a.month
    if (a.month < first) first = a.month
  }
  if (preset === 'ALL') {
    const from = monthSpan(first, last) > MAX_BUDGET_MONTHS ? addMonthsToMonth(last, -(MAX_BUDGET_MONTHS - 1)) : first
    return { from, to: last, preset }
  }
  const span = preset === '24M' ? 24 : 12
  // Show the last `span` months up to the current month, extended forward to any planned change.
  return { from: addMonthsToMonth(currentMonth, -(span - 1)), to: last, preset }
}

export function computeBudgetHistory(
  items: BudgetItemInput[],
  amounts: BudgetAmountInput[],
  range: { from: string, to: string, preset: BudgetRangePreset | null },
  currentMonth: string,
): BudgetHistoryResult {
  const byItem = amountsByItem(amounts)
  const points = monthsBetween(range.from, range.to).map(month => ({ month, ...monthTotals(items, byItem, month) }))
  const itemById = new Map(items.map(i => [i.id, i]))
  const changes: BudgetChangeEntry[] = []
  for (const [itemId, list] of byItem) {
    const item = itemById.get(itemId)
    if (!item) continue
    list.forEach((a, i) => {
      if (a.month < range.from || a.month > range.to) return
      const prev = i > 0 ? list[i - 1]! : null
      changes.push({
        itemId,
        name: item.name,
        kind: item.kind,
        month: a.month,
        amount: minorToDecimal(a.amount),
        previousAmount: prev ? minorToDecimal(prev.amount) : null,
      })
    })
  }
  changes.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.name.localeCompare(b.name)))
  return { range, currentMonth, points, changes }
}
