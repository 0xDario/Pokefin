"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Product, PriceHistoryEntry } from "../types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

const MAX_HISTORY_DAYS = 365;
const PAGE_SIZE = 1000;

/**
 * Hook to fetch products and their price history from Supabase
 *
 * @returns {Object} products, priceHistory, and loading state
 */
export function useProductData() {
  const [products, setProducts] = useState<Product[]>([]);
  const [priceHistory, setPriceHistory] = useState<Record<number, PriceHistoryEntry[]>>({});
  const [loading, setLoading] = useState(true);

  // Fetch products
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
        setProducts(data as any);
      }
      setLoading(false);
    }
    fetchProducts();
  }, []);

  // Fetch price history for all products
  useEffect(() => {
    if (products.length === 0) return;

    async function fetchHistoryBatch() {
      console.log(`[useProductData] Fetching history for ${products.length} products...`);

      const historyStart = new Date();
      historyStart.setDate(historyStart.getDate() - MAX_HISTORY_DAYS);

      const historyByProduct: Record<number, PriceHistoryEntry[]> = {};

      const batchSize = 5;
      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        const batchIds = batch.map((p) => p.id);

        try {
          let from = 0;
          while (true) {
            const { data, error } = await supabase
              .from("product_price_history")
              .select("product_id, usd_price, recorded_at")
              .in("product_id", batchIds)
              .gte("recorded_at", historyStart.toISOString())
              .order("recorded_at", { ascending: false })
              .range(from, from + PAGE_SIZE - 1);

            if (error) {
              console.error(`[useProductData] Error fetching history for batch:`, error);
              break;
            }

            if (!data || data.length === 0) {
              break;
            }

            for (const entry of data) {
              if (!historyByProduct[entry.product_id]) {
                historyByProduct[entry.product_id] = [];
              }
              historyByProduct[entry.product_id].push({
                usd_price: entry.usd_price,
                recorded_at: entry.recorded_at,
              });
            }

            if (data.length < PAGE_SIZE) {
              break;
            }

            from += PAGE_SIZE;
          }
        } catch (err) {
          console.error(`[useProductData] Error fetching history for batch:`, err);
        }
      }

      setPriceHistory(historyByProduct);
    }

    fetchHistoryBatch();
  }, [products]);

  return {
    products,
    priceHistory,
    loading,
  };
}
