import ProductPrices from "./components/ProductPrices/index";
import CardRinkPromo from "./components/CardRinkPromo";


export default function Home() {
  return (
    <main className="p-3 md:p-6">
      <h1 className="text-xl md:text-2xl font-bold mb-4">Pokémon Sealed Product Price Dashboard</h1>
      <ProductPrices />

      {/* CardRinkTCG Promotional Footer */}
      <CardRinkPromo variant="footer" />
    </main>
  );
}
