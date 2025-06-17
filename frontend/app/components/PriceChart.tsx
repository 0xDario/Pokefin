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
    const map = new Map<string, PriceHistoryEntry>();
    for (const entry of data) {
      const date = new Date(entry.recorded_at).toISOString().split("T")[0];
      if (!map.has(date)) map.set(date, entry);
    }
    return Array.from(map.entries())
      .map(([date, entry]) => ({
        date: new Date(date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        price: entry.usd_price,
        timestamp: date,
      }))
      .reverse(); // assuming ascending order from DB
  }, [data]);

  const slicedData = useMemo(() => {
    if (range === "7D") return groupedDaily.slice(-7);
    if (range === "90D") return groupedDaily.slice(-90);
    return groupedDaily.slice(-30);
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
