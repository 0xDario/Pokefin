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
  carry no such guard — they render the most recent snapshot whatever its age,
  so if listings collection stalls they will show stale depth as current

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
- Not every file is re-runnable. Most of the numbered series is idempotent, but
  `0003_integrity_constraints.sql` uses bare `ALTER TABLE ... ADD CONSTRAINT`
  and `create_box_recipes.sql` uses bare `CREATE TABLE` / `CREATE INDEX` /
  `CREATE POLICY`, so both error on a second run.

The ordering constraints that matter when applying a *new* migration, or
replaying a subset:

- `create_box_recipes.sql` must precede `0002`, which does
  `ALTER TABLE public.box_recipes`.
- `20260506_market_performance_functions.sql` must precede `0007`, which pins
  `search_path` on the three functions it creates (`0009` also consumes them).
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
