"use client";

import dynamic from "next/dynamic";
import { useResponsive } from "../hooks/useResponsive";
import { PriceHistoryEntry, Currency, ChartTimeframe } from "../types";

// Recharts (~109 KB gzip) is fetched only when a chart actually mounts.
// The import specifier must match the other chart wrappers so all of them
// share a single async chunk - see app/components/charts/ChartBundle.tsx.
const PriceChart = dynamic(
  () => import("../../charts/ChartBundle").then((m) => m.PriceChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[150px] md:h-[200px] w-full animate-pulse rounded-md border border-slate-200 bg-slate-100" />
    ),
  }
);

interface ResponsivePriceChartProps {
  data: PriceHistoryEntry[];
  range: ChartTimeframe;
  currency?: Currency;
  exchangeRate?: number;
  className?: string;
  releaseDate?: string;
}

/**
 * Responsive wrapper for PriceChart that adjusts height based on screen size
 *
 * - Mobile (< 768px): 150px height
 * - Desktop (>= 768px): 200px height
 */
export default function ResponsivePriceChart({
  data,
  range,
  currency = "USD",
  exchangeRate = 1.36,
  className = "",
  releaseDate,
}: ResponsivePriceChartProps) {
  const { isMobile } = useResponsive();

  // Mobile: 150px, Desktop: 200px
  const height = isMobile ? 150 : 200;

  return (
    <div className={className}>
      <PriceChart
        data={data}
        range={range}
        currency={currency}
        exchangeRate={exchangeRate}
        height={height}
        releaseDate={releaseDate}
      />
    </div>
  );
}
