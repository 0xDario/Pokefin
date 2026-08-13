"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
  ComposedChart,
} from "recharts";
import type {
  PortfolioHistoryPoint,
  PortfolioTimeframe,
} from "../Portfolio/types";

export interface PortfolioChartImplProps {
  data: PortfolioHistoryPoint[];
  timeframe: PortfolioTimeframe;
  onTimeframeChange: (timeframe: PortfolioTimeframe) => void;
  currency?: "USD" | "CAD";
  exchangeRate?: number;
  height?: number;
}

/**
 * Recharts implementation of PortfolioChart. Only reachable through the
 * lazily-loaded ChartBundle chunk - import the wrapper in
 * components/Portfolio/shared/PortfolioChart.tsx instead of this file.
 */
export default function PortfolioChartImpl({
  data,
  timeframe,
  onTimeframeChange,
  currency = "USD",
  exchangeRate = 1.36,
  height = 250,
}: PortfolioChartImplProps) {
  const currencySymbol = currency === "CAD" ? "C$" : "$";

  const chartData = useMemo(() => {
    return data.map((point) => ({
      date: new Date(point.date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      value:
        point.value === null
          ? null
          : currency === "CAD"
            ? point.value * exchangeRate
            : point.value,
      timestamp: point.date,
      pricedProducts: point.priced_products,
      heldProducts: point.held_products,
      // A day valued from only some of the holdings is not comparable to a day
      // valued from all of them: a product going stale drops the line by its
      // whole value and reads as a loss that never happened. The point is
      // still plotted — dropping it would blank stretches where most holdings
      // are priced perfectly well — but it is marked, so the chart never
      // silently passes partial coverage off as the portfolio total.
      isPartial:
        point.priced_products !== undefined &&
        point.held_products !== undefined &&
        point.priced_products < point.held_products,
    }));
  }, [data, currency, exchangeRate]);

  const partialDays = useMemo(
    () => chartData.filter((point) => point.isPartial).length,
    [chartData]
  );

  const priceStats = useMemo(() => {
    const values = chartData
      .map((d) => d.value)
      .filter((value): value is number => value !== null && value > 0);
    if (values.length === 0) return { min: 0, max: 100 };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1;

    return {
      min: Math.max(0, min - padding),
      max: max + padding,
    };
  }, [chartData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length && payload[0].value !== null) {
      const point = payload[0].payload;
      return (
        <div className="bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl border-2 border-emerald-500">
          <p className="text-xs font-semibold text-slate-300 mb-1">{label}</p>
          <p className="text-lg font-bold">
            <span className="text-emerald-400">
              {currencySymbol}
              {payload[0].value.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-xs text-slate-400 ml-1">{currency}</span>
          </p>
          {point?.isPartial && (
            <p className="text-xs text-amber-300 mt-1">
              {point.pricedProducts} of {point.heldProducts} products priced —
              not comparable to fully priced days
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const timeframes: PortfolioTimeframe[] = ["7D", "1M", "3M", "6M", "1Y", "ALL"];

  // A series of points that are all null is not an empty series: it plots a
  // blank canvas against the synthetic 0-100 fallback axis, which reads as a
  // rendering fault rather than as "nothing here could be valued". Checked
  // separately from length so a genuine zero still charts.
  const hasAnyValue = chartData.some((point) => point.value !== null);

  if (chartData.length === 0 || !hasAnyValue) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Portfolio Value
          </h2>
          {/* The timeframe buttons live only in this header, so omitting them
              here strands the user: picking a range with no valuations would
              remove the control that selects a different one, and only a
              reload would get them back. */}
          <div className="flex gap-1">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  timeframe === tf
                    ? "bg-emerald-100 text-emerald-700"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <div className="h-48 flex items-center justify-center text-slate-500">
          {chartData.length === 0
            ? "No historical data available yet"
            : "No current prices for this period"}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Portfolio Value
        </h2>
        <div className="flex gap-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                timeframe === tf
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="portfolioArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e2e8f0"
            strokeOpacity={0.5}
            vertical={false}
          />

          <XAxis
            dataKey="date"
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={{ stroke: "#cbd5e1" }}
            axisLine={{ stroke: "#cbd5e1" }}
            interval="preserveStartEnd"
            minTickGap={30}
          />

          <YAxis
            domain={[priceStats.min, priceStats.max]}
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={{ stroke: "#cbd5e1" }}
            axisLine={{ stroke: "#cbd5e1" }}
            tickFormatter={(value) =>
              `${currencySymbol}${value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0)}`
            }
            width={55}
          />

          <Tooltip
            content={<CustomTooltip />}
            cursor={{
              stroke: "#22c55e",
              strokeWidth: 1,
              strokeDasharray: "5 5",
            }}
          />

          <Area
            type="monotone"
            dataKey="value"
            stroke="none"
            fillOpacity={1}
            fill="url(#portfolioArea)"
          />

          <Line
            type="monotone"
            dataKey="value"
            stroke="#22c55e"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: "#22c55e", stroke: "#fff", strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {partialDays > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {partialDays} {partialDays === 1 ? "day is" : "days are"} valued from
          only part of the portfolio — hover for the coverage. Movement across
          those points reflects what could be priced, not a change in holdings.
        </p>
      )}
    </div>
  );
}
