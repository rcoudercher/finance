import { z } from 'zod'
import { isValidIsoDate } from './dates'
import { isValidRate, MoneyError, parseDecimalToMinor, SUPPORTED_CURRENCIES } from './money'
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

/**
 * Amount as a decimal string ("1234.56", "0.1"). Its allowed precision depends on the asset's currency
 * (2 decimals for fiat, 8 for BTC), so the repository converts it to minor units once the asset is known.
 */
export const decimalString = z.string().trim().regex(/^-?\d{1,15}(\.\d{1,8})?$/, 'Amount must be a decimal number such as 1234.56')

export const valuationCreateSchema = z.object({
  date: isoDate,
  value: decimalString,
  source: z.enum(VALUATION_SOURCE_VALUES).default('manual'),
}).strict()

export const valuationUpdateSchema = z.object({
  date: isoDate.optional(),
  value: decimalString.optional(),
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

export const rateCurrencySchema = z.enum(['BTC'])

export const ratesQuerySchema = z.object({
  currency: rateCurrencySchema,
  from: isoDate.optional(),
  to: isoDate.optional(),
})

/** Upsert daily EUR rates for one currency: { currency: "BTC", source: "coinbase:spot", rates: [{ date, rate }] }. */
export const ratesUpsertSchema = z.object({
  currency: rateCurrencySchema,
  source: z.string().trim().min(1).max(50),
  rates: z.array(z.object({
    date: isoDate,
    rate: z.string().trim().refine(isValidRate, 'Rate must be a positive decimal number such as 69987.075'),
  }).strict()).min(1).max(5000),
}).strict()

export type AssetCreateInput = z.input<typeof assetCreateSchema>
export type ValuationCreateInput = z.input<typeof valuationCreateSchema>
