# Finance

Single-user personal finance tracker: assets, dated balance valuations, and a EUR net-worth history.
Nuxt 4 · Nuxt UI (UChart) · Drizzle ORM · SQLite (better-sqlite3) · Zod · pnpm.

## Setup

```sh
pnpm install
cp .env.example .env        # optional; the defaults are fine for development
pnpm db:migrate             # creates ./data/finance.sqlite (WAL, foreign keys on)
pnpm db:seed                # optional demo data: six [Demo] EUR assets, 61 month-ends each
pnpm dev                    # http://127.0.0.1:3000
```

| Script | What it does |
|---|---|
| `pnpm dev` | Dev server on 127.0.0.1:3000 |
| `pnpm build` / `pnpm preview` | Production build into `.output/`, then preview it |
| `pnpm start` | Run the built server (reads `.env` if present) |
| `pnpm typecheck` | `nuxt typecheck` (vue-tsc, strict) |
| `pnpm test` | Vitest: money, dates, history rules, DB integration, seeder |
| `pnpm db:generate` | Generate a Drizzle migration after changing `server/database/schema.ts` |
| `pnpm db:migrate` | Apply committed migrations from `server/database/migrations/` |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:backup` | Verified, gzipped online backup to `~/backups/finance` (keeps 30 days) |
| `pnpm db:seed` | Insert demo data. It is idempotent and never overwrites existing rows. It never runs automatically. |

Environment variables: `DATABASE_PATH` (default `./data/finance.sqlite`), `HOST`, `PORT`.
`data/` is git-ignored.

> On a machine with ~1 GB of RAM, `pnpm typecheck` and `pnpm build` need swap.

## Financial rules

- **Money** is stored as integer minor units (cents). The API accepts and returns decimal **strings** with at most
  two decimals (`"1234.56"`). Each amount must be within ±9 999 999 999 999.99. Totals are summed with BigInt, so
  there are no float rounding errors.
- **Valuations are total balances** observed on a calendar date. They are not cash flows. Each asset can have at
  most one valuation per date.
- **Paid in** (optional, EUR) on a valuation is the total net amount put into the asset so far (deposits minus
  withdrawals). **Gains** = value − paid in. The **return** is money-weighted (IRR) from the first valuation with a
  paid-in figure; a change in paid in is assumed to happen halfway between two valuations. It is shown per year only
  once there is at least a year of data. BTC values are converted at that date's rate; other currencies have none.
- **Dates** are `YYYY-MM-DD` calendar dates. "Today" and timestamps use the **Europe/Paris** calendar.
  Valuations cannot be dated in the future.
- **Current value** is the latest valuation dated on or before today.
- **Daily history** is generated when you query it and is never stored. Each day carries forward the most recent
  observation on or before that day. Future observations are never used.
- An asset **participates** from its creation date or its earliest valuation, whichever is earlier. If a
  participating asset has no observation yet on a day, its value that day is **unknown (null), not zero**. Totals
  then add up the known values, and the day is marked incomplete.
- **Freshness:** an observation more than 30 days older than the day it is used for is flagged **stale**. It still
  counts in totals.
- **Currencies:** EUR, USD, GBP, CHF, CAD, AUD and **BTC**. An asset's currency is locked once it has a valuation.
  EUR assets are added to totals as is. Other fiat currencies are listed as excluded (no FX conversion).
- **BTC assets** hold their balance in BTC, not euros: valuations are quantities with up to 8 decimals (stored as
  satoshis), e.g. `0.1`. Their EUR value on a day is the BTC balance carried forward times the latest BTC-EUR rate on
  or before that day (`rates` table), rounded to the cent. No rate yet means the EUR value is unknown, not zero. A BTC
  quantity is never stale (it changes only when you buy or sell); the rate is flagged stale after 30 days.
- **Asset IDs are lowercase ULIDs** (26 characters, sortable by creation time), e.g. `/assets/01fk9tan00jp53qj7x2sxa4hh1`.
  Any other ID, uppercase included, gets a 404. `pnpm db:migrate` converts older slug, UUID or uppercase-ULID asset IDs,
  keeping their valuations. The demo
  assets have fixed ULIDs, so `pnpm db:seed` still recognises them.
- Valuations can be created, corrected and deleted. An asset can be deleted permanently, together with all of its
  valuations, in one transaction (from the danger zone on its page). There is no archive or undo: restore from a backup.

## Budget rules

- A **budget item** is a recurring monthly **income** or **expense** (salary, rent, a subscription). Amounts are EUR.
- Its amount is **versioned by month** (`YYYY-MM`): each change applies from its month until the next change, like
  valuations carried forward. The amount in a month is the latest change on or before it. Future months are allowed
  (planned changes); "this month" uses the Europe/Paris calendar.
- Items don't end: set the amount to **0** to stop one. It then drops out of the monthly budget but keeps its history.
  An item's first amount must be greater than 0, and an item always keeps at least one amount.
- A month's budget = every item's amount in effect that month. **Left over** = income − expenses.
- Deleting an item removes it and all its amounts, from past months too. To stop an item, set it to 0 instead.

## API

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/api/assets` | |
| GET / PATCH / DELETE | `/api/assets/:id` | PATCH returns 409 when changing the currency of an asset that has valuations. DELETE removes the asset and all its valuations (204) |
| GET / POST | `/api/assets/:id/valuations` | GET accepts `?from=&to=` (inclusive) |
| PATCH / DELETE | `/api/valuations/:id` | |
| GET | `/api/dashboard` | `?range=1M\|3M\|6M\|1Y\|ALL` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| GET / PUT | `/api/rates` | GET `?currency=BTC[&from=&to=]`. PUT `{ currency, source, rates: [{ date, rate }] }` inserts or replaces those days |
| GET | `/api/budget` | `?month=YYYY-MM` (default: this month). Lines in effect, totals, and the previous month's totals |
| GET | `/api/budget/history` | `?range=12M\|24M\|ALL` or `?from=YYYY-MM&to=YYYY-MM`. Monthly totals and the amount changes in the range |
| GET / POST | `/api/budget/items` | POST `{ name, kind: income\|expense, notes?, month, amount }` creates the item with its first amount |
| GET / PATCH / DELETE | `/api/budget/items/:id` | GET includes the amount history (newest first). DELETE removes the item and its amounts (204) |
| PUT / DELETE | `/api/budget/items/:id/amounts/:month` | PUT `{ amount }` sets the amount from that month on (`"0"` = stopped). DELETE undoes that month's change |

