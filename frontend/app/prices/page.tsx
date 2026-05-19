import { Suspense } from "react";
import ProductPrices from "../components/ProductPrices/index";
import CardRinkPromo from "../components/CardRinkPromo";
import {
  getCachedExchangeRate,
  getCachedMarketProductSummaries,
} from "../lib/serverMarketData";

export default async function PricesPage() {
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
          Sealed Product Price Catalog
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {products.length} products tracked · prices refreshed hourly from TCGPlayer.
        </p>
      </div>
      {/* Suspense required because ProductPrices uses useSearchParams */}
      <Suspense fallback={<div className="text-slate-500">Loading…</div>}>
        <ProductPrices
          initialProducts={products}
          initialExchangeRate={exchangeRate.rate}
        />
      </Suspense>

      <CardRinkPromo variant="footer" />
    </main>
  );
}
