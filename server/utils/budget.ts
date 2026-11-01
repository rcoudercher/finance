import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { DB } from '../database/client'
import { budgetAmounts, budgetItems, type BudgetAmount, type BudgetItem } from '../database/schema'
import { minorToDecimal } from '../../shared/utils/money'
import { parisDate } from '../../shared/utils/dates'
import { isUlid, ulid } from '../../shared/utils/ulid'
import {
  addMonthsToMonth, amountInEffect, BudgetRangeError, computeBudgetHistory, computeBudgetMonth, monthOf, resolveBudgetRange,
  type BudgetRangePreset,
} from '../../shared/utils/budget'
import type { budgetItemCreateSchema, budgetItemUpdateSchema } from '../../shared/utils/validation'
import { DomainError, isUniqueViolation } from './repository'

type BudgetItemStatus = 'active' | 'stopped' | 'planned'

const currentMonth = () => monthOf(parisDate())

function serializeAmounts(sorted: BudgetAmount[]) {
  // Newest first, each with the amount it replaced.
  return sorted.map((a, i) => ({
    id: a.id,
    month: a.month,
    amount: minorToDecimal(a.amount),
    previousAmount: i > 0 ? minorToDecimal(sorted[i - 1]!.amount) : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  })).reverse()
}

function serializeItem(item: BudgetItem, sorted: BudgetAmount[], month: string) {
  const now = amountInEffect(sorted, month)
  const next = sorted.find(a => a.month > month) ?? null
  const status: BudgetItemStatus = !now ? 'planned' : now.amount === 0 ? 'stopped' : 'active'
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    notes: item.notes,
    status,
    /** Monthly amount in effect this month; null before the first amount. */
    currentAmount: now ? minorToDecimal(now.amount) : null,
    currentSince: now?.month ?? null,
    startMonth: sorted[0]?.month ?? null,
    /** Next planned change after this month, if any. */
    nextChange: next ? { month: next.month, amount: minorToDecimal(next.amount) } : null,
    amountCount: sorted.length,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

function amountsOf(db: DB, itemId: string): BudgetAmount[] {
  return db.select().from(budgetAmounts).where(eq(budgetAmounts.itemId, itemId)).orderBy(asc(budgetAmounts.month)).all()
}

function findItem(db: DB, id: string): BudgetItem {
  if (!isUlid(id)) throw new DomainError(404, 'Budget item not found')
  const row = db.select().from(budgetItems).where(eq(budgetItems.id, id)).get()
  if (!row) throw new DomainError(404, 'Budget item not found')
  return row
}

export function listBudgetItems(db: DB) {
  const items = db.select().from(budgetItems).orderBy(asc(budgetItems.createdAt), asc(budgetItems.id)).all()
  const all = db.select().from(budgetAmounts).orderBy(asc(budgetAmounts.month)).all()
  const month = currentMonth()
  return items.map(i => serializeItem(i, all.filter(a => a.itemId === i.id), month))
}

export function getBudgetItem(db: DB, id: string) {
  const item = findItem(db, id)
  const sorted = amountsOf(db, id)
  return { ...serializeItem(item, sorted, currentMonth()), amounts: serializeAmounts(sorted) }
}

export function createBudgetItem(db: DB, input: z.output<typeof budgetItemCreateSchema>, now = new Date()) {
  const { month, amount, ...fields } = input
  if (amount === 0) throw new DomainError(400, 'The first amount of a budget item must be greater than zero')
  const id = ulid(now)
  db.transaction((tx) => {
    tx.insert(budgetItems).values({ id, ...fields, createdAt: now, updatedAt: now }).run()
    tx.insert(budgetAmounts).values({ id: randomUUID(), itemId: id, month, amount, createdAt: now, updatedAt: now }).run()
  })
  return getBudgetItem(db, id)
}

export function updateBudgetItem(db: DB, id: string, input: z.output<typeof budgetItemUpdateSchema>) {
  findItem(db, id)
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
  db.update(budgetItems).set({ ...patch, updatedAt: new Date() }).where(eq(budgetItems.id, id)).run()
  return getBudgetItem(db, id)
}

/** Permanently delete a budget item and its whole amount history. */
export function deleteBudgetItem(db: DB, id: string): { amountsDeleted: number } {
  return db.transaction((tx) => {
    findItem(tx as unknown as DB, id)
    const removed = tx.delete(budgetAmounts).where(eq(budgetAmounts.itemId, id)).run()
    tx.delete(budgetItems).where(eq(budgetItems.id, id)).run()
    return { amountsDeleted: removed.changes }
  })
}

/**
 * Set an item's monthly amount from `month` on (insert, or correct the existing change for that month).
 * The item's first amount cannot be 0: delete the item instead.
 */
export function setBudgetAmount(db: DB, itemId: string, month: string, amount: number, now = new Date()) {
  return db.transaction((tx) => {
    const t = tx as unknown as DB
    findItem(t, itemId)
    const sorted = amountsOf(t, itemId)
    const first = sorted[0]
    if (amount === 0 && (!first || month <= first.month)) {
      throw new DomainError(400, 'The first amount of a budget item must be greater than zero; to remove the item, delete it')
    }
    const existing = sorted.find(a => a.month === month)
    try {
      if (existing) {
        tx.update(budgetAmounts).set({ amount, updatedAt: now }).where(eq(budgetAmounts.id, existing.id)).run()
      }
      else {
        tx.insert(budgetAmounts).values({ id: randomUUID(), itemId, month, amount, createdAt: now, updatedAt: now }).run()
      }
    }
    catch (e) {
      if (isUniqueViolation(e)) throw new DomainError(409, 'This item already has an amount for this month')
      throw e
    }
    tx.update(budgetItems).set({ updatedAt: now }).where(eq(budgetItems.id, itemId)).run()
    return getBudgetItem(t, itemId)
  })
}

/** Remove the change made in `month`; the previous amount then carries on. The only remaining amount cannot be removed. */
export function deleteBudgetAmount(db: DB, itemId: string, month: string) {
  return db.transaction((tx) => {
    const t = tx as unknown as DB
    findItem(t, itemId)
    const sorted = amountsOf(t, itemId)
    const target = sorted.find(a => a.month === month)
    if (!target) throw new DomainError(404, 'Budget amount not found')
    if (sorted.length === 1) throw new DomainError(409, 'An item needs at least one amount; delete the item instead')
    // Removing the first amount must not leave a 0 ("stopped") as the item's first amount.
    if (target === sorted[0] && sorted[1]!.amount === 0) {
      throw new DomainError(409, 'Removing this amount would make the item start as stopped')
    }
    tx.delete(budgetAmounts).where(eq(budgetAmounts.id, target.id)).run()
    tx.update(budgetItems).set({ updatedAt: new Date() }).where(eq(budgetItems.id, itemId)).run()
    return getBudgetItem(t, itemId)
  })
}

function loadAll(db: DB) {
  const items = db.select().from(budgetItems).all()
  const amounts = db.select({ id: budgetAmounts.id, itemId: budgetAmounts.itemId, month: budgetAmounts.month, amount: budgetAmounts.amount })
    .from(budgetAmounts).all()
  return { items, amounts }
}

export function budgetMonth(db: DB, month?: string, today = parisDate()) {
  const { items, amounts } = loadAll(db)
  const current = monthOf(today)
  const result = computeBudgetMonth(items, amounts, month ?? current, current)
  return {
    ...result,
    previousMonth: addMonthsToMonth(result.month, -1),
    nextMonth: addMonthsToMonth(result.month, 1),
    itemCount: items.length,
  }
}

export function budgetHistory(db: DB, q: { range?: BudgetRangePreset, from?: string, to?: string }, today = parisDate()) {
  const { items, amounts } = loadAll(db)
  const current = monthOf(today)
  try {
    const range = resolveBudgetRange(amounts, current, { preset: q.range ?? null, from: q.from, to: q.to })
    return computeBudgetHistory(items, amounts, range, current)
  }
  catch (e) {
    if (e instanceof BudgetRangeError) throw new DomainError(400, e.message)
    throw e
  }
}
