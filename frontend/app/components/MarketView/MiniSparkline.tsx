"use client";

import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Currency, PriceHistoryEntry } from "../ProductPrices/types";

interface MiniSparklineProps {
  history?: PriceHistoryEntry[];
  currency: Currency;
  exchangeRate: number;
  days?: number;
  className?: string;
}

type SparklinePoint = {
  date: string;
  price: number;
};

export default function MiniSparkline({
  history,
  currency,
  exchangeRate,
  days = 7,
  className = "",
}: MiniSparklineProps) {
  const data = useMemo(() => {
    if (!history || history.length === 0) return [];

    const map = new Map<string, number>();
    for (const entry of history) {
      const dateKey = new Date(entry.recorded_at).toISOString().split("T")[0];
      if (!map.has(dateKey)) {
        const price =
          currency === "CAD" ? entry.usd_price * exchangeRate : entry.usd_price;
        map.set(dateKey, price);
      }
    }

    const points: SparklinePoint[] = Array.from(map.entries())
      .map(([date, price]) => ({ date, price }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return points.slice(-days);
  }, [history, currency, exchangeRate, days]);

  if (data.length < 2) {
    return (
      <div
        className={`h-10 w-24 rounded bg-slate-100 border border-slate-200 ${className}`}
      />
    );
  }

  const isUp = data[data.length - 1].price >= data[0].price;
  const stroke = isUp ? "#16a34a" : "#dc2626";

  return (
    <div className={`h-10 w-24 ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="price"
            stroke={stroke}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
