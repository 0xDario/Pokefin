import ProductPrices from "./components/ProductPrices";
import CardRinkPromo from "./components/CardRinkPromo";


export default function Home() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Pokémon Sealed Product Price Dashboard</h1>
      <ProductPrices />

      {/* CardRinkTCG Promotional Footer */}
      <CardRinkPromo variant="footer" />
    </main>
  );
}
