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
- **Currencies:** EUR, USD, GBP, CHF, CAD, AUD. Only **EUR** assets are added to totals and charts. Other currencies
  are listed as excluded, and there is no FX conversion. An asset's currency is locked once it has a valuation.
- Assets can't be deleted or archived. Valuations can be created, corrected and deleted.

## API

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/api/assets` | |
| GET / PATCH | `/api/assets/:id` | PATCH returns 409 when changing the currency of an asset that has valuations |
| GET / POST | `/api/assets/:id/valuations` | GET accepts `?from=&to=` (inclusive) |
| PATCH / DELETE | `/api/valuations/:id` | |
| GET | `/api/dashboard` | `?range=1M\|3M\|6M\|1Y\|ALL` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` |

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
# DNS DNS: finance.example.com  A  <private-ip>  (DNS-only, grey cloud)
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

The whole state is one SQLite file. Use SQLite's online backup, which is safe while the app is running, rather
than copying the file, because the `-wal` file may hold recent writes:

```sh
mkdir -p ~/backups/finance
sqlite3 data/finance.sqlite ".backup '$HOME/backups/finance/finance-$(date +%F).sqlite'"
# without the sqlite3 CLI:
node -e "require('better-sqlite3')('data/finance.sqlite').backup(process.argv[1]).then(()=>console.log('ok'))" ~/backups/finance/finance-$(date +%F).sqlite
```

Daily cron example (`crontab -e`), keeping 30 days:
```
15 3 * * * cd ~/projects/finance && node -e "require('better-sqlite3')('data/finance.sqlite').backup(process.argv[1])" ~/backups/finance/finance-$(date +\%F).sqlite && find ~/backups/finance -name '*.sqlite' -mtime +30 -delete
```
Also copy backups off the VPS.

To restore:
```sh
sudo systemctl stop finance
rm -f data/finance.sqlite-wal data/finance.sqlite-shm
cp ~/backups/finance/finance-YYYY-MM-DD.sqlite data/finance.sqlite
pnpm db:migrate                      # brings an older backup up to the current schema
sudo systemctl start finance
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
