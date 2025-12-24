"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Product, PriceHistoryEntry } from "../types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

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

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const historyByProduct: Record<number, PriceHistoryEntry[]> = {};

      const batchSize = 5;
      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        const batchIds = batch.map((p) => p.id);

        try {
          const { data, error } = await supabase
            .from("product_price_history")
            .select("product_id, usd_price, recorded_at")
            .in("product_id", batchIds)
            .gte("recorded_at", ninetyDaysAgo.toISOString())
            .order("recorded_at", { ascending: false });

          if (data && !error) {
            for (const entry of data) {
              if (!historyByProduct[entry.product_id]) {
                historyByProduct[entry.product_id] = [];
              }
              historyByProduct[entry.product_id].push({
                usd_price: entry.usd_price,
                recorded_at: entry.recorded_at,
              });
            }
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
