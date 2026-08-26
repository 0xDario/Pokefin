# 🧾 Pokémon TCG Product Price Tracker

A live price and market-activity dashboard for sealed Pokémon TCG products (Booster Boxes, ETBs, Bundles, and more). Built with Next.js + Supabase, it shows current USD and CAD prices pulled from TCGPlayer, interactive charts for price history, and sales-volume analytics for reading demand and supply.

## 🔧 Features

### Prices
- 💹 **Returns across windows** (7D / 1M / 3M / 6M / 1Y) with color-coded gain/loss
- 📈 **Interactive price charts** (Recharts) with 7D / 1M / 3M / 6M / 1Y toggles
- 📉 **Risk metrics**: CAGR, max drawdown, 30-day volatility
- 🇺🇸→🇨🇦 **Live USD to CAD conversion** (Bank of Canada API)

### Market Pulse
- 📦 **Sales volume history** — units sold, charted as bars under the price
  line. Bars are **per day** on the 7D and 1M ranges and **per week**
  (Monday-start) on 3M / 6M / 1Y, where daily rows are aggregated and the
  backfilled weekly rows fill in earlier history. Transaction counts are
  collected and stored but not currently surfaced in the UI
- 📊 **Volume trend** — trailing 30 days vs the prior 30
- 🏬 **Supply depth** — active listings, total units on market, and days of supply
- 🚦 **Price/volume divergence signals** — *Demand surge*, *Thin supply*, *Distribution*, *Cooling off*
- ➖ **Sales-window metrics** (units sold 7d/30d, volume trend) report `--`
  rather than a number when collection has gone stale, has a hole in it, or
  never happened — so a scraper gap never reads as "zero sold". One deliberate
  exception: a window that simply *starts* before collection began reports the
  partial total, so a newly tracked product shows its lifetime figure instead
  of nothing.
  The **supply metrics** (active listings, units on market, days of supply)
  are guarded the same way: a listings snapshot more than three days old is
  treated as no data rather than presented as current depth

### Browsing
- 🔎 **Advanced filtering**: generation, set code, product type, search
- 🧬 **Variant-aware** (e.g. Koraidon vs Miraidon ETBs)
- 🏪 **Pokémon Center exclusive badges** with special highlighting
- 🖼️ **Product images** with thumbnail derivatives, lazy-loading, and CDN storage
- 👀 **Dual view modes**: grouped by set or flat product listing
- 🔗 **Direct TCGPlayer links** for each item

## 🛠 Tech Stack

- **Frontend**: Next.js (React, TypeScript) + Tailwind CSS + Recharts
- **Backend**: Supabase (PostgreSQL + Storage). Market and catalog data is read straight from PostgREST — there is no custom API layer for it. Auth and account actions do have Next.js route handlers under `frontend/app/api/` (`/api/auth/*`, `/api/account/export`, `/api/account/delete`)
- **Data Scraper**: Python. Prices and sales volume come from TCGPlayer's `infinite-api`; Selenium is used only to extract product images
- **Exchange Rate**: Bank of Canada API integration
- **Deployment**: Vercel
- **Image Storage**: Supabase Storage with CDN

## 📦 Product Types Supported

19 product types across ~300 tracked products, including:

- **Booster Boxes**, **Booster Bundles**, and **Booster Packs**
- **Elite Trainer Boxes (ETBs)** — standard retail versions
- **Pokémon Center Exclusive ETBs** — with unique badges
- **Premium / Ultra-Premium / Super-Premium Collections**
- **ex Boxes**, **Special Collections**, **Build & Battle Boxes**, and other sealed products

## 🧪 Local Development

### Prerequisites
- Node.js 22+
- Python 3.10+ (the scraper uses PEP 604 `X | None` annotations)
- pnpm (see `packageManager` in `frontend/package.json`)
- Supabase account

### Setup
```bash
# Clone repo
git clone https://github.com/0xDario/Pokefin.git
cd Pokefin

# Frontend
cd frontend
pnpm install

# Create environment file
cp .env.example .env.local
# Then fill in .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
#   NEXT_PUBLIC_SUPABASE_KEY=your-supabase-publishable-key
#   NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-turnstile-site-key

pnpm dev
```

Browsing prices and charts only needs the two Supabase values. **Login and
signup additionally need Turnstile configured on both sides** — both pages
mount the widget and keep the submit button disabled until it returns a token,
so leaving the placeholder in place makes auth untestable locally.

The site key alone is not sufficient: whichever Supabase project you point at
validates the token server-side, so its CAPTCHA setting must match. Either
disable CAPTCHA protection on your own dev project, or set Cloudflare's
matching always-passing **test secret** under Supabase → Authentication →
Attack Protection and use the paired test site key
(`1x00000000000000000000AA`) here. Pointing a local build at a project
configured with a production secret will reject the test token.

```bash
# Scraper (separate terminal, from the repo root)
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

The scraper writes to Supabase and therefore needs the **secret** key — the
publishable key the frontend uses is blocked by RLS on writes. Credentials are
read from the environment first, falling back to a gitignored `secretsFile.py`:

```bash
# Preferred: an env file (this is what run_scraper.sh sources)
mkdir -p ~/.config/pokefin && chmod 700 ~/.config/pokefin
cat > ~/.config/pokefin/env <<'EOF'
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-secret-key
EOF
chmod 600 ~/.config/pokefin/env

# Alternative for local dev only:
cp secretsFileTemplate.py secretsFile.py   # then edit it
```

`secrets_loader` reads `os.environ` and falls back to `secretsFile.py`. It does
**not** read the env file itself — `run_scraper.sh` is what sources it. So if
you went the env-file route, export it yourself before invoking the scraper or
a backfill directly (with `secretsFile.py` this is unnecessary):

```bash
set -a && source ~/.config/pokefin/env && set +a

# One pass and exit
python main.py --run-now

# Or the self-scheduling loop. NOTE: it sleeps to the next 4-hour UTC
# boundary FIRST and only then scrapes, so starting it at 00:05 means
# nothing happens until 04:00. Run --run-now first if you want data now.
python main.py

# In production, cron invokes the wrapper, which sources the env file first
./run_scraper.sh
```

### One-time backfills

Same environment requirement as above — `set -a && source ~/.config/pokefin/env && set +a` first.

```bash
python backfill_historical_prices.py --gaps-only   # fill holes in price history
python backfill_sales_volume.py                    # seed a year of volume history
python backfill_thumbnails.py                      # generate image thumbnails
```

### 📰 The Pokéfin Weekly

`generate_weekly_report.py` renders a newspaper-style PDF of the week's market
action — returns by product category across 7D/1M/6M/1Y, best and worst movers,
and a derived narrative headline. It reads Supabase and writes to `reports/`;
it never writes to the database.

```bash
python generate_weekly_report.py   # writes reports/pokefin_weekly_<date>.{html,pdf}
```

The full-table fetch is retried: `product_price_history` is ~141k rows at 1000
a request, so a run is ~142 sequential calls and a single reset used to cost
the whole edition — the 2026-08-14 report was lost exactly that way. Transient
transport faults, 429, 5xx and PostgREST's own connection-group errors are
retried with exponential backoff; a 4xx is not, since a bad request fails
identically five times. If every attempt is exhausted the exception
propagates rather than returning a partial history,
because half a history makes a wrong newspaper rather than an obviously
missing one.

Deciding *which* failures those are takes more care than it looks like it
should. `postgrest-py` raises `APIError` for every non-2xx and discards the
HTTP status, so its `code` is one of two unrelated things depending on the
response body: the HTTP status as an int when the body is not JSON, or a
PostgreSQL `SQLSTATE` / PostgREST identifier when it is — and PostgREST
*does* return JSON for a 500. Reading one as the other silently classifies
every server-side failure as permanent.

A PostgREST identifier carries no status at all once `APIError` has dropped
it, so the transient ones are named explicitly: group 0 is connectivity
(`PGRST000`–`PGRST003`) and `PGRSTX00` is a fault in its database driver;
every other group is a request, schema-cache or JWT problem that will fail the
same way five times. `PGRST003` matters most in practice — a pool-acquisition
timeout, returned as **504**, which the client library's own retry does not
cover because it only retries 503 and 520 on GET. 500, 502 and 504 all arrive
here unretried.

Two things it needs:

- **Chrome or Chromium on PATH.** The PDF is produced by `--headless
  --print-to-pdf`; without a browser the generator exits non-zero rather than
  leaving last week's file in place.
- **Enough price history to be meaningful.** Products with fewer than 3
  distinct prices in the trailing year are treated as illiquid and excluded
  from every ranking, so a product whose price never moved cannot manufacture
  a headline. The run prints how many it dropped.

`run_weekly_report.sh` is the scheduler wrapper: it sources the credentials
file, runs the generator, verifies *this* run produced a PDF, emails it if
email is configured, and posts a desktop notification. It derives the repo
location from its own path, so the same script works from a macOS checkout and
from the Linux scraper host. On macOS it is scheduled by
`~/Library/LaunchAgents/com.pokefin.weekly.plist` (Fridays 17:00); on Linux,
add it to cron.

#### Emailing the edition

`send_weekly_email.py` attaches the PDF and puts the front page's marquee
figures in the body. Those figures come from `pokefin_weekly_<date>.summary.json`,
which the generator writes alongside the PDF — the email cannot drift away from
the edition it is attached to, and no HTML is scraped to build it.

It is **opt-in and non-fatal**. With nothing configured it prints a line and
exits 2; the wrapper treats that as normal, because the PDF on disk is the
deliverable and email is only delivery. A genuine send failure (exit 1) is
logged and flips the notification, but the run still counts as a success.

Configuration is plain SMTP, so the provider is config rather than code. Add to
`~/.config/pokefin/env` (the same file the scraper's credentials live in — it is
gitignored, and nothing is ever read from the repo):

```sh
REPORT_EMAIL_TO=you@example.com          # comma-separated for several
REPORT_EMAIL_FROM=weekly@yourdomain.com  # must be verified with the provider
SMTP_HOST=smtp-relay.brevo.com           # Brevo
SMTP_PORT=587                            # 465 switches to implicit TLS
SMTP_USER=...                            # Brevo: the SMTP login, not your email
SMTP_PASS=...                            # the SMTP key
```

For Amazon SES instead, only the first three change:

```sh
SMTP_HOST=email-smtp.us-east-1.amazonaws.com   # your region
SMTP_USER=...                                  # SMTP username from IAM
SMTP_PASS=...                                  # SMTP password from IAM
```

Two provider gotchas worth knowing before the first Friday: the **From address
must be verified** with whichever provider you use, and a **new SES account is
sandboxed** — it can only send to verified recipients until you request
production access. Both failures surface in `reports/weekly_report.log` with
the provider's own rejection text.

To test without waiting for Friday:

```sh
./venv/bin/python send_weekly_email.py reports/pokefin_weekly_latest.pdf \
  reports/pokefin_weekly_<date>.summary.json
