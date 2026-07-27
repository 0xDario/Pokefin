"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMarketProductsClient, fetchProductHistoryClient } from "../../../lib/clientMarketData";
import { getDaysForTimeframe } from "../../../lib/marketData";
import { logCaughtError } from "../../../lib/logger";
import { Product, PriceHistoryEntry, ChartTimeframe } from "../types";

type UseProductDataOptions = {
  initialProducts?: Product[];
};

// Module-level so an omitted `initialProducts` does not hand the products
// effect a brand new `[]` identity on every render.
const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_HISTORY: PriceHistoryEntry[] = [];

function sameProductList(a: Product[], b: Product[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function useProductData(options: UseProductDataOptions = {}) {
  const initialProducts = options.initialProducts ?? EMPTY_PRODUCTS;
  const [priceHistory, setPriceHistory] = useState<Record<number, PriceHistoryEntry[]>>({});
  const [fetchedProducts, setFetchedProducts] = useState<Product[] | null>(null);
  const [fetchingProducts, setFetchingProducts] = useState(
    initialProducts.length === 0
  );
  const [loadingProductIds, setLoadingProductIds] = useState<number[]>([]);

  // Callers frequently build `initialProducts` inline (an `initialProducts = []`
  // prop default, a `.filter(...)` in a parent render), which changes the array
  // identity on every render. Latch it so it only advances when the *contents*
  // change: that keeps `products` referentially stable for downstream memos and
  // stops the products effect below from re-running (and re-fetching) forever.
  // This is the documented "adjust state during render" pattern — React throws
  // away the in-progress render and retries immediately, without a commit.
  const [stableInitialProducts, setStableInitialProducts] =
    useState(initialProducts);
  if (!sameProductList(stableInitialProducts, initialProducts)) {
    setStableInitialProducts(initialProducts);
  }

  const hasInitialProducts = stableInitialProducts.length > 0;
  const products = hasInitialProducts
    ? stableInitialProducts
    : fetchedProducts ?? EMPTY_PRODUCTS;
  const loading = hasInitialProducts ? false : fetchingProducts;

  // `ensureHistoryLoaded` reads these refs instead of state so it can keep an
  // empty dependency array and stay referentially stable for the lifetime of
  // the hook. Consumers (MarketView, ProductCard, RecentlyReleased) put it in
  // effect dependency arrays; every identity change re-fires those effects and
  // kicks off another fetch, which previously produced an unbounded loop.
  const priceHistoryRef = useRef<Record<number, PriceHistoryEntry[]>>({});
  // Widest timeframe (in days) already fetched per product. A product is
  // recorded here even when its history came back EMPTY, which is what stops
  // zero-history products from refetching forever.
  const historyRangesRef = useRef<Record<number, number>>({});
  const inFlightRef = useRef(new Map<string, Promise<PriceHistoryEntry[]>>());

  useEffect(() => {
    if (hasInitialProducts) {
      return;
    }

    let cancelled = false;

    async function fetchProducts() {
      setFetchingProducts(true);
      try {
        const nextProducts = await fetchMarketProductsClient();
        if (!cancelled) {
          setFetchedProducts(nextProducts);
        }
      } catch (error) {
        logCaughtError("market_products_load_failed", error);
      } finally {
        if (!cancelled) {
          setFetchingProducts(false);
        }
      }
    }

    fetchProducts();

    return () => {
      cancelled = true;
    };
  }, [hasInitialProducts]);

  const ensureHistoryLoaded = useCallback(
    async (productId: number, timeframe: ChartTimeframe) => {
      const requestedDays = getDaysForTimeframe(timeframe);
      const loadedDays = historyRangesRef.current[productId];

      // Keyed off the loaded RANGE, not `history.length > 0`: a product with a
      // legitimately empty history must still count as loaded. A strictly
      // narrower cached range still falls through and refetches.
      if (loadedDays !== undefined && loadedDays >= requestedDays) {
        return priceHistoryRef.current[productId] ?? EMPTY_HISTORY;
      }

      // Collapse concurrent requests for the same product+range (React 19
      // StrictMode runs effects twice in development).
      const inFlightKey = `${productId}:${requestedDays}`;
      const pending = inFlightRef.current.get(inFlightKey);
      if (pending) {
        return pending;
      }

      setLoadingProductIds((prev) =>
        prev.includes(productId) ? prev : [...prev, productId]
      );

      const request = (async () => {
        try {
          const history = await fetchProductHistoryClient(productId, timeframe);

          // A wider range may have landed while this request was in flight;
          // never clobber it with the narrower result.
          const currentDays = historyRangesRef.current[productId];
          if (currentDays === undefined || currentDays < requestedDays) {
            historyRangesRef.current = {
              ...historyRangesRef.current,
              [productId]: requestedDays,
            };

            const nextHistory = {
              ...priceHistoryRef.current,
              [productId]: history,
            };
            priceHistoryRef.current = nextHistory;
            setPriceHistory(nextHistory);
          }

          return history;
        } catch (error) {
          logCaughtError("product_history_load_failed", error);
          return EMPTY_HISTORY;
        } finally {
          inFlightRef.current.delete(inFlightKey);

          // A product can have two ranges in flight at once — e.g. a viewport
          // -triggered 3M request still pending when the user switches to 1Y.
          // Each has its own key, so clearing the shared loading flag on the
          // first completion would present the narrower history as a finished
          // wider chart. Only clear once nothing is left for this product.
          const productPrefix = `${productId}:`;
          let stillLoading = false;
          for (const key of inFlightRef.current.keys()) {
            if (key.startsWith(productPrefix)) {
              stillLoading = true;
              break;
            }
          }
          if (!stillLoading) {
            setLoadingProductIds((prev) =>
              prev.includes(productId)
                ? prev.filter((id) => id !== productId)
                : prev
            );
          }
        }
      })();

      inFlightRef.current.set(inFlightKey, request);
      return request;
    },
    []
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
