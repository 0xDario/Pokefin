"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  ChartTimeframe,
  PriceHistoryEntry,
  SalesHistoryEntry,
} from "../../components/ProductPrices/types";

const CHART_HEIGHT = 320;

// Recharts (~109 KB gzip) is fetched only when a chart actually mounts.
// The import specifier must match the other chart wrappers so all of them
// share a single async chunk - see app/components/charts/ChartBundle.tsx.
const PriceChart = dynamic(
  () => import("../../components/charts/ChartBundle").then((m) => m.PriceChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full animate-pulse rounded-lg border border-slate-200 bg-slate-100"
        style={{ height: CHART_HEIGHT }}
      />
    ),
  }
);

const TIMEFRAMES: ChartTimeframe[] = ["7D", "1M", "3M", "6M", "1Y"];

interface ProductDetailChartProps {
  history: PriceHistoryEntry[];
  releaseDate?: string;
  salesHistory?: SalesHistoryEntry[];
}

export default function ProductDetailChart({
  history,
  releaseDate,
  salesHistory,
}: ProductDetailChartProps) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("3M");
  const hasHistory = history.length > 1;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-slate-900">Price History</h2>
        <div
          role="radiogroup"
          aria-label="Chart timeframe"
          className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5"
        >
          {TIMEFRAMES.map((tf) => {
            const active = timeframe === tf;
            return (
              <button
                key={tf}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:ring-offset-1 ${
                  active
                    ? "bg-[var(--pf-pokeblue)] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {tf}
              </button>
            );
          })}
        </div>
      </div>

      {hasHistory ? (
        <PriceChart
          data={history}
          range={timeframe}
          currency="USD"
          exchangeRate={1}
          height={CHART_HEIGHT}
          releaseDate={releaseDate}
          salesHistory={salesHistory}
        />
      ) : (
        <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
          Not enough price history yet for this product.
        </div>
      )}
    </div>
  );
}