```

## 📊 How It Works

1. **Cron runs the Python scraper** on the host (via `run_scraper.sh`). Each
   product is refreshed roughly once per day — the staleness gate is 23h,
   deliberately just under 24h so a product locks to a stable daily slot
   instead of drifting later each run and skipping calendar days.
2. **Prices and sales volume** come from TCGPlayer's `infinite-api`. In the
   normal case that is one request per product — `range=month` returns the
   latest market price *and* 30 days of daily buckets together. If that
   response is unusable the scraper falls through `quarter`, `semi-annual`
   and `annual` (up to four requests), and those coarser ranges yield a price
   but **no** daily volume buckets, since only `month` is daily.
3. **Listing depth** is snapshotted per product per day from TCGPlayer's
   marketplace search API (active listings, units available, lowest ask).
4. **Selenium** extracts product images, which are uploaded to Supabase Storage
   alongside a small WebP thumbnail used by list views.
5. **History tables** (`product_price_history`, `product_sales_history`,
   `product_listings_history`) feed trend analysis, charts, and the
   `get_market_product_volume_metrics()` RPC behind Market Pulse.
6. **Bank of Canada API** provides daily USD→CAD exchange rates.
7. **Next.js frontend** renders it, with server-side caching on the list pages
   and per-product data fetched from PostgREST.

## 🗄 Database

Schema reference lives in `schema.sql` (context only — not meant to be run).

Migrations are hand-written SQL in `migrations/`, applied via the Supabase SQL
editor or MCP, and tracked in `audits/HARDENING_FOLLOWUPS.md`.

They are applied **incrementally to the live project**. This directory is not a
from-scratch bootstrap and cannot rebuild the database on its own:

- Nothing here creates the core tables (`products`, `sets`, `product_types`,
  `generations`, `product_price_history`) — they predate the directory and are
  described in `schema.sql`.
- Two functions the migrations operate on are not defined anywhere in the repo:
  `0006` revokes privileges on `handle_new_profile_portfolio()` and `0007`
  alters `get_price_history_deduplicated(bigint[], text)`. Both exist only in
  the live database.
- Not every file is re-runnable: `0003_integrity_constraints.sql` uses bare
  `ALTER TABLE ... ADD CONSTRAINT` and errors on a second run. The rest,
  including `create_box_recipes.sql`, is idempotent.

#### Verify that a migration actually applied

**Do this after every apply.** On 2026-08-13 a migration was applied twice
through the Supabase SQL editor and reported success both times while the
database kept running an earlier revision of the same file — the editor said
OK, the ledger gained rows, and the functions were present and working, just
not the versions in the repo. It was caught only by reading
`pg_get_functiondef` by hand.

```bash
python verify_migration.py migrations/0023_price_freshness_guard.sql
```

That prints one SQL statement. Run it (SQL editor, psql, or an agent's
`execute_sql`) and every row must say `OK`; `MISMATCH` means the deployed
object differs from the file and names the facet, `MISSING` means it is not
there at all. Pass several files — `migrations/*.sql` works — and each row is
labelled with the file it came from. Needs no database credentials of its own.

What it checks, and why each is there rather than just the body:

| | |
|---|---|
| **functions** | Body, `SECURITY DEFINER`, the `SET search_path` pin, volatility, argument count. A `DROP`+`CREATE` discards the first two, and a trigger that became `SECURITY INVOKER` has an identical body and no privileges. |
| **indexes** | Definition, not name. `CREATE INDEX IF NOT EXISTS` is a *no-op* against an index already holding the name with different columns, so a name-only check certifies exactly the drift worth catching. Columns, ordering, method, uniqueness, partial predicate, and validity — an index left `INVALID` by an interrupted `CONCURRENTLY` build exists, is named correctly, and is ignored by the planner. |
| **privileges** | `GRANT`/`REVOKE` on functions and tables, as *effective* access. Revoking from `anon` while `PUBLIC` still holds the privilege changes nothing, and that reads as `MISMATCH` here. |
| **config** | Standalone `ALTER FUNCTION ... SET`, so a `search_path` hardening migration that touches no function body is still verifiable. |
| **RLS** | `ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY`. |

Bodies are compared by hashing the file's text and having Postgres hash its own
`pg_proc.prosrc` the same way — both stripped of `--` comments, whitespace
collapsed, spaces beside parens and commas removed, lowercased. The comment
stripping respects single-quoted literals, so a body containing `'prefix--one'`
is not truncated at the marker and cannot hash the same as one containing
`'prefix--two'`.

**It does not cover** `CREATE POLICY`, constraints, triggers, column
definitions or data migrations. A migration made only of those — `0008` is the
one in this repo — prints no query and exits 2, rather than printing something
that would look reassuring. Return types and argument names are not compared
either, only the count. Being blind to formatting costs a little precision
inside string literals: the comparison lowercases and removes whitespace next
to punctuation, so a change confined to a literal's case or internal spacing
is invisible.

Two constructs are **refused by name** rather than guessed at, because the
Python and Postgres normalisations could not be guaranteed to agree on them: a
nested dollar-quoted literal inside a body, and a block comment. So is a
`GRANT`/`REVOKE` the parser could not read — `ON ALL TABLES IN SCHEMA`, for
instance. Anything refused is printed and the exit code is non-zero; nothing
is silently skipped.

Expectations come from the file you pass, so when a *later* migration
redefines an object, verify against that later file. `0002` reports a body
`MISMATCH` for `delete_my_account` because `0010` redefines it, and
`20260506`'s two dropped indexes report `MISSING` because `0014` drops them —
both correct.

The editor's own trap is worth knowing: it runs **the selected text** when
there is a selection, so a stray click before Run silently applies a fragment.
Select all first, or prefer MCP `apply_migration`.

The ordering constraints that matter when applying a *new* migration, or
replaying a subset:

- `create_box_recipes.sql` must precede `0002`, which does
  `ALTER TABLE public.box_recipes`.
- `20260506_market_performance_functions.sql` must precede `0007`, which pins
  `search_path` on the three functions it creates (`0009` also consumes them).
- `20260506_market_performance_functions.sql` must also precede `0022` and
  `0023`, which re-define two of those same three functions to add their
  freshness guards. **It sorts last by filename**, so "apply everything in
  filename order" is wrong and actively harmful: replaying it after `0023`
  restores the unguarded `get_set_analytics` silently (same signature, so
  `CREATE OR REPLACE` succeeds) and hard-errors on `get_market_product_summaries`
  (`0023` widens its return type, which `CREATE OR REPLACE` cannot do). Treat
  it as the earliest file, not the latest.
- Otherwise apply numbered files in numeric order.

All history tables are readable by `anon`/`authenticated` under RLS and written
only by the scraper's secret key.

## 🤝 Contributing

Contributions welcome! Areas for improvement:
- Additional retailers (CardMarket, eBay, etc.)
- Mobile app development
- New product types or filtering options
- Performance optimizations
- API endpoint creation

## ⚠️ Disclaimer

This tool is for informational purposes only. Prices are sourced from TCGPlayer.com and may not reflect real-time market conditions. Always verify prices on official retailer websites before making purchases.

---

**Built for the Pokemon TCG community** 🃏
