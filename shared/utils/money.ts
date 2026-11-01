// Exact amounts in integer minor units: cents for fiat currencies, satoshis (8 decimals) for BTC.

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'BTC'] as const
export type Currency = (typeof SUPPORTED_CURRENCIES)[number]
export const AGGREGATION_CURRENCY: Currency = 'EUR'

/** Crypto units. Their balances are stored in the unit itself and converted to EUR with daily rates. */
export const CRYPTO_CURRENCIES = ['BTC'] as const satisfies readonly Currency[]
/** Currencies converted to EUR for totals, using the stored daily rates. */
export const CONVERTED_CURRENCIES: readonly string[] = CRYPTO_CURRENCIES

const DECIMALS: Record<Currency, number> = { EUR: 2, USD: 2, GBP: 2, CHF: 2, CAD: 2, AUD: 2, BTC: 8 }

/** Number of decimal places stored for a currency (2 for fiat, 8 for BTC). */
export function currencyDecimals(currency: string): number {
  return DECIMALS[currency as Currency] ?? 2
}

/** Largest absolute minor-unit value: just under 10^15 (9 999 999 999 999.99 EUR, 9 999 999.99999999 BTC). */
export const MAX_ABS_MINOR = 999_999_999_999_999
export const MAX_ABS_MINOR_BIG = BigInt(MAX_ABS_MINOR)

const decimalRes = new Map<number, RegExp>()
function decimalRe(decimals: number): RegExp {
  let re = decimalRes.get(decimals)
  if (!re) decimalRes.set(decimals, (re = new RegExp(`^(-)?(\\d{1,${15 - decimals}})(?:\\.(\\d{1,${decimals}}))?$`)))
  return re
}

export class MoneyError extends Error {}

/**
 * Parse a decimal string such as "1234.5", "-0.07" or "100" into integer minor units.
 * Rejects more than `decimals` decimal places (2 by default), exponents, separators, and out-of-range values.
 */
export function parseDecimalToMinor(input: string, decimals = 2): number {
  const value = input.trim()
  const match = decimalRe(decimals).exec(value)
  if (!match) {
    throw new MoneyError(decimals === 2
      ? 'Amount must be a decimal number with at most two decimal places, e.g. 1234.56'
      : `Amount must be a decimal number with at most ${decimals} decimal places`)
  }
  const [, sign, whole, frac = ''] = match
  const minor = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0'))
  if (minor > MAX_ABS_MINOR_BIG) {
    throw new MoneyError('Amount is out of range')
  }
  const signed = sign ? -minor : minor
  // Avoid returning -0.
  return signed === 0n ? 0 : Number(signed)
}

/** Format integer minor units (number or bigint) as an exact decimal string, e.g. 123456 -> "1234.56". */
export function minorToDecimal(minor: number | bigint, decimals = 2): string {
  const big = typeof minor === 'bigint' ? minor : toBigIntChecked(minor)
  const negative = big < 0n
  const abs = negative ? -big : big
  const unit = 10n ** BigInt(decimals)
  const whole = abs / unit
  const frac = (abs % unit).toString().padStart(decimals, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

const RATE_RE = /^\d{1,12}(?:\.\d{1,12})?$/

/** A positive exchange rate as a decimal string, e.g. "69987.075" (EUR per unit). */
export function isValidRate(rate: string): boolean {
  return RATE_RE.test(rate) && /[1-9]/.test(rate)
}

/**
 * Convert `minor` units of a currency with `decimals` decimals into EUR cents at `rate` (EUR per unit),
 * exactly, rounding half away from zero. 10_000_000 sats (0.1 BTC) at "69987.075" -> 699871n cents.
 */
export function convertMinor(minor: number, decimals: number, rate: string): bigint {
  const [whole, frac = ''] = rate.split('.')
  const rateUnits = BigInt(whole! + frac)
  const product = toBigIntChecked(minor) * rateUnits * 100n
  const divisor = 10n ** BigInt(decimals + frac.length)
  const negative = product < 0n
  const abs = negative ? -product : product
  const rounded = (abs + divisor / 2n) / divisor
  return negative ? -rounded : rounded
}

export function toBigIntChecked(minor: number): bigint {
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`Not a safe integer amount: ${minor}`)
  }
  return BigInt(minor)
}

/** Exact sum of minor-unit amounts using BigInt. */
export function sumMinor(values: Iterable<number>): bigint {
  let total = 0n
  for (const v of values) total += toBigIntChecked(v)
  return total
}

export function isValidMinor(minor: number): boolean {
  return Number.isSafeInteger(minor) && Math.abs(minor) <= MAX_ABS_MINOR
}
