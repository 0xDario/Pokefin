"use client";

import { useEffect, useRef, useState } from "react";
import ResponsivePriceChart from "./ResponsivePriceChart";
import { ChartTimeframe, Currency, PriceHistoryEntry } from "../types";

// Defers mounting the chart until it scrolls near the viewport. Because
// ResponsivePriceChart pulls PriceChart in through next/dynamic, this now
// defers the recharts *download* too, not just the render. The placeholder
// below must keep a non-zero height or the observer would never fire.

interface LazyPriceChartProps {
  data: PriceHistoryEntry[];
  range: ChartTimeframe;
  currency: Currency;
  exchangeRate: number;
  releaseDate?: string;
  className?: string;
}

export default function LazyPriceChart({
  data,
  range,
  currency,
  exchangeRate,
  releaseDate,
  className = "",
}: LazyPriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = containerRef.current;

    if (!node || isVisible) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "260px 0px" }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [isVisible]);

  return (
    <div ref={containerRef} className={className}>
      {isVisible ? (
        <ResponsivePriceChart
          data={data}
          range={range}
          currency={currency}
          exchangeRate={exchangeRate}
          releaseDate={releaseDate}
        />
      ) : (
        <div className="h-[150px] md:h-[200px] w-full animate-pulse rounded-md border border-slate-200 bg-slate-100" />
      )}
    </div>
  );
}
