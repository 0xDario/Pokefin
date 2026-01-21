# Pokefin Copilot Instructions

## Project Overview
Pokefin is a Pokémon TCG sealed product price tracking platform with two main components:
- **Frontend**: Next.js 16 + React 19 + TypeScript dashboard (Supabase backend)
- **Python Scraper**: Selenium-based hourly price scraper from TCGPlayer

## Architecture & Data Flow
```
TCGPlayer → Python Scraper → Supabase (PostgreSQL) → Next.js Frontend
                              ↓
                     Bank of Canada API → exchange_rates table → USD/CAD conversion
```

Key database tables: `products`, `product_price_history`, `sets`, `generations`, `product_types`, `exchange_rates`, `portfolios`, `portfolio_holdings`. See [schema.sql](../schema.sql) for full schema.

## Frontend Component Patterns

### Modular Feature Structure
Components use a consistent folder pattern with collocated hooks, types, and tests:
```
components/ProductPrices/
├── index.tsx          # Main entry point
├── hooks/             # Data fetching (useProductData, useCurrencyConversion)
├── controls/          # UI controls (ControlBar, SortControls)
├── cards/             # Display components (ProductCard, ProductGrid)
├── shared/            # Reusable components (ScrollToTop, ProductImage)
├── types/             # TypeScript types (index.ts exports all types)
└── utils/             # Pure functions (filtering.ts, sorting.ts)
```

Follow this pattern for `Portfolio/` and new feature components. Export all public APIs from `index.ts`.

### Data Fetching
- Use custom hooks in `hooks/` folder (e.g., `useProductData`, `usePortfolioData`)
- All Supabase clients instantiated from `@/app/lib/supabase.ts`
- Price history queries filter by timeframe (`7D`, `1M`, `3M`, `6M`, `1Y`)

### Styling
- Tailwind CSS 4 with mobile-first responsive design
- Use `md:` breakpoint for desktop variants (e.g., `p-3 md:p-6`)
- Color tokens: `slate-*` for backgrounds, `emerald-*` positive, `rose-*` negative

## Testing

### Frontend (Jest + React Testing Library)
```bash
cd frontend && pnpm test           # Run tests
pnpm test:watch                    # Watch mode
pnpm test:coverage                 # Coverage report
```
Tests live in `__tests__/` folders alongside components. Mock `@/app/lib/portfolio` and Supabase calls with `jest.mock()`.

### Python (pytest)
```bash
python -m pytest tests/ -v         # Run all tests
python -m pytest tests/test_main.py -v  # Single file
```
Mock `secretsFile` module and Supabase client in test fixtures.

## Development Commands

### Frontend
```bash
cd frontend
pnpm dev              # Start dev server (port 3000)
pnpm build            # Production build (MUST pass before deploy)
pnpm lint             # ESLint check
```

### Python Scraper
```bash
pip install -r requirements.txt   # Install dependencies
cp secretsFileTemplate.py secretsFile.py  # Configure credentials
python main.py                    # Run scraper manually
```

## Key Conventions

1. **TypeScript Types**: Define in `types/index.ts` and re-export. Use `ChartTimeframe`, `Currency`, `ViewMode` enums from ProductPrices types.

2. **Supabase Queries**: Transform array results to single objects when joining (see `useProductData.ts` lines 40-60 for pattern).

3. **Currency Handling**: Always store prices in USD. Use `useCurrencyConversion` hook for CAD display. Exchange rate from `exchange_rates` table with fallback (1.36).

4. **Auth Context**: Wrap authenticated pages with `AuthProvider`. Access user via `useAuth()` hook from `context/AuthContext.tsx`.

5. **Python Logging**: Use module-level logger: `logger = logging.getLogger(__name__)`. Format: `'%(asctime)s - %(levelname)s - %(message)s'`.

6. **Pre-Deploy Check**: Always run `pnpm build` in `frontend/` before deploying. Build must pass with no errors.

## Environment Variables
```
# Frontend (.env.local)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_KEY=

# Python (secretsFile.py)
SUPABASE_URL=
SUPABASE_KEY=
```
