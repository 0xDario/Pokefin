import React from "react";
import { hasCurrentPrice } from "../../../lib/priceGuard";
import {
  ChartTimeframe,
  Currency,
  PriceHistoryEntry,
  ProductReturnMetrics,
} from "../types";

interface ReturnMetricsProps {
  chartTimeframe: ChartTimeframe;
  selectedCurrency: Currency;
  exchangeRate: number;
  returnMetrics?: ProductReturnMetrics | null;
  history?: PriceHistoryEntry[];
  /**
   * The product's guarded price. Null means the freshness guard withheld it,
   * which also disqualifies every return derived from it — without this the
   * local recompute below cannot tell "withheld" from "not supplied" and
   * quietly puts the numbers back.
   */
  usdPrice?: number | null;
  layout?: "vertical" | "horizontal";
  className?: string;
}

interface ReturnData {
  percent: number;
}

function getHistoricalReturn(
  history: PriceHistoryEntry[] | undefined,
  days: number,
  convertPrice: (usdPrice: number) => number
): ReturnData | null {
  if (!history || history.length < 2) return null;

  const latestEntry = history[history.length - 1];
  const currentPrice = convertPrice(latestEntry.usd_price);
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - days);

  // The newest reading must fall inside the window, or there is no "now" to
  // measure to: without this the loop's first match is that same newest row
  // and the function returns a flat 0.00%, reading as a stable product rather
  // than an unpriced one. Mirrors the identical bail in
  // MarketView/returns.ts, which this helper was otherwise a copy of.
  if (new Date(latestEntry.recorded_at) <= targetDate) return null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entryDate = new Date(history[i].recorded_at);
    if (entryDate <= targetDate) {
      const pastPrice = convertPrice(history[i].usd_price);
      if (pastPrice === 0) return null;
      return {
        percent: ((currentPrice - pastPrice) / pastPrice) * 100,
      };
    }
  }

  return null;
}

function getMetricLabels(chartTimeframe: ChartTimeframe) {
  if (chartTimeframe === "7D") return ["1D", "7D"] as const;
  if (chartTimeframe === "1M") return ["7D", "1M"] as const;
  if (chartTimeframe === "3M") return ["1M", "3M"] as const;
  if (chartTimeframe === "6M") return ["3M", "6M"] as const;
  return ["3M", "6M", "1Y"] as const;
}

export default function ReturnMetrics({
  chartTimeframe,
  selectedCurrency,
  exchangeRate,
  returnMetrics,
  history,
  usdPrice,
  layout = "vertical",
  className = "",
}: ReturnMetricsProps) {
  const convertPrice = (usdPrice: number): number => {
    return selectedCurrency === "CAD" ? usdPrice * exchangeRate : usdPrice;
  };

  const labels = getMetricLabels(chartTimeframe);
  const metrics = labels
    .map((label) => {
      const fromSummary = returnMetrics?.[label];
      let value = fromSummary ?? null;

      // Only fill a gap in the supplied metrics, never override a withheld
      // one: with no current price there is nothing to measure a return to.
      if (value === null && hasCurrentPrice({ usd_price: usdPrice })) {
        const days =
          label === "1D"
            ? 1
            : label === "7D"
            ? 7
            : label === "1M"
            ? 30
            : label === "3M"
            ? 90
            : label === "6M"
            ? 180
            : 365;
        value = getHistoricalReturn(history, days, convertPrice)?.percent ?? null;
      }

      if (value === null || Number.isNaN(value)) {
        return null;
      }

      const percentSign = value > 0 ? "+" : "";
      const colorClass =
        value > 0
          ? "text-green-600"
          : value < 0
          ? "text-red-600"
          : "text-slate-500";

      return (
        <p className="text-sm text-slate-600" key={label}>
          {label}:{" "}
          <span className={`font-bold ${colorClass}`}>
            {percentSign}
            {value.toFixed(2)}%
          </span>
        </p>
      );
    })
    .filter(Boolean);

  if (metrics.length === 0) return null;

  const layoutClass =
    layout === "horizontal"
      ? "flex flex-col sm:flex-row gap-2 sm:gap-3"
      : "space-y-1";

  return <div className={`${layoutClass} ${className}`}>{metrics}</div>;
}
