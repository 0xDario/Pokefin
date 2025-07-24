# 🧾 Pokémon TCG Product Price Tracker

A live price dashboard for sealed Pokémon TCG products (Booster Boxes, ETBs, Bundles, etc). Built with React + Supabase, this app shows current USD and CAD prices pulled from TCGPlayer, along with interactive charts for tracking price changes over time.

## 🔧 Features

- 💹 **Daily & 30-day return** (% gain/loss)
- 📈 Price chart with **7D / 30D / 90D** toggle
- 🇺🇸→🇨🇦 **USD to CAD conversion** (Bank of Canada)
- 🔎 Filter by **generation, set code, or product type**
- 🧬 **Variant-aware** (e.g. Koraidon vs Miraidon ETBs)
- 🖼️ Product images with fallback and lazy-loading
- 🔗 TCGPlayer links for each item
- 👀 Toggle view: Grouped by set or flat product list

## 🛠 Tech Stack

- **Frontend**: React + Tailwind CSS + Recharts
- **Backend**: Supabase (Postgres, Storage, Auth)
- **Data Fetcher**: Python + Selenium scraper (hourly cron)
- **Exchange Rate**: Bank of Canada via custom fetcher

## 📦 Product Types Supported

- Booster Boxes
- Elite Trainer Boxes (ETBs)
- Pokémon Center Exclusive ETBs
- Booster Bundles
- Booster Packs
- Sleeved Booster Packs

## 🧪 Local Development

```bash
# Clone repo
git clone https://github.com/your-username/tcg-price-tracker.git
cd tcg-price-tracker

# Install dependencies
npm install

# Create `.env.local`
NEXT_PUBLIC_SUPABASE_URL=your-url
NEXT_PUBLIC_SUPABASE_KEY=your-key

# Run app
npm run dev
