// Deterministic demo data. Run explicitly with `pnpm db:seed`; never runs automatically.
// Idempotent: fixed IDs (ULIDs for assets) + ON CONFLICT DO NOTHING, so reruns add nothing and never overwrite
// existing or user-edited rows.

import type { DB } from './client'
import { assets, valuations, type NewAsset, type NewValuation } from './schema'
import { addMonths, endOfMonth, minDate, parisDate } from '../../shared/utils/dates'

export const SEED_MONTHS = 61 // the past five years, both endpoints included

/** Fixed ULIDs for the demo assets, keyed by the slug IDs they had before assets switched to ULIDs. */
export const DEMO_ASSET_IDS = {
  'demo-checking': '01fk9tan00q4q9spd2afb1xnvk',
  'demo-livret-a': '01fk9tan002crz9s0mxx182fc0',
  'demo-pea': '01fk9tan00kbvyegptn3yvfeyt',
  'demo-bitcoin': '01fk9tan00tp8rm0xbt4zkb402',
  'demo-apartment': '01fk9tan00jp53qj7x2sxa4hh1',
  'demo-cash': '01fk9tan003attm731f5w42fyk',
} as const satisfies Record<string, string>

interface DemoAsset {
  id: string
  /** Former asset ID; still used as the prefix of the fixed demo valuation IDs. */
  slug: string
  name: string
  category: NewAsset['category']
  description: string
  color: string
  /** Returns the balance in integer cents for month index i (0 = oldest). */
  value: (i: number, rand: () => number) => number
}

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cents = (euros: number) => Math.round(euros * 100)

function demoAssets(): DemoAsset[] {
  let livret = 8_000
  let pea = 15_000
  let btcPrice = 52_000
  let apartment = 265_000
  return [
    {
      id: DEMO_ASSET_IDS['demo-checking'],
      slug: 'demo-checking',
      name: '[Demo] Checking account',
      category: 'bank',
      description: 'Demo data: everyday current account.',
      color: '#3b82f6',
      value: (i, r) => cents(2_400 + 900 * Math.sin(i / 2.3) + (r() - 0.5) * 1_400),
    },
    {
      id: DEMO_ASSET_IDS['demo-livret-a'],
      slug: 'demo-livret-a',
      name: '[Demo] Livret A savings',
      category: 'bank',
      description: 'Demo data: regulated savings account (ceiling 22 950 €).',
      color: '#10b981',
      value: (i, r) => {
        if (i > 0) livret = Math.min(22_950, livret * (1 + 0.025 / 12) + 150 + Math.round(r() * 4) * 50)
        return cents(livret)
      },
    },
    {
      id: DEMO_ASSET_IDS['demo-pea'],
      slug: 'demo-pea',
      name: '[Demo] PEA investments',
      category: 'investment',
      description: 'Demo data: equity savings plan with monthly contributions.',
      color: '#8b5cf6',
      value: (i, r) => {
        if (i > 0) pea = pea * (1 + 0.006 + (r() - 0.5) * 0.07) + 400
        return cents(pea)
      },
    },
    {
      id: DEMO_ASSET_IDS['demo-bitcoin'],
      slug: 'demo-bitcoin',
      name: '[Demo] Bitcoin',
      category: 'crypto',
      description: 'Demo data: 0.12 BTC held on an exchange.',
      color: '#f59e0b',
      value: (i, r) => {
        if (i > 0) btcPrice = Math.max(12_000, btcPrice * (1 + 0.012 + (r() - 0.5) * 0.3))
        return cents(0.12 * btcPrice)
      },
    },
    {
      id: DEMO_ASSET_IDS['demo-apartment'],
      slug: 'demo-apartment',
      name: '[Demo] Apartment',
      category: 'real_estate',
      description: 'Demo data: estimated market value of a flat.',
      color: '#ef4444',
      value: (i, r) => {
        if (i > 0 && i % 3 === 0) apartment = Math.round((apartment * (1 + 0.004 + (r() - 0.5) * 0.012)) / 1_000) * 1_000
        return cents(apartment)
      },
    },
    {
      id: DEMO_ASSET_IDS['demo-cash'],
      slug: 'demo-cash',
      name: '[Demo] Cash reserve',
      category: 'cash',
      description: 'Demo data: physical cash at home.',
      color: '#64748b',
      value: (i, r) => cents(600 + Math.round(r() * 18) * 50),
    },
  ]
}

/** Month-end dates covering the past five years: 61 dates, the last one capped at today. */
export function seedDates(today: string): string[] {
  const dates: string[] = []
  for (let k = SEED_MONTHS - 1; k >= 0; k--) {
    const month = addMonths(`${today.slice(0, 7)}-01`, -k)
    dates.push(minDate(endOfMonth(month), today))
  }
  return dates
}

export function buildSeed(today: string, now: Date) {
  const dates = seedDates(today)
  const assetRows: NewAsset[] = []
  const valuationRows: NewValuation[] = []
  demoAssets().forEach((a, n) => {
    const rand = mulberry32(20241031 + n * 7919)
    assetRows.push({
      id: a.id, name: a.name, category: a.category, currency: 'EUR',
      description: a.description, color: a.color, createdAt: now, updatedAt: now,
    })
    dates.forEach((date, i) => {
      const value = a.value(i, rand)
      if (!Number.isSafeInteger(value)) throw new Error(`Seed produced a non-integer amount for ${a.id}`)
      valuationRows.push({
        id: `${a.slug}-${date}`, assetId: a.id, date, value, source: 'import', createdAt: now, updatedAt: now,
      })
    })
  })
  return { assetRows, valuationRows }
}

export function seedDemo(db: DB, today = parisDate(), now = new Date()) {
  const { assetRows, valuationRows } = buildSeed(today, now)
  return db.transaction((tx) => {
    let insertedAssets = 0
    let insertedValuations = 0
    for (const row of assetRows) {
      insertedAssets += tx.insert(assets).values(row).onConflictDoNothing().run().changes
    }
    for (const row of valuationRows) {
      insertedValuations += tx.insert(valuations).values(row).onConflictDoNothing().run().changes
    }
    return { insertedAssets, insertedValuations, totalAssets: assetRows.length, totalValuations: valuationRows.length }
  })
}