Errors are JSON `{ statusCode, statusMessage, message, data? }`:
**400** for validation errors (`data.issues`), **404** for a missing record, **409** for a duplicate date or a
locked currency.

## Production

Build with `pnpm build` and run `.output/server/index.mjs` (or `pnpm start`) with `HOST=127.0.0.1` and a `PORT`,
behind a reverse proxy that terminates HTTPS. **The app has no login of its own**: only serve it on a private network
(e.g. a VPN), never on a public interface without adding authentication.

Deploy or update:
```sh
git pull
pnpm install --frozen-lockfile
pnpm db:backup
pnpm build
pnpm db:migrate
# then restart the service
```

## Backup and restore

`pnpm db:backup` (`scripts/backup.mjs`) takes an online snapshot with SQLite's backup API. That's safe while the
app is running and includes recent writes still in the `-wal` file. It runs `integrity_check` on the snapshot,
gzips it to `~/backups/finance/finance-<UTC timestamp>.sqlite.gz` (mode 600), and deletes snapshots older than
30 days (`BACKUP_KEEP_DAYS`). Don't back up by copying `data/finance.sqlite` directly. Run it daily from cron, and
keep copies off the server.

To restore: stop the app, delete `data/finance.sqlite-wal` and `-shm`, `gunzip -c` a snapshot to
`data/finance.sqlite`, run `pnpm db:migrate` (brings an older backup up to the current schema), and start the app.

## BTC-EUR rate

`scripts/btc-rate.mjs` stores today's BTC-EUR rate (Europe/Paris date) from the public Coinbase spot price, no key
needed, through `PUT /api/rates`. A day that already has a rate is replaced, so reruns are harmless. On error it saves
nothing and exits 1; the last rate carries forward. `--from YYYY-MM-DD` also backfills daily closes (Coinbase UTC
daily candles) from that date to yesterday, e.g. after recording a past BTC quantity. Run it daily from cron.

## Project layout

```
app/                 Nuxt UI pages (dashboard, assets, budget, calculator), modals, charts
server/api/          REST routes (validated with Zod)
server/database/     Drizzle schema, migrations, client, seeder
server/utils/        repository (domain rules), HTTP error helpers
shared/utils/        money, dates, history computation, validation (shared by server, UI and tests)
tests/               Vitest suites
```
