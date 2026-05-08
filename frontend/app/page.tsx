import ProductPrices from "./components/ProductPrices/index";
import CardRinkPromo from "./components/CardRinkPromo";
import {
  getCachedExchangeRate,
  getCachedMarketProductSummaries,
} from "./lib/serverMarketData";


export default async function Home() {
  const [products, exchangeRate] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedExchangeRate(),
  ]);

  return (
    <main className="p-3 md:p-6">
      <h1 className="text-xl md:text-2xl font-bold mb-4">Pokémon Sealed Product Price Dashboard</h1>
      <ProductPrices
        initialProducts={products}
        initialExchangeRate={exchangeRate.rate}
      />

      {/* CardRinkTCG Promotional Footer */}
      <CardRinkPromo variant="footer" />
    </main>
  );
}
