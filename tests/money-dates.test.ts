import { describe, expect, it } from 'vitest'
import { convertMinor, currencyDecimals, isValidRate, MAX_ABS_MINOR, MoneyError, minorToDecimal, parseDecimalToMinor, sumMinor } from '../shared/utils/money'
import { addMonths, endOfMonth, isValidIsoDate, parisDate } from '../shared/utils/dates'
import { valuationCreateSchema } from '../shared/utils/validation'

describe('money: decimal strings <-> integer minor units', () => {
  it.each([
    ['0', 0], ['0.00', 0], ['-0', 0], ['1', 100], ['1.5', 150], ['1.05', 105],
    ['0.07', 7], ['-0.07', -7], ['1234.56', 123456], [' 42.10 ', 4210],
    ['0.29', 29], ['1.13', 113], ['4.35', 435], // classic float traps
  ])('parses %j -> %d', (input, expected) => {
    expect(parseDecimalToMinor(input)).toBe(expected)
  })

  it.each(['', '1.234', '1e3', '1,5', '1 000', '.5', '5.', '+5', 'abc', '0x10', 'NaN', 'Infinity'])(
    'rejects %j', (input) => {
      expect(() => parseDecimalToMinor(input)).toThrow(MoneyError)
    },
  )

  it('enforces safe bounds', () => {
    expect(parseDecimalToMinor('9999999999999.99')).toBe(MAX_ABS_MINOR)
    expect(parseDecimalToMinor('-9999999999999.99')).toBe(-MAX_ABS_MINOR)
    expect(Number.isSafeInteger(MAX_ABS_MINOR)).toBe(true)
    expect(() => parseDecimalToMinor('99999999999999.00')).toThrow(MoneyError)
  })

  it('formats exactly, including bigint and negatives', () => {
    expect(minorToDecimal(0)).toBe('0.00')
    expect(minorToDecimal(7)).toBe('0.07')
    expect(minorToDecimal(-7)).toBe('-0.07')
    expect(minorToDecimal(123456)).toBe('1234.56')
    expect(minorToDecimal(10n ** 20n + 1n)).toBe('1000000000000000000.01')
    expect(() => minorToDecimal(0.5)).toThrow(MoneyError)
  })

  it('sums exactly with BigInt beyond Number precision', () => {
    // 0.1 + 0.2 style errors cannot happen in minor units
    expect(minorToDecimal(sumMinor([10, 20]))).toBe('0.30')
    const many = Array.from({ length: 100 }, () => MAX_ABS_MINOR)
    expect(sumMinor(many)).toBe(BigInt(MAX_ABS_MINOR) * 100n)
    expect(sumMinor(many) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('validation schema converts the value to minor units', () => {
    // The schema checks the shape; the repository applies the asset currency's precision (see db tests).
    expect(valuationCreateSchema.parse({ date: '2024-02-29', value: ' 10.5 ' })).toEqual({ date: '2024-02-29', value: '10.5', source: 'manual' })
    expect(valuationCreateSchema.safeParse({ date: '2024-02-29', value: 10.5 }).success).toBe(false)
    expect(valuationCreateSchema.safeParse({ date: '2024-02-29', value: '1e5' }).success).toBe(false)
    expect(valuationCreateSchema.safeParse({ date: '2024-02-29', value: '1,5' }).success).toBe(false)
  })
})

describe('calendar dates', () => {
  it('validates real calendar dates only', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2023-02-29')).toBe(false)
    expect(isValidIsoDate('2024-04-31')).toBe(false)
    expect(isValidIsoDate('2024-4-01')).toBe(false)
    expect(isValidIsoDate('2024-04-01T00:00:00Z')).toBe(false)
  })

  it('uses the Europe/Paris calendar for "today"', () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Paris (UTC+1 in winter)
    expect(parisDate(new Date('2024-12-31T23:30:00Z'))).toBe('2025-01-01')
    // 22:30 UTC on 30 Jun is 00:30 on 1 Jul in Paris (UTC+2 in summer)
    expect(parisDate(new Date('2024-06-30T22:30:00Z'))).toBe('2024-07-01')
    expect(parisDate(new Date('2024-06-30T21:30:00Z'))).toBe('2024-06-30')
    // DST change days
    expect(parisDate(new Date('2024-03-31T00:30:00Z'))).toBe('2024-03-31')
    expect(parisDate(new Date('2024-10-27T23:30:00Z'))).toBe('2024-10-28')
  })

  it('adds months with end-of-month clamping', () => {
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29')
    expect(addMonths('2023-03-31', -1)).toBe('2023-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2024-12-15', 1)).toBe('2025-01-15')
    expect(addMonths('2024-01-15', -13)).toBe('2022-12-15')
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29')
    expect(endOfMonth('2024-12-01')).toBe('2024-12-31')
  })
})

describe('money: BTC (8 decimals) and conversion', () => {
  it('parses and formats satoshis', () => {
    expect(currencyDecimals('BTC')).toBe(8)
    expect(currencyDecimals('EUR')).toBe(2)
    expect(parseDecimalToMinor('0.1', 8)).toBe(10_000_000)
    expect(parseDecimalToMinor('0.00000001', 8)).toBe(1)
    expect(parseDecimalToMinor('9999999.99999999', 8)).toBe(MAX_ABS_MINOR)
    expect(() => parseDecimalToMinor('0.000000001', 8)).toThrow(MoneyError)
    expect(() => parseDecimalToMinor('10000000', 8)).toThrow(MoneyError)
    expect(minorToDecimal(10_000_000, 8)).toBe('0.10000000')
    expect(minorToDecimal(-1, 8)).toBe('-0.00000001')
  })

  it('converts exactly to EUR cents, rounding half away from zero', () => {
    expect(convertMinor(10_000_000, 8, '69987.075')).toBe(699871n) // 6998.7075 -> 6998.71
    expect(convertMinor(10_000_000, 8, '69987.07')).toBe(699871n) // 6998.707 -> 6998.71
    expect(convertMinor(10_000_000, 8, '69987.04')).toBe(699870n) // 6998.704 -> 6998.70
    expect(convertMinor(-10_000_000, 8, '69987.075')).toBe(-699871n)
    expect(convertMinor(MAX_ABS_MINOR, 8, '100000')).toBe(100_000_000_000_000n) // 999 999 999 999.999 EUR, rounded up
    expect(convertMinor(MAX_ABS_MINOR, 8, '987654.321')).toBe(987_654_320_999_999n) // exact BigInt maths
    expect(convertMinor(12345, 2, '1')).toBe(12345n)
  })

  it('validates rates', () => {
    for (const r of ['69987.075', '1', '0.5', '0.000000000001']) expect(isValidRate(r)).toBe(true)
    for (const r of ['0', '0.0', '-1', '1e5', '1,5', '', '.5', '5.']) expect(isValidRate(r)).toBe(false)
  })
})
