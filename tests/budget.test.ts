// Budget: month helpers, versioned amounts, monthly totals and history, against a fresh in-memory database.
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, runMigrations, type DB } from '../server/database/client'
import { budgetAmounts } from '../server/database/schema'
import { DomainError } from '../server/utils/repository'
import {
  budgetHistory, budgetMonth, createBudgetItem, deleteBudgetAmount, deleteBudgetItem, getBudgetItem, listBudgetItems,
  setBudgetAmount, updateBudgetItem,
} from '../server/utils/budget'
import { addMonthsToMonth, isValidMonth, monthsBetween, monthSpan, resolveBudgetRange } from '../shared/utils/budget'
import { budgetItemCreateSchema, budgetHistoryQuerySchema } from '../shared/utils/validation'

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

const item = (name: string, kind: 'income' | 'expense', month: string, amount: string) =>
  createBudgetItem(db, budgetItemCreateSchema.parse({ name, kind, month, amount }))

describe('month helpers', () => {
  it('validates, adds and spans months across years', () => {
    expect(isValidMonth('2026-11')).toBe(true)
    expect(isValidMonth('2026-13')).toBe(false)
    expect(isValidMonth('2026-1')).toBe(false)
    expect(isValidMonth('2026-11-01')).toBe(false)
    expect(addMonthsToMonth('2026-11', 2)).toBe('2027-01')
    expect(addMonthsToMonth('2026-01', -1)).toBe('2025-12')
    expect(monthSpan('2025-12', '2026-02')).toBe(3)
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('rejects negative or over-precise amounts', () => {
    const base = { name: 'Rent', kind: 'expense', month: '2026-01' }
    expect(budgetItemCreateSchema.safeParse({ ...base, amount: '-1' }).success).toBe(false)
    expect(budgetItemCreateSchema.safeParse({ ...base, amount: '1.001' }).success).toBe(false)
    expect(budgetItemCreateSchema.parse({ ...base, amount: '950.5' }).amount).toBe(95050)
    expect(budgetItemCreateSchema.safeParse({ ...base, kind: 'savings', amount: '1' }).success).toBe(false)
    expect(budgetHistoryQuerySchema.safeParse({ from: '2026-01' }).success).toBe(false)
  })
})

describe('budget items and versioned amounts', () => {
  it('creates an item with its first amount and refuses a zero start', () => {
    const rent = item('Rent', 'expense', '2026-01', '900')
    expect(rent).toMatchObject({ kind: 'expense', status: 'active', currentAmount: '900.00', startMonth: '2026-01' })
    expect(rent.amounts).toEqual([expect.objectContaining({ month: '2026-01', amount: '900.00', previousAmount: null })])
    expectDomain(() => item('Nothing', 'expense', '2026-01', '0'), 400)
  })

  it('keeps every change, corrects a month in place, and carries amounts forward', () => {
    const rent = item('Rent', 'expense', '2026-01', '900')
    setBudgetAmount(db, rent.id, '2026-09', 95000)
    setBudgetAmount(db, rent.id, '2026-09', 960_00) // correction, not a new row
    const detail = getBudgetItem(db, rent.id)
    expect(detail.amounts.map(a => [a.month, a.amount, a.previousAmount])).toEqual([
      ['2026-09', '960.00', '900.00'],
      ['2026-01', '900.00', null],
    ])
    expect(budgetMonth(db, '2026-05', '2026-11-01').lines[0]).toMatchObject({ amount: '900.00', change: null })
    expect(budgetMonth(db, '2026-09', '2026-11-01').lines[0]).toMatchObject({ amount: '960.00', previousAmount: '900.00', change: 'changed' })
    expect(budgetMonth(db, '2027-06', '2026-11-01').lines[0]).toMatchObject({ amount: '960.00', effectiveFrom: '2026-09' })
    expect(budgetMonth(db, '2025-12', '2026-11-01').lines).toEqual([])
  })

  it('stops an item with 0: shown as stopped that month, gone afterwards, and can restart', () => {
    const gym = item('Gym', 'expense', '2026-01', '30')
    setBudgetAmount(db, gym.id, '2026-06', 0)
    expect(budgetMonth(db, '2026-06', '2026-11-01').lines).toEqual([
      expect.objectContaining({ name: 'Gym', amount: '0.00', previousAmount: '30.00', change: 'stopped' }),
    ])
    expect(budgetMonth(db, '2026-06', '2026-11-01').totals.expense).toBe('0.00')
    expect(budgetMonth(db, '2026-07', '2026-11-01').lines).toEqual([])
    setBudgetAmount(db, gym.id, '2026-10', 3500)
    expect(budgetMonth(db, '2026-10', '2026-11-01').lines[0]).toMatchObject({ amount: '35.00', change: 'new' })
    expectDomain(() => setBudgetAmount(db, gym.id, '2026-01', 0), 400)
    expectDomain(() => setBudgetAmount(db, gym.id, '2025-12', 0), 400)
  })

  it('removes a change (previous amount carries on) but never the last one, nor leaves a stopped start', () => {
    const a = item('Phone', 'expense', '2026-01', '20')
    setBudgetAmount(db, a.id, '2026-03', 25_00)
    expect(deleteBudgetAmount(db, a.id, '2026-03').amounts).toHaveLength(1)
    expectDomain(() => deleteBudgetAmount(db, a.id, '2026-01'), 409)
    expectDomain(() => deleteBudgetAmount(db, a.id, '2026-05'), 404)
    setBudgetAmount(db, a.id, '2026-04', 0)
    expectDomain(() => deleteBudgetAmount(db, a.id, '2026-01'), 409)
  })

  it('updates fields, 404s unknown IDs, and deletes an item with its history', () => {
    const a = item('Salary', 'income', '2026-01', '3000')
    expect(updateBudgetItem(db, a.id, { name: 'Net salary', notes: 'after tax' })).toMatchObject({ name: 'Net salary', notes: 'after tax', kind: 'income' })
    expectDomain(() => getBudgetItem(db, 'nope'), 404)
    expectDomain(() => getBudgetItem(db, '01m6b2z3mxzhwhaze9y62a3w7y'), 404)
    setBudgetAmount(db, a.id, '2026-06', 3200_00)
    expect(deleteBudgetItem(db, a.id)).toEqual({ amountsDeleted: 2 })
    expect(listBudgetItems(db)).toEqual([])
    expect(db.select().from(budgetAmounts).all()).toEqual([])
  })

  it('reports status: planned, active, stopped, with the next change', () => {
    const now = new Date()
    const thisMonth = `${now.getFullYear() + 1}-01` // a month that is certainly in the future
    const planned = item('New car loan', 'expense', thisMonth, '250')
    expect(getBudgetItem(db, planned.id)).toMatchObject({ status: 'planned', currentAmount: null, nextChange: { month: thisMonth, amount: '250.00' } })
    const old = item('Old sub', 'expense', '2020-01', '10')
    expect(getBudgetItem(db, old.id)).toMatchObject({ status: 'active', currentAmount: '10.00', currentSince: '2020-01' })
    setBudgetAmount(db, old.id, '2021-01', 0)
    expect(getBudgetItem(db, old.id)).toMatchObject({ status: 'stopped', currentAmount: '0.00' })
  })
})

describe('monthly totals and history', () => {
  beforeEach(() => {
    const salary = item('Salary', 'income', '2026-01', '3000')
    item('Rent', 'expense', '2026-01', '900')
    item('Groceries', 'expense', '2026-01', '400.50')
    item('Netflix', 'expense', '2026-03', '19.99')
    setBudgetAmount(db, salary.id, '2026-07', 3150_00)
  })

  it('totals income, expenses and what remains', () => {
    const jan = budgetMonth(db, '2026-01', '2026-11-01')
    expect(jan.totals).toEqual({ income: '3000.00', expense: '1300.50', remaining: '1699.50' })
    const jul = budgetMonth(db, '2026-07', '2026-11-01')
    expect(jul.totals).toEqual({ income: '3150.00', expense: '1320.49', remaining: '1829.51' })
    expect(jul.previousTotals.income).toBe('3000.00')
    expect(jul.changeCount).toBe(1)
    expect(jul.lines.map(l => l.name)).toEqual(['Salary', 'Rent', 'Groceries', 'Netflix'])
    expect(budgetMonth(db, undefined, '2026-11-15').month).toBe('2026-11')
  })

  it('returns monthly points and a change log, newest first', () => {
    const h = budgetHistory(db, { from: '2026-01', to: '2026-12' }, '2026-11-01')
    expect(h.points).toHaveLength(12)
    expect(h.points[0]).toMatchObject({ month: '2026-01', remaining: '1699.50' })
    expect(h.points[2]).toMatchObject({ month: '2026-03', expense: '1320.49' })
    expect(h.changes[0]).toMatchObject({ name: 'Salary', month: '2026-07', amount: '3150.00', previousAmount: '3000.00' })
    expect(h.changes.at(-1)!.month).toBe('2026-01')
  })

  it('resolves presets up to the latest planned change', () => {
    const amounts = [{ id: 'a', itemId: 'x', month: '2024-05', amount: 1 }, { id: 'b', itemId: 'x', month: '2027-02', amount: 2 }]
    expect(resolveBudgetRange(amounts, '2026-11', {})).toEqual({ from: '2025-12', to: '2027-02', preset: '12M' })
    expect(resolveBudgetRange(amounts, '2026-11', { preset: '24M' })).toEqual({ from: '2024-12', to: '2027-02', preset: '24M' })
    expect(resolveBudgetRange(amounts, '2026-11', { preset: 'ALL' })).toEqual({ from: '2024-05', to: '2027-02', preset: 'ALL' })
    expectDomain(() => budgetHistory(db, { from: '1950-01', to: '2026-01' }), 400)
  })
})
