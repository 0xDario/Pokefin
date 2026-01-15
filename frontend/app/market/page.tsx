import MarketView from "../components/MarketView/MarketView";
import CardRinkPromo from "../components/CardRinkPromo";

export default function MarketPage() {
  return (
    <main className="p-3 md:p-6">
      <div className="mb-4 flex flex-col gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">
            Sealed Product Market
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Compare products by price, returns, and short-term trend.
          </p>
        </div>
      </div>
      <MarketView />
      <CardRinkPromo variant="footer" />
    </main>
  );
}
