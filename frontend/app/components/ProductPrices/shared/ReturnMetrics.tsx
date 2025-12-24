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
 * - 30D chart → shows 7D and 30D returns
 * - 90D chart → shows 30D and 90D returns
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

  // Calculate 90D return
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
    } else if (chartTimeframe === "30D") {
      // Show 7D and 30D
      const metric7D = renderMetric("7D", get7DReturn());
      const metric30D = renderMetric("30D", get30DReturn());
      if (metric7D) metrics.push(metric7D);
      if (metric30D) metrics.push(metric30D);
    } else if (chartTimeframe === "90D") {
      // Show 30D and 90D
      const metric30D = renderMetric("30D", get30DReturn());
      const metric90D = renderMetric("90D", get90DReturn());
      if (metric30D) metrics.push(metric30D);
      if (metric90D) metrics.push(metric90D);
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
