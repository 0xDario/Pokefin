"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMarketProductsClient, fetchProductHistoryClient } from "../../../lib/clientMarketData";
import { getDaysForTimeframe } from "../../../lib/marketData";
import { Product, PriceHistoryEntry, ChartTimeframe } from "../types";

type UseProductDataOptions = {
  initialProducts?: Product[];
};

export function useProductData(options: UseProductDataOptions = {}) {
  const initialProducts = options.initialProducts ?? [];
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [priceHistory, setPriceHistory] = useState<Record<number, PriceHistoryEntry[]>>({});
  const [historyRanges, setHistoryRanges] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(initialProducts.length === 0);
  const [loadingProductIds, setLoadingProductIds] = useState<number[]>([]);

  useEffect(() => {
    if (initialProducts.length > 0) {
      setProducts(initialProducts);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchProducts() {
      setLoading(true);
      try {
        const nextProducts = await fetchMarketProductsClient();
        if (!cancelled) {
          setProducts(nextProducts);
        }
      } catch (error) {
        console.error("[useProductData] Failed to load products:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchProducts();

    return () => {
      cancelled = true;
    };
  }, [initialProducts]);

  const ensureHistoryLoaded = useCallback(
    async (productId: number, timeframe: ChartTimeframe) => {
      const requestedDays = getDaysForTimeframe(timeframe);
      const existingHistory = priceHistory[productId];
      if (
        existingHistory &&
        existingHistory.length > 0 &&
        (historyRanges[productId] ?? 0) >= requestedDays
      ) {
        return existingHistory;
      }

      setLoadingProductIds((prev) =>
        prev.includes(productId) ? prev : [...prev, productId]
      );

      try {
        const history = await fetchProductHistoryClient(productId, timeframe);
        setPriceHistory((prev) => {
          if (
            prev[productId] &&
            (historyRanges[productId] ?? 0) >= requestedDays
          ) {
            return prev;
          }

          return {
            ...prev,
            [productId]: history,
          };
        });
        setHistoryRanges((prev) => ({
          ...prev,
          [productId]: Math.max(prev[productId] ?? 0, requestedDays),
        }));
        return history;
      } catch (error) {
        console.error("[useProductData] Failed to load history:", error);
        return [];
      } finally {
        setLoadingProductIds((prev) => prev.filter((id) => id !== productId));
      }
    },
    [historyRanges, priceHistory]
  );

  const historyLoading = useMemo(() => loadingProductIds.length > 0, [loadingProductIds]);

  return {
    products,
    priceHistory,
    loading,
    historyLoading,
    loadingProductIds,
    ensureHistoryLoaded,
  };
}
