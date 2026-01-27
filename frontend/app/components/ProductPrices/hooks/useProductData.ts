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
    // Use all product IDs sorted to create a stable cache key
    const productIdsKey = [...productIds].sort((a, b) => a - b).join(",");

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

      // Calculate start date in UTC to match database timestamps
      // Add 1 extra day buffer to ensure we have enough data for the slice
      const now = new Date();
      const utcYear = now.getUTCFullYear();
      const utcMonth = now.getUTCMonth();
      const utcDay = now.getUTCDate();

      // Create date at midnight UTC, then subtract days
      const startDate = new Date(Date.UTC(utcYear, utcMonth, utcDay - daysNeeded - 1));

      try {
        // Format as YYYY-MM-DD for database comparison
        const startDateStr = startDate.toISOString().split("T")[0];

        console.log("[useProductData] Fetching history:", {
          productCount: productIds.length,
          daysNeeded,
          startDateStr,
        });

        // PostgREST enforces a max row limit; page through results to avoid truncation.
        const PAGE_SIZE = 1000;
        const allRows: Array<{ product_id: number; usd_price: number; recorded_at: string }> = [];
        let from = 0;
        let to = PAGE_SIZE - 1;

        while (isActive) {
          const { data, error } = await supabase
            .from("product_price_history")
            .select("product_id, usd_price, recorded_at")
            .in("product_id", productIds)
            .gte("recorded_at", startDateStr)
            .order("recorded_at", { ascending: false })
            .order("product_id", { ascending: true })
            .range(from, to);

          if (error) {
            console.error("[useProductData] Fetch error:", {
              message: error.message,
              details: error.details,
              hint: error.hint,
              code: error.code,
            });
            return;
          }

          if (!data || data.length === 0) break;

          allRows.push(...data);

          if (data.length < PAGE_SIZE) break;

          from += PAGE_SIZE;
          to += PAGE_SIZE;
        }

        console.log("[useProductData] Fetched rows:", allRows.length);

        const historyByProduct: Record<number, PriceHistoryEntry[]> = {};
        for (const entry of allRows) {
          if (!historyByProduct[entry.product_id]) {
            historyByProduct[entry.product_id] = [];
          }
          historyByProduct[entry.product_id].push({
            usd_price: entry.usd_price,
            recorded_at: entry.recorded_at,
          });
        }

        // Sort each product's history chronologically (oldest to newest)
        for (const productId of Object.keys(historyByProduct)) {
          historyByProduct[Number(productId)].sort(
            (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
          );
        }

        // Log sample data for debugging
        const sampleProductId = Object.keys(historyByProduct)[0];
        if (sampleProductId) {
          console.log("[useProductData] Sample product history:", {
            productId: sampleProductId,
            entries: historyByProduct[Number(sampleProductId)]?.length,
            dates: historyByProduct[Number(sampleProductId)]?.map(e => e.recorded_at.substring(0, 10)),
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
