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

// Pulsing wavy line shown while price history is loading or unavailable.
// Reads as "we're drawing a sparkline" instead of a dead grey rectangle.
function SparklineSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`h-10 w-24 ${className}`} aria-hidden>
      <svg
        viewBox="0 0 96 40"
        className="h-full w-full animate-pulse"
        preserveAspectRatio="none"
      >
        <path
          d="M0 28 L12 22 L24 30 L36 18 L48 26 L60 14 L72 22 L84 12 L96 18"
          fill="none"
          stroke="#cbd5e1"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

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
    return <SparklineSkeleton className={className} />;
  }

  const isUp = data[data.length - 1].price >= data[0].price;
  // Match site palette: gain = emerald, loss = rose.
  const stroke = isUp ? "#059669" : "#e11d48";

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
