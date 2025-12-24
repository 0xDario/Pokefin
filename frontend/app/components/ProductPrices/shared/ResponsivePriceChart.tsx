"use client";

import { useResponsive } from "../hooks/useResponsive";
import PriceChart from "../../PriceChart";
import { PriceHistoryEntry, Currency, ChartTimeframe } from "../types";

interface ResponsivePriceChartProps {
  data: PriceHistoryEntry[];
  range: ChartTimeframe;
  currency?: Currency;
  exchangeRate?: number;
  className?: string;
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
      />
    </div>
  );
}
