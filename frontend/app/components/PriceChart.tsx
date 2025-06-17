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

export default function PriceChart({
  data,
  range,
}: {
  data: PriceHistoryEntry[];
  range: "7D" | "30D" | "90D";
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
    const result = Array.from(map.entries())
      .map(([date, entry]) => ({
        date: new Date(date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        price: entry.usd_price,
        timestamp: date,
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)); // Sort by date ascending
      
    console.log(`[PriceChart] Processed data for chart:`, result);
    return result;
  }, [data]);

  const slicedData = useMemo(() => {
    let result;
    // Now slice from the end to get the most recent N days
    if (range === "7D") result = groupedDaily.slice(-7);
    else if (range === "90D") result = groupedDaily.slice(-90);
    else result = groupedDaily.slice(-30);
    
    console.log(`[PriceChart] Sliced data for ${range} (${result.length} points):`, result);
    return result;
  }, [range, groupedDaily]);

  return (
    <div className="w-full">
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
          <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
          <Area
            type="monotone"
            dataKey="price"
            stroke="#3b82f6"
            fillOpacity={1}
            fill="url(#priceArea)"
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}