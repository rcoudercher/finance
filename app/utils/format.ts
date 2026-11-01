// European formatting: money as "1 234,56 €" or "0,1 BTC" (fr-FR), dates as "31 Oct 2026" / "31/10/2026" (en-GB).

import { CRYPTO_CURRENCIES } from '#shared/utils/money'

const moneyFormatters = new Map<string, Intl.NumberFormat>()
const compactFormatters = new Map<string, Intl.NumberFormat>()

type NumericInput = number | bigint | `${number}`

export function formatMoney(value: string | number | null | undefined, currency = 'EUR'): string {
  if (value === null || value === undefined || value === '') return '—'
  let f = moneyFormatters.get(currency)
  if (!f) moneyFormatters.set(currency, (f = new Intl.NumberFormat('fr-FR', amountFormatOptions(currency))))
  // Intl formats decimal strings exactly, without going through floating point.
  return f.format(value as NumericInput)
}

const isCrypto = (currency: string) => (CRYPTO_CURRENCIES as readonly string[]).includes(currency)

/** Intl options for an amount: 2 decimals for fiat, up to 8 significant decimals for BTC ("0,1 BTC"). */
export function amountFormatOptions(currency: string): Intl.NumberFormatOptions {
  return isCrypto(currency)
    ? { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 8 }
    : { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }
}

export function formatMoneyCompact(value: number, currency = 'EUR'): string {
  let f = compactFormatters.get(currency)
  if (!f) {
    compactFormatters.set(currency, (f = new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
    })))
  }
  return f.format(value)
}

const dateLong = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const dateShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' })

const asUtc = (iso: string) => new Date(`${iso}T00:00:00Z`)

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateLong.format(asUtc(iso)) : '—'
}

export function formatDateShort(iso: string): string {
  return dateShort.format(asUtc(iso))
}

export function formatMonthYear(iso: string): string {
  return monthYear.format(asUtc(iso))
}

export function formatTimestamp(iso: string): string {
  return dateTime.format(new Date(iso))
}

export function formatAge(days: number | null): string {
  if (days === null) return 'never'
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export const CATEGORY_OPTIONS = [
  { label: 'Bank', value: 'bank' },
  { label: 'Investment', value: 'investment' },
  { label: 'Crypto', value: 'crypto' },
  { label: 'Real estate', value: 'real_estate' },
  { label: 'Cash', value: 'cash' },
  { label: 'Other', value: 'other' },
] as const

export function categoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find(o => o.value === value)?.label ?? value
}

export const SOURCE_OPTIONS = [
  { label: 'Manual', value: 'manual' },
  { label: 'Import', value: 'import' },
  { label: 'API', value: 'api' },
] as const

/** Error message from a $fetch / useFetch error. */
export function apiErrorMessage(error: unknown): string {
  const e = error as { data?: { message?: string }, message?: string } | null
  return e?.data?.message ?? e?.message ?? 'Something went wrong'
}
