"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
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
}: {
  data: PriceHistoryEntry[];
  range: "7D" | "30D" | "90D";
  currency?: Currency;
  exchangeRate?: number;
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
    const daysNeeded = range === "7D" ? 7 : range === "90D" ? 90 : 30;
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
    const daysNeeded = range === "7D" ? 7 : range === "90D" ? 90 : 30;
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

  // Custom tooltip component with better styling
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 text-white px-3 py-2 rounded-lg shadow-lg border border-slate-600">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-sm">
            <span className="text-green-400">Price: </span>
            {currencySymbol}{payload[0].value.toFixed(2)} {currency}
          </p>
        </div>
      );
    }
    return null;
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
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={slicedData}>
            <defs>
              <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="10%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis domain={["dataMin", "dataMax"]} hide />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="price"
              stroke="#3b82f6"
              fillOpacity={1}
              fill="url(#priceArea)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}