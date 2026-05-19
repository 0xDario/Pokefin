import MarketView from "../components/MarketView/MarketView";
import CardRinkPromo from "../components/CardRinkPromo";
import {
  getCachedExchangeRate,
  getCachedMarketProductSummaries,
} from "../lib/serverMarketData";

export default async function MarketPage() {
  const [products, exchangeRate] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedExchangeRate(),
  ]);

  return (
    <main className="p-3 md:p-6">
      <div className="mb-5 md:mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-pokeball)]">
          Pokéfin Market
        </p>
        <h1 className="mt-1 text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
          Market View
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Compare sealed products by price, returns, and short-term trend.
        </p>
      </div>
      <MarketView
        initialProducts={products}
        initialExchangeRate={exchangeRate.rate}
      />
      <CardRinkPromo variant="footer" />
    </main>
  );
}
