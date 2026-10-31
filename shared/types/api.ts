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
  latestValuation: ValuationDTO | null
}

export type { DashboardResult as DashboardDTO } from '../utils/finance'
