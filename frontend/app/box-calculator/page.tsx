import { Suspense } from "react";
import BoxCalculator from "../components/BoxCalculator/BoxCalculator";
import CardRinkPromo from "../components/CardRinkPromo";

export default function BoxCalculatorPage() {
  return (
    <main className="p-3 md:p-6">
      <div className="mb-5 md:mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-pokeball)]">
          Pokéfin Tools
        </p>
        <h1 className="mt-1 text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
          Collection Box NAV Calculator
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Build a recipe for any collection box and see if it&apos;s a good deal based on today&apos;s market prices.
        </p>
      </div>
      <Suspense fallback={<div className="max-w-4xl mx-auto"><div className="h-64 bg-slate-100 rounded-xl animate-pulse" /></div>}>
        <BoxCalculator />
      </Suspense>
      <CardRinkPromo variant="footer" />
    </main>
  );
}
