import React from "react";
import { ChartTimeframe, Currency, PriceHistoryEntry } from "../types";

interface ReturnMetricsProps {
  productId: number;
  chartTimeframe: ChartTimeframe;
  priceHistory: Record<number, PriceHistoryEntry[]>;
  selectedCurrency: Currency;
  exchangeRate: number;
  layout?: "vertical" | "horizontal";
  className?: string;
}

interface ReturnData {
  percent: number;
  dollarChange: number;
}

/**
 * ReturnMetrics component displays price return percentages
 * Filters metrics to show only those relevant to the selected chart timeframe
 *
 * - 7D chart → shows 1D and 7D returns
 * - 1M chart → shows 7D and 1M (30D) returns
 * - 3M chart → shows 1M (30D) and 3M (90D) returns
 * - 6M chart → shows 3M (90D) and 6M (180D) returns
 * - 1Y chart → shows 3M (90D), 6M (180D), and 1Y (365D) returns
 */
export default function ReturnMetrics({
  productId,
  chartTimeframe,
  priceHistory,
  selectedCurrency,
  exchangeRate,
  layout = "vertical",
  className = "",
}: ReturnMetricsProps) {
  const history = priceHistory[productId];

  // Helper to convert price based on currency
  const convertPrice = (usdPrice: number): number => {
    return selectedCurrency === "CAD" ? usdPrice * exchangeRate : usdPrice;
  };

  // Calculate 1D return
  const get1DReturn = (): ReturnData | null => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const pastEntry = history.find((entry) => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= oneDayAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  // Calculate 7D return
  const get7DReturn = (): ReturnData | null => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const pastEntry = history.find((entry) => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= sevenDaysAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  // Calculate 30D return
  const get30DReturn = (): ReturnData | null => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const pastEntry = history.find((entry) => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= thirtyDaysAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  // Calculate 90D (3M) return
  const get90DReturn = (): ReturnData | null => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const pastEntry = history.find((entry) => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= ninetyDaysAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  // Calculate 180D (6M) return
  const get180DReturn = (): ReturnData | null => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const oneEightyDaysAgo = new Date();
    oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);

    const pastEntry = history.find((entry) => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= oneEightyDaysAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  // Calculate 365D (1Y) return
  const get365DReturn = (): ReturnData | null => {
    if (!history || history.length < 2) return null;

    const currentPrice = convertPrice(history[0].usd_price);
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);

    const pastEntry = history.find((entry) => {
      const entryDate = new Date(entry.recorded_at);
      return entryDate <= oneYearAgo;
    });

    if (!pastEntry) return null;

    const pastPrice = convertPrice(pastEntry.usd_price);
    const percentChange = ((currentPrice - pastPrice) / pastPrice) * 100;

    return {
      percent: percentChange,
      dollarChange: currentPrice - pastPrice,
    };
  };

  // Render individual metric
  const renderMetric = (label: string, returnData: ReturnData | null) => {
    if (!returnData || typeof returnData.percent !== "number") return null;

    const percentSign = returnData.percent > 0 ? "+" : "";
    const colorClass =
      returnData.percent > 0
        ? "text-green-600"
        : returnData.percent < 0
        ? "text-red-600"
        : "text-slate-500";

    return (
      <p className="text-sm text-slate-600" key={label}>
        {label}:{" "}
        <span className={`font-bold ${colorClass}`}>
          {percentSign}
          {returnData.percent.toFixed(2)}%
        </span>
      </p>
    );
  };

  // Determine which metrics to show based on chart timeframe
  const getMetricsToShow = () => {
    const metrics: (React.ReactElement | null)[] = [];

    if (chartTimeframe === "7D") {
      // Show 1D and 7D
      const metric1D = renderMetric("1D", get1DReturn());
      const metric7D = renderMetric("7D", get7DReturn());
      if (metric1D) metrics.push(metric1D);
      if (metric7D) metrics.push(metric7D);
    } else if (chartTimeframe === "1M") {
      // Show 7D and 1M (30D)
      const metric7D = renderMetric("7D", get7DReturn());
      const metric1M = renderMetric("1M", get30DReturn());
      if (metric7D) metrics.push(metric7D);
      if (metric1M) metrics.push(metric1M);
    } else if (chartTimeframe === "3M") {
      // Show 1M (30D) and 3M (90D)
      const metric1M = renderMetric("1M", get30DReturn());
      const metric3M = renderMetric("3M", get90DReturn());
      if (metric1M) metrics.push(metric1M);
      if (metric3M) metrics.push(metric3M);
    } else if (chartTimeframe === "6M") {
      // Show 3M (90D) and 6M (180D)
      const metric3M = renderMetric("3M", get90DReturn());
      const metric6M = renderMetric("6M", get180DReturn());
      if (metric3M) metrics.push(metric3M);
      if (metric6M) metrics.push(metric6M);
    } else if (chartTimeframe === "1Y") {
      // Show 3M (90D), 6M (180D), and 1Y (365D)
      const metric3M = renderMetric("3M", get90DReturn());
      const metric6M = renderMetric("6M", get180DReturn());
      const metric1Y = renderMetric("1Y", get365DReturn());
      if (metric3M) metrics.push(metric3M);
      if (metric6M) metrics.push(metric6M);
      if (metric1Y) metrics.push(metric1Y);
    }

    return metrics;
  };

  const metrics = getMetricsToShow();

  if (metrics.length === 0) return null;

  const layoutClass =
    layout === "horizontal"
      ? "flex flex-col sm:flex-row gap-2 sm:gap-3"
      : "space-y-1";

  return <div className={`${layoutClass} ${className}`}>{metrics}</div>;
}
