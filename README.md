# 🧾 Pokémon TCG Product Price Tracker

A live price dashboard for sealed Pokémon TCG products (Booster Boxes, ETBs, Bundles, etc). Built with Next.js + Supabase, this app shows current USD and CAD prices pulled from TCGPlayer, along with interactive charts for tracking price changes over time.

## 🔧 Features

- 💹 **Daily & 30-day returns** (% gain/loss) with color-coded indicators
- 📈 **Interactive price charts** with 7D / 30D / 90D toggle (Recharts)
- 🇺🇸→🇨🇦 **Live USD to CAD conversion** (Bank of Canada API)
- 🔎 **Advanced filtering**: generation, set code, product type, search
- 🧬 **Variant-aware** (e.g. Koraidon vs Miraidon ETBs)
- 🏪 **Pokemon Center exclusive badges** with special highlighting
- 🖼️ **Product images** with fallback, lazy-loading, and CDN storage
- 👀 **Dual view modes**: Grouped by set or flat product listing
- 🔗 **Direct TCGPlayer links** for each item
- ⚡ **Hourly price updates** with intelligent caching

## 🛠 Tech Stack

- **Frontend**: Next.js (React, TypeScript) + Tailwind CSS + Recharts
- **Backend**: Supabase (PostgreSQL, Storage, Real-time)
- **Data Scraper**: Python + Selenium (hourly automation)
- **Exchange Rate**: Bank of Canada API integration
- **Deployment**: Vercel
- **Image Storage**: Supabase Storage with CDN

## 📦 Product Types Supported

- **Booster Boxes** - Latest and classic Pokemon sets
- **Elite Trainer Boxes (ETBs)** - Standard retail versions
- **Pokemon Center Exclusive ETBs** - Special exclusives with unique badges  
- **Booster Bundles** - Value pack offerings

## 🧪 Local Development

### Prerequisites
- Node.js 22+
- Python 3.8+
- Supabase account

### Setup
```bash
# Clone repo
git clone https://github.com/0xDario/Pokefin.git
cd Pokefin

# Frontend setup (uses pnpm — see package.json "packageManager")
cd frontend
pnpm install

# Create environment file
cp .env.example .env.local
# Then fill in your Supabase credentials (and any other values) in .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
#   NEXT_PUBLIC_SUPABASE_KEY=your-supabase-anon-key

# Run development server
pnpm dev

# Backend setup (separate terminal)
cd ../
pip install -r requirements.txt
cp secretsFileTemplate.py secretsFile.py
# Add your Supabase credentials to secretsFile.py

# Run scraper
python main.py
```

## 📊 How It Works

1. **Python scraper** runs hourly via cron to fetch prices from TCGPlayer
2. **Selenium automation** extracts market prices and product images  
3. **Supabase Storage** hosts optimized product images via CDN
4. **Price history** logged for trend analysis and chart generation
5. **Bank of Canada API** provides daily USD→CAD exchange rates
6. **Next.js frontend** displays real-time data with interactive charts

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
