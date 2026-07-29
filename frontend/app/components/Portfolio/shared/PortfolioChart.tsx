"use client";

import dynamic from "next/dynamic";
import type { PortfolioHistoryPoint, PortfolioTimeframe } from "../types";

interface PortfolioChartProps {
  data: PortfolioHistoryPoint[];
  timeframe: PortfolioTimeframe;
  onTimeframeChange: (timeframe: PortfolioTimeframe) => void;
  currency?: "USD" | "CAD";
  exchangeRate?: number;
  height?: number;
}

const DEFAULT_HEIGHT = 250;

// Mirrors the impl's card shell so swapping in the real chart does not shift
// the page. `loading` cannot see props, so the plot area is sized to
// DEFAULT_HEIGHT - the only value any caller currently passes.
function PortfolioChartSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Portfolio Value</h2>
        <div className="h-6 w-44 animate-pulse rounded bg-slate-100" />
      </div>
      <div
        className="w-full animate-pulse rounded-md bg-slate-100"
        style={{ height: DEFAULT_HEIGHT }}
      />
    </div>
  );
}

// Recharts (~109 KB gzip) is fetched only when the dashboard mounts, and the
// specifier matches the other chart wrappers so /portfolio and /prices share
// one async chunk instead of shipping the library twice.
// See app/components/charts/ChartBundle.tsx.
const PortfolioChartImpl = dynamic(
  () => import("../../charts/ChartBundle").then((m) => m.PortfolioChartImpl),
  {
    ssr: false,
    loading: () => <PortfolioChartSkeleton />,
  }
);

export default function PortfolioChart({
  data,
  timeframe,
  onTimeframeChange,
  currency = "USD",
  exchangeRate = 1.36,
  height = DEFAULT_HEIGHT,
}: PortfolioChartProps) {
  // Same reasoning as AllocationChart: the impl derives chartData as a direct
  // map of `data`, so an empty `data` can only ever render this text — no
  // reason to pull the Recharts chunk down for it. Kept byte-identical to the
  // impl's own empty state (which also omits the timeframe buttons).
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Portfolio Value
          </h2>
        </div>
        <div className="h-48 flex items-center justify-center text-slate-500">
          No historical data available yet
        </div>
      </div>
    );
  }

  return (
    <PortfolioChartImpl
      data={data}
      timeframe={timeframe}
      onTimeframeChange={onTimeframeChange}
      currency={currency}
      exchangeRate={exchangeRate}
      height={height}
    />
  );
}
