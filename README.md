# Finance

Single-user personal finance tracker: assets, dated balance valuations, and a EUR net-worth history.
Nuxt 4 · Nuxt UI (UChart) · Drizzle ORM · SQLite (better-sqlite3) · Zod · pnpm.

Served at **https://finance.example.com**. That address only works over the VPN, which is the access control.

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

> On this 1 GB VPS, `pnpm typecheck` and `pnpm build` need swap; `deploy/install-root.sh` adds 2 GB.

## Financial rules

- **Money** is stored as integer minor units (cents). The API accepts and returns decimal **strings** with at most
  two decimals (`"1234.56"`). Each amount must be within ±9 999 999 999 999.99. Totals are summed with BigInt, so
  there are no float rounding errors.
- **Valuations are total balances** observed on a calendar date. They are not cash flows, and the app does not
  compute investment returns. Each asset can have at most one valuation per date.
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

## API

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/api/assets` | |
| GET / PATCH / DELETE | `/api/assets/:id` | PATCH returns 409 when changing the currency of an asset that has valuations. DELETE removes the asset and all its valuations (204) |
| GET / POST | `/api/assets/:id/valuations` | GET accepts `?from=&to=` (inclusive) |
| PATCH / DELETE | `/api/valuations/:id` | |
| GET | `/api/dashboard` | `?range=1M\|3M\|6M\|1Y\|ALL` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| GET / PUT | `/api/rates` | GET `?currency=BTC[&from=&to=]`. PUT `{ currency, source, rates: [{ date, rate }] }` inserts or replaces those days |

Errors are JSON `{ statusCode, statusMessage, message, data? }`:
**400** for validation errors (`data.issues`), **404** for a missing record, **409** for a duplicate date or a
locked currency.

## Production on the VPS

The app listens on `127.0.0.1:8081` only. Nginx terminates HTTPS for `finance.example.com` with the `*.example.com`
wildcard certificate. It listens only on the the VPN IP. **The app has no login of its own**, so access is
limited to devices on the owner's private network. Never expose this site on a public interface without adding authentication. See `~/projects/proxy/SETUP.md` for the shared Nginx/TLS setup.

One-time setup:
```sh
sudo bash deploy/install-root.sh   # swap, systemd unit (started), nginx site
# DNS: covered by the DNS wildcard *.example.com A <private-ip> (DNS-only)
```

Deploy or update:
```sh
cd ~/projects/finance
git pull                                   # if applicable
pnpm install --frozen-lockfile
pnpm build
DATABASE_PATH=$PWD/data/finance.sqlite pnpm db:migrate
sudo systemctl restart finance
systemctl status finance; journalctl -u finance -n 50
curl https://finance.example.com/api/dashboard?range=1M   # from a the VPN device
```

Files: `deploy/finance.service` (systemd, with a 300 MB memory limit and a read-only home except `data/`),
`deploy/nginx-finance.example.com.conf` (also copied to `~/projects/proxy/nginx/sites/`).

## Backup and restore

`pnpm db:backup` (`scripts/backup.mjs`) takes an online snapshot with SQLite's backup API. That's safe while the
app is running and includes recent writes still in the `-wal` file. It runs `integrity_check` on the snapshot,
gzips it to `~/backups/finance/finance-<UTC timestamp>.sqlite.gz` (mode 600), and deletes snapshots older than
30 days (`BACKUP_KEEP_DAYS`). Don't back up by copying `data/finance.sqlite` directly.

Daily at 03:15 UTC from the crontab (`crontab -e`), logging to `~/logs/finance-backup.log`:
```
15 3 * * * cd /home/you/projects/finance && /home/you/.local/bin/node scripts/backup.mjs >> /home/you/logs/finance-backup.log 2>&1
```
Check it with `tail ~/logs/finance-backup.log; ls -lh ~/backups/finance`. Also keep copies off the VPS.

To restore:
```sh
sudo systemctl stop finance
cp data/finance.sqlite data/finance.sqlite.before-restore 2>/dev/null || true
rm -f data/finance.sqlite-wal data/finance.sqlite-shm
gunzip -c ~/backups/finance/finance-YYYY-MM-DD-HH-MM-SS.sqlite.gz > data/finance.sqlite
pnpm db:migrate                      # brings an older backup up to the current schema
sudo systemctl start finance
```

## BTC-EUR rate

`scripts/btc-rate.mjs` stores today's BTC-EUR rate (Europe/Paris date) from the public Coinbase spot price, no key
needed, through `PUT /api/rates`. A day that already has a rate is replaced, so reruns are harmless. On error it saves
nothing and exits 1; the last rate carries forward. `--from YYYY-MM-DD` also backfills daily closes (Coinbase UTC
daily candles) from that date to yesterday, e.g. after recording a past BTC quantity.

Daily at 21:50 UTC (22:50/23:50 Paris) from the crontab, logging to `~/logs/btc-rate.log`:
```
50 21 * * * cd /home/you/projects/finance && /home/you/.local/bin/node scripts/btc-rate.mjs >> /home/you/logs/btc-rate.log 2>&1
```
## Project layout

```
app/                 Nuxt UI pages (dashboard, assets, asset detail), modals, chart
server/api/          REST routes (validated with Zod)
server/database/     Drizzle schema, migrations, client, seeder
server/utils/        repository (domain rules), HTTP error helpers
shared/utils/        money, dates, history computation, validation (shared by server, UI and tests)
tests/               Vitest suites
deploy/              systemd unit, nginx site, root install script
```
