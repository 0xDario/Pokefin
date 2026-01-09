"use client";

import React, { useMemo } from "react";
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

type PriceHistoryEntry = {
  usd_price: number;
  recorded_at: string;
};

type Currency = "USD" | "CAD";

export default function PriceChart({
  data,
  range,
  currency = "USD",
  exchangeRate = 1.36,
  height = 200,
}: {
  data: PriceHistoryEntry[];
  range: "7D" | "1M" | "3M" | "6M" | "1Y";
  currency?: Currency;
  exchangeRate?: number;
  height?: number;
}) {
  const groupedDaily = useMemo(() => {
    console.log(`[PriceChart] Raw data received (${data.length} entries):`, data.slice(0, 5));

    // Group by date, keeping the first entry for each date (newest since data comes in desc order)
    const map = new Map<string, PriceHistoryEntry>();
    for (const entry of data) {
      const date = new Date(entry.recorded_at).toISOString().split("T")[0];
      if (!map.has(date)) {
        map.set(date, entry);
        console.log(`[PriceChart] Adding entry for date ${date}:`, entry);
      }
    }

    console.log(`[PriceChart] Unique dates found: ${map.size}`);
    console.log(`[PriceChart] Date range:`, Array.from(map.keys()).sort());

    // Convert to array and sort by date in ascending order (oldest to newest for chart display)
    const result: Array<{ date: string; price: number | null; timestamp: string }> = Array.from(map.entries())
      .map(([date, entry]) => ({
        date: new Date(date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        price: currency === "CAD" ? entry.usd_price * exchangeRate : entry.usd_price,
        timestamp: date,
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)); // Sort by date ascending

    console.log(`[PriceChart] Processed data for chart:`, result);
    return result;
  }, [data, currency, exchangeRate]);

  const slicedData = useMemo(() => {
    const daysNeeded = range === "7D" ? 7 : range === "1M" ? 30 : range === "3M" ? 90 : range === "6M" ? 180 : 365;
    let result = groupedDaily.slice(-daysNeeded);

    console.log(`[PriceChart] Sliced data for ${range} (${result.length} points):`, result);

    // If we have less data than requested, pad the beginning with null values
    if (result.length < daysNeeded) {
      const missingDays = daysNeeded - result.length;
      const paddedData = [];

      // Get the earliest date from our actual data
      const earliestDate = result.length > 0
        ? new Date(result[0].timestamp)
        : new Date();

      // Add null entries for missing days
      for (let i = missingDays; i > 0; i--) {
        const date = new Date(earliestDate);
        date.setDate(date.getDate() - i);
        paddedData.push({
          date: date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          price: null,
          timestamp: date.toISOString().split("T")[0],
        });
      }

      result = [...paddedData, ...result];
      console.log(`[PriceChart] Padded with ${missingDays} null entries for incomplete data`);
    }

    return result;
  }, [range, groupedDaily]);

  // Calculate data availability
  const dataAvailability = useMemo(() => {
    const daysNeeded = range === "7D" ? 7 : range === "1M" ? 30 : range === "3M" ? 90 : range === "6M" ? 180 : 365;
    const actualDataPoints = groupedDaily.slice(-daysNeeded).length;
    const isIncomplete = actualDataPoints < daysNeeded;

    return {
      isIncomplete,
      actualDays: actualDataPoints,
      requestedDays: daysNeeded,
      percentComplete: Math.round((actualDataPoints / daysNeeded) * 100),
    };
  }, [range, groupedDaily]);

  // Get the currency symbol
  const currencySymbol = currency === "CAD" ? "C$" : "$";

  // Calculate min and max for better Y-axis domain
  const priceStats = useMemo(() => {
    const prices = slicedData.map(d => d.price).filter((p): p is number => p !== null);
    if (prices.length === 0) return { min: 0, max: 100 };

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.1; // 10% padding

    return {
      min: Math.max(0, min - padding),
      max: max + padding,
    };
  }, [slicedData]);

  // Custom tooltip component with better styling
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length && payload[0].value !== null) {
      return (
        <div className="bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl border-2 border-blue-500">
          <p className="text-xs font-semibold text-slate-300 mb-1">{label}</p>
          <p className="text-lg font-bold">
            <span className="text-blue-400">{currencySymbol}{payload[0].value.toFixed(2)}</span>
            <span className="text-xs text-slate-400 ml-1">{currency}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  // Custom dot component for data points
  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.price === null) return null;

    return (
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill="#3b82f6"
        stroke="#fff"
        strokeWidth={1.5}
        className="transition-all hover:r-5"
      />
    );
  };

  return (
    <div className="w-full relative">
      {/* Data availability indicator */}
      {dataAvailability.isIncomplete && (
        <div className="absolute top-0 right-0 z-10 flex items-center gap-2 px-2 py-1 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800 shadow-sm">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="font-medium">
            Only {dataAvailability.actualDays}d of data
          </span>
        </div>
      )}

      {/* Chart container with conditional styling */}
      <div className={`w-full ${dataAvailability.isIncomplete ? "opacity-90 border-l-4 border-amber-300 pl-2" : ""}`}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={slicedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e2e8f0"
              strokeOpacity={0.5}
              vertical={false}
            />

            {/* X-Axis with date labels */}
            <XAxis
              dataKey="date"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={{ stroke: "#cbd5e1" }}
              axisLine={{ stroke: "#cbd5e1" }}
              interval="preserveStartEnd"
              minTickGap={30}
            />

            {/* Y-Axis with price labels */}
            <YAxis
              domain={[priceStats.min, priceStats.max]}
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={{ stroke: "#cbd5e1" }}
              axisLine={{ stroke: "#cbd5e1" }}
              tickFormatter={(value) => `${currencySymbol}${value.toFixed(0)}`}
              width={45}
            />

            {/* Enhanced Tooltip with crosshair */}
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: "#3b82f6",
                strokeWidth: 1,
                strokeDasharray: "5 5",
              }}
            />

            {/* Subtle area fill */}
            <Area
              type="monotone"
              dataKey="price"
              stroke="none"
              fillOpacity={1}
              fill="url(#priceArea)"
              connectNulls={false}
            />

            {/* Bold line on top with markers */}
            <Line
              type="monotone"
              dataKey="price"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={<CustomDot />}
              activeDot={{ r: 5, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}