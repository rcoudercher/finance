// Store the daily BTC-EUR rate used to convert BTC assets to EUR (public Coinbase API, no key).
//
//   node scripts/btc-rate.mjs                     today's rate (Europe/Paris date) from the spot price
//   node scripts/btc-rate.mjs --from 2024-01-01   also backfill daily closes from that date to yesterday
//
// Rates are saved through the finance API (PUT /api/rates); a day that already has a rate is replaced, so
// reruns are harmless. On any error nothing is saved and it exits 1; the dashboard carries the last rate forward.

const FINANCE_URL = process.env.FINANCE_URL ?? 'http://127.0.0.1:8081'
const SPOT_URL = 'https://api.coinbase.com/v2/prices/BTC-EUR/spot'
const CANDLES_URL = 'https://api.exchange.coinbase.com/products/BTC-EUR/candles'
const DAY_MS = 86_400_000

const log = msg => console.log(`${new Date().toISOString()} ${msg}`)

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'user-agent': 'finance.example.com btc-rate', 'content-type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(20_000),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${options.method ?? 'GET'} ${url} -> ${res.status} ${body?.message ?? ''}`.trim())
  return body
}

/** Normalise a positive price to a decimal string with at most 8 decimals (rounded half up). */
export function toRate(value) {
  const str = typeof value === 'number' ? value.toFixed(8) : String(value).trim()
  const m = /^(\d+)(?:\.(\d+))?$/.exec(str)
  if (!m) throw new Error(`Invalid price: ${value}`)
  const [, whole, frac = ''] = m
  let units = BigInt(whole + frac.padEnd(8, '0').slice(0, 8))
  if (frac.length > 8 && frac[8] >= '5') units += 1n
  if (units <= 0n) throw new Error(`Invalid price: ${value}`)
  const s = units.toString().padStart(9, '0')
  return `${s.slice(0, -8)}.${s.slice(-8)}`.replace(/\.?0+$/, '')
}

const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function spotRate() {
  const body = await request(SPOT_URL)
  if (body?.data?.base !== 'BTC' || body?.data?.currency !== 'EUR') throw new Error(`Unexpected Coinbase response: ${JSON.stringify(body)}`)
  return toRate(body.data.amount)
}

/** Daily closes (UTC days) from `from` to yesterday, 300 days per Coinbase request. */
async function dailyCloses(from) {
  const out = new Map()
  const end = Date.parse(`${parisToday()}T00:00:00Z`) // today (excluded: today's rate comes from the spot price)
  for (let start = Date.parse(`${from}T00:00:00Z`); start < end; start += 300 * DAY_MS) {
    const stop = Math.min(start + 299 * DAY_MS, end - DAY_MS)
    const qs = `granularity=86400&start=${new Date(start).toISOString()}&end=${new Date(stop).toISOString()}`
    const candles = await request(`${CANDLES_URL}?${qs}`)
    if (!Array.isArray(candles)) throw new Error(`Unexpected candles response: ${JSON.stringify(candles).slice(0, 200)}`)
    for (const [time, , , , close] of candles) {
      const date = new Date(time * 1000).toISOString().slice(0, 10)
      if (date >= from && date < parisToday()) out.set(date, toRate(close))
    }
    await new Promise(r => setTimeout(r, 400)) // stay well under Coinbase's public rate limit
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, rate]) => ({ date, rate }))
}

async function save(source, rates) {
  await request(`${FINANCE_URL}/api/rates`, { method: 'PUT', body: JSON.stringify({ currency: 'BTC', source, rates }) })
}

async function main() {
  const args = process.argv.slice(2)
  const fromIdx = args.indexOf('--from')
  if (fromIdx !== -1) {
    const from = args[fromIdx + 1]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '')) throw new Error('Usage: btc-rate.mjs [--from YYYY-MM-DD]')
    const closes = await dailyCloses(from)
    for (let i = 0; i < closes.length; i += 1000) await save('coinbase:daily-close', closes.slice(i, i + 1000))
    log(`backfilled ${closes.length} daily closes${closes.length ? ` (${closes[0].date} to ${closes.at(-1).date})` : ''}`)
  }
  const date = parisToday()
  const rate = await spotRate()
  await save('coinbase:spot', [{ date, rate }])
  log(`BTC-EUR ${date}: ${rate}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    log(`FAILED: ${e.message}`)
    process.exitCode = 1
  })
}
