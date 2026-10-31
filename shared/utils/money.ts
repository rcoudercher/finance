// Exact money handling in integer minor units (cents).
// All supported currencies have 2 decimal places.

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD'] as const
export type Currency = (typeof SUPPORTED_CURRENCIES)[number]
export const AGGREGATION_CURRENCY: Currency = 'EUR'

/** Largest absolute value accepted for a single valuation: 9 999 999 999 999.99 (just under 10^15 minor units). */
export const MAX_ABS_MINOR = 999_999_999_999_999
export const MAX_ABS_MINOR_BIG = BigInt(MAX_ABS_MINOR)

const DECIMAL_RE = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/

export class MoneyError extends Error {}

/**
 * Parse a decimal string such as "1234.5", "-0.07" or "100" into integer minor units.
 * Rejects more than two decimal places, exponents, separators, and out-of-range values.
 */
export function parseDecimalToMinor(input: string): number {
  const value = input.trim()
  const match = DECIMAL_RE.exec(value)
  if (!match) {
    throw new MoneyError('Amount must be a decimal number with at most two decimal places, e.g. 1234.56')
  }
  const [, sign, whole, frac = ''] = match
  const minor = BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'))
  if (minor > MAX_ABS_MINOR_BIG) {
    throw new MoneyError('Amount is out of range')
  }
  const signed = sign ? -minor : minor
  // Avoid returning -0.
  return signed === 0n ? 0 : Number(signed)
}

/** Format integer minor units (number or bigint) as an exact decimal string, e.g. 123456 -> "1234.56". */
export function minorToDecimal(minor: number | bigint): string {
  const big = typeof minor === 'bigint' ? minor : toBigIntChecked(minor)
  const negative = big < 0n
  const abs = negative ? -big : big
  const whole = abs / 100n
  const frac = (abs % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
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
