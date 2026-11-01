// API response shapes shared by the client. Money is always an exact decimal string ("1234.56").

export type AssetCategory = 'bank' | 'investment' | 'crypto' | 'real_estate' | 'cash' | 'other'
export type ValuationSource = 'manual' | 'import' | 'api'

export interface ValuationDTO {
  id: string
  assetId: string
  date: string
  value: string
  source: ValuationSource
  createdAt: string
  updatedAt: string
}

export interface AssetDTO {
  id: string
  name: string
  category: AssetCategory
  currency: string
  description: string | null
  color: string | null
  displayColor: string
  currencyLocked: boolean
  valuationCount: number
  createdAt: string
  updatedAt: string
}

export interface AssetDetailDTO extends AssetDTO {
  /** Latest balance in the asset's own currency (8 decimals for BTC). */
  latestValuation: ValuationDTO | null
  /** For BTC assets: latest balance x latest BTC-EUR rate. Null for EUR/other currencies or without a rate. */
  latestEurValue: { value: string, rate: string, rateDate: string, rateStale: boolean } | null
}

export interface RateDTO {
  date: string
  /** EUR per unit, exact decimal string. */
  rate: string
  source: string
}

import type { BudgetHistoryResult, BudgetKind, BudgetMonthResult } from '../utils/budget'

export type { DashboardResult as DashboardDTO } from '../utils/finance'

// Budget. Amounts are monthly EUR decimal strings ("950.00"); months are "YYYY-MM".

export type BudgetItemStatus = 'active' | 'stopped' | 'planned'

export interface BudgetItemDTO {
  id: string
  name: string
  kind: BudgetKind
  notes: string | null
  /** active: non-zero amount this month; stopped: 0 this month; planned: first amount is in a future month. */
  status: BudgetItemStatus
  currentAmount: string | null
  currentSince: string | null
  startMonth: string | null
  nextChange: { month: string, amount: string } | null
  amountCount: number
  createdAt: string
  updatedAt: string
}

export interface BudgetAmountDTO {
  id: string
  month: string
  amount: string
  /** Amount it replaced; null for the item's first amount. */
  previousAmount: string | null
  createdAt: string
  updatedAt: string
}

export interface BudgetItemDetailDTO extends BudgetItemDTO {
  /** Newest first. */
  amounts: BudgetAmountDTO[]
}

export type BudgetHistoryDTO = BudgetHistoryResult

export interface BudgetMonthDTO extends BudgetMonthResult {
  previousMonth: string
  nextMonth: string
  itemCount: number
}
