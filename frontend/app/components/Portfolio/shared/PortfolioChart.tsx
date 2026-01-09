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
import type { PortfolioHistoryPoint, PortfolioTimeframe } from "../types";

interface PortfolioChartProps {
  data: PortfolioHistoryPoint[];
  timeframe: PortfolioTimeframe;
  onTimeframeChange: (timeframe: PortfolioTimeframe) => void;
  currency?: "USD" | "CAD";
  exchangeRate?: number;
  height?: number;
}

export default function PortfolioChart({
  data,
  timeframe,
  onTimeframeChange,
  currency = "USD",
  exchangeRate = 1.36,
  height = 250,
}: PortfolioChartProps) {
  const currencySymbol = currency === "CAD" ? "C$" : "$";

  const chartData = useMemo(() => {
    return data.map((point) => ({
      date: new Date(point.date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      value: currency === "CAD" ? point.value * exchangeRate : point.value,
      timestamp: point.date,
    }));
  }, [data, currency, exchangeRate]);

  const priceStats = useMemo(() => {
    const values = chartData.map((d) => d.value).filter((v) => v > 0);
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
      return (
        <div className="bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl border-2 border-green-500">
          <p className="text-xs font-semibold text-slate-300 mb-1">{label}</p>
          <p className="text-lg font-bold">
            <span className="text-green-400">
              {currencySymbol}
              {payload[0].value.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-xs text-slate-400 ml-1">{currency}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  const timeframes: PortfolioTimeframe[] = ["7D", "1M", "3M", "6M", "1Y", "ALL"];

  if (chartData.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Portfolio Value
          </h2>
        </div>
        <div className="h-48 flex items-center justify-center text-gray-500 dark:text-gray-400">
          No historical data available yet
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Portfolio Value
        </h2>
        <div className="flex gap-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                timeframe === tf
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
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
    </div>
  );
}
