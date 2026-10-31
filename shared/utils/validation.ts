import { z } from 'zod'
import { isValidIsoDate } from './dates'
import { MoneyError, parseDecimalToMinor, SUPPORTED_CURRENCIES } from './money'
import { RANGE_PRESETS } from './finance'

export const ASSET_CATEGORY_VALUES = ['bank', 'investment', 'crypto', 'real_estate', 'cash', 'other'] as const
export const VALUATION_SOURCE_VALUES = ['manual', 'import', 'api'] as const

export const CATEGORY_LABELS: Record<(typeof ASSET_CATEGORY_VALUES)[number], string> = {
  bank: 'Bank',
  investment: 'Investment',
  crypto: 'Crypto',
  real_estate: 'Real estate',
  cash: 'Cash',
  other: 'Other',
}

export const isoDate = z.string().refine(isValidIsoDate, 'Must be a valid date in YYYY-MM-DD format')

/** Decimal string with up to two decimals, converted to integer minor units. */
export const decimalAmount = z.string().transform((value, ctx) => {
  try {
    return parseDecimalToMinor(value)
  }
  catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof MoneyError ? e.message : 'Invalid amount' })
    return z.NEVER
  }
})

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex color like #3b82f6')
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform(v => (v ? v : null))

export const assetCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  category: z.enum(ASSET_CATEGORY_VALUES),
  currency: z.enum(SUPPORTED_CURRENCIES),
  description: optionalText(1000),
  color: hexColor.nullish().transform(v => v?.toLowerCase() ?? null),
}).strict()

export const assetUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  category: z.enum(ASSET_CATEGORY_VALUES).optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  description: optionalText(1000).optional(),
  color: hexColor.nullish().transform(v => v?.toLowerCase() ?? null).optional(),
}).strict()

export const valuationCreateSchema = z.object({
  date: isoDate,
  value: decimalAmount,
  source: z.enum(VALUATION_SOURCE_VALUES).default('manual'),
}).strict()

export const valuationUpdateSchema = z.object({
  date: isoDate.optional(),
  value: decimalAmount.optional(),
  source: z.enum(VALUATION_SOURCE_VALUES).optional(),
}).strict()

export const valuationListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
}).refine(q => !q.from || !q.to || q.from <= q.to, { message: 'from must be on or before to', path: ['from'] })

export const dashboardQuerySchema = z.object({
  range: z.enum(RANGE_PRESETS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
}).refine(q => (q.from === undefined) === (q.to === undefined), { message: 'from and to must be provided together', path: ['from'] })
  .refine(q => !q.from || !q.to || q.from <= q.to, { message: 'from must be on or before to', path: ['from'] })

export type AssetCreateInput = z.input<typeof assetCreateSchema>
export type ValuationCreateInput = z.input<typeof valuationCreateSchema>
