// Calendar-date helpers. A "calendar date" is a YYYY-MM-DD string with no time or zone.
// "Today" and timestamp conversions use the Europe/Paris calendar.

export const APP_TIME_ZONE = 'Europe/Paris'
const DAY_MS = 86_400_000
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const parisFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Calendar date in Europe/Paris for an instant (defaults to now). */
export function parisDate(instant: Date | number = Date.now()): string {
  const parts = parisFormatter.formatToParts(typeof instant === 'number' ? new Date(instant) : instant)
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900 || y > 2999) return false
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/** Days since 1970-01-01 for a calendar date (zone-independent). */
export function toEpochDay(date: string): number {
  const m = ISO_DATE_RE.exec(date)
  if (!m) throw new Error(`Invalid date: ${date}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS
}

export function fromEpochDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return fromEpochDay(toEpochDay(date) + days)
}

export function diffDays(later: string, earlier: string): number {
  return toEpochDay(later) - toEpochDay(earlier)
}

/** Add calendar months, clamping the day to the target month's length (e.g. 31 Mar - 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const m = ISO_DATE_RE.exec(date)
  if (!m) throw new Error(`Invalid date: ${date}`)
  const y = Number(m[1])
  const mo = Number(m[2]) - 1 + months
  const targetYear = y + Math.floor(mo / 12)
  const targetMonth = ((mo % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const day = Math.min(Number(m[3]), lastDay)
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10)
}

/** Last day of the month containing `date`. */
export function endOfMonth(date: string): string {
  const m = ISO_DATE_RE.exec(date)
  if (!m) throw new Error(`Invalid date: ${date}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10)
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b
}
