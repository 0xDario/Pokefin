import { Suspense } from "react";
import BoxCalculator from "../components/BoxCalculator/BoxCalculator";
import CardRinkPromo from "../components/CardRinkPromo";

export default function BoxCalculatorPage() {
  return (
    <main className="p-3 md:p-6">
      <div className="mb-4 flex flex-col gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">
            Collection Box NAV Calculator
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Build a recipe for any collection box and see if it&apos;s a good deal based on today&apos;s market prices.
          </p>
        </div>
      </div>
      <Suspense fallback={<div className="max-w-4xl mx-auto animate-pulse"><div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl" /></div>}>
        <BoxCalculator />
      </Suspense>
      <CardRinkPromo variant="footer" />
    </main>
  );
}
