import ProductPrices from "./components/ProductPrices";


export default function Home() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Pokémon Product Prices</h1>
      <ProductPrices />
    </main>
  );
}
