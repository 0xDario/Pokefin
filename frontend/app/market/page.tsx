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
      <div className="mb-4 flex flex-col gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">
            Market View
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Compare sealed products by price, returns, and short-term trend.
          </p>
        </div>
      </div>
      <MarketView
        initialProducts={products}
        initialExchangeRate={exchangeRate.rate}
      />
      <CardRinkPromo variant="footer" />
    </main>
  );
}
