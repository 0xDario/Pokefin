"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { Product, PriceHistoryEntry, ChartTimeframe } from "../types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

/**
 * Calculate days needed based on chart timeframe.
 */
function getDaysForTimeframe(timeframe: ChartTimeframe): number {
  const timeframeToDays: Record<ChartTimeframe, number> = {
    "7D": 7,
    "1M": 30,
    "3M": 90,
    "6M": 180,
    "1Y": 365,
  };
  return timeframeToDays[timeframe];
}

/**
 * Hook to fetch products and their price history from Supabase.
 */
export function useProductData(chartTimeframe: ChartTimeframe = "1M") {
  const [products, setProducts] = useState<Product[]>([]);
  const [priceHistory, setPriceHistory] = useState<Record<number, PriceHistoryEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Track if we've already fetched for this timeframe to prevent duplicate fetches.
  const lastFetchRef = useRef<{ timeframe: string; productIds: string } | null>(null);

  // Fetch products (runs once on mount).
  useEffect(() => {
    async function fetchProducts() {
      const { data, error } = await supabase
        .from("products")
        .select(
          `id, usd_price, last_updated, url, image_url, variant,
           sets ( id, name, code, release_date, generation_id, expansion_type, generations!inner ( name ) ),
           product_types ( name, label )`
        )
        .order("last_updated", { ascending: false });

      if (!error && data) {
        // Transform Supabase array results to single objects
        const transformedData: Product[] = data.map((item: any) => ({
          ...item,
          sets: Array.isArray(item.sets) && item.sets.length > 0
            ? {
                ...item.sets[0],
                generations: Array.isArray(item.sets[0]?.generations) && item.sets[0].generations.length > 0
                  ? item.sets[0].generations[0]
                  : item.sets[0]?.generations,
              }
            : item.sets,
          product_types: Array.isArray(item.product_types) && item.product_types.length > 0
            ? item.product_types[0]
            : item.product_types,
        }));
        setProducts(transformedData);
      }
      setLoading(false);
    }
    fetchProducts();
  }, []);

  // Fetch price history.
  useEffect(() => {
    if (products.length === 0) return;

    const productIds = products.map((product) => product.id);
    const productIdsKey = productIds.slice(0, 10).join(",");

    if (
      lastFetchRef.current?.timeframe === chartTimeframe &&
      lastFetchRef.current?.productIds === productIdsKey
    ) {
      return;
    }

    let isActive = true;

    async function fetchHistory() {
      setHistoryLoading(true);

      const daysNeeded = getDaysForTimeframe(chartTimeframe);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysNeeded);

      try {
        // Query product_price_history directly instead of using RPC
        const { data, error } = await supabase
          .from("product_price_history")
          .select("product_id, usd_price, recorded_at")
          .in("product_id", productIds)
          .gte("recorded_at", startDate.toISOString())
          .order("recorded_at", { ascending: false });

        if (error) {
          console.error("[useProductData] Fetch error:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          return;
        }

        // Deduplicate: keep only the latest entry per product per day
        const historyByProduct: Record<number, PriceHistoryEntry[]> = {};
        const seenDates: Record<number, Set<string>> = {};

        for (const entry of data || []) {
          const dateKey = entry.recorded_at.split("T")[0]; // Extract YYYY-MM-DD

          if (!seenDates[entry.product_id]) {
            seenDates[entry.product_id] = new Set();
            historyByProduct[entry.product_id] = [];
          }

          // Skip if we already have an entry for this product on this date
          if (seenDates[entry.product_id].has(dateKey)) {
            continue;
          }

          seenDates[entry.product_id].add(dateKey);
          historyByProduct[entry.product_id].push({
            usd_price: entry.usd_price,
            recorded_at: entry.recorded_at,
          });
        }

        if (isActive) {
          setPriceHistory(historyByProduct);
          lastFetchRef.current = { timeframe: chartTimeframe, productIds: productIdsKey };
        }
      } catch (err) {
        console.error("[useProductData] Fetch exception:", err);
      } finally {
        if (isActive) {
          setHistoryLoading(false);
        }
      }
    }

    fetchHistory();

    return () => {
      isActive = false;
    };
  }, [products, chartTimeframe]);

  return {
    products,
    priceHistory,
    loading,
    historyLoading,
  };
}
