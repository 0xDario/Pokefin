"use client";

import { useEffect, useMemo, useState } from "react";
import { Product, PriceHistoryEntry, ChartTimeframe } from "../types";
import { supabase } from "../../../lib/supabase";

type HistoryByProduct = Record<number, PriceHistoryEntry[]>;
type HistoryRow = { product_id: number; usd_price: number; recorded_at: string };

type ProductCache = {
  data: Product[] | null;
  fetchedAt: number;
  promise: Promise<Product[]> | null;
};

type HistoryCache = {
  data: HistoryByProduct;
  productIdsKey: string;
  fetchedAt: number;
  promise: Promise<HistoryByProduct> | null;
};

const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000;
const HISTORY_CACHE_TTL_MS = 2 * 60 * 1000;
const HISTORY_PAGE_SIZE = 1000;
const HISTORY_PARALLEL_PAGES = 6;
const PRODUCTS_STORAGE_KEY = "pokefin:products:v2";
const HISTORY_STORAGE_PREFIX = "pokefin:history:v2:";

const productCache: ProductCache = {
  data: null,
  fetchedAt: 0,
  promise: null,
};

const historyCacheByTimeframe = new Map<ChartTimeframe, HistoryCache>();

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

function getStorageHistoryKey(timeframe: ChartTimeframe, productIdsKey: string) {
  return `${HISTORY_STORAGE_PREFIX}${timeframe}:${productIdsKey}`;
}

function transformProductRow(item: any): Product {
  return {
    ...item,
    sets:
      Array.isArray(item.sets) && item.sets.length > 0
        ? {
            ...item.sets[0],
            generations:
              Array.isArray(item.sets[0]?.generations) &&
              item.sets[0].generations.length > 0
                ? item.sets[0].generations[0]
                : item.sets[0]?.generations,
          }
        : item.sets,
    product_types:
      Array.isArray(item.product_types) && item.product_types.length > 0
        ? item.product_types[0]
        : item.product_types,
  };
}

function readSessionStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore session storage quota issues
  }
}

function buildStartDateKey(daysNeeded: number): string {
  const now = new Date();
  const startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysNeeded - 2
  );

  const year = startDate.getFullYear();
  const month = String(startDate.getMonth() + 1).padStart(2, "0");
  const day = String(startDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborterror") ||
      error.message.toLowerCase().includes("aborted")
    );
  }

  return false;
}

async function fetchProductsFromSupabase(signal: AbortSignal): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select(
      `id, usd_price, last_updated, url, image_url, variant,
       sets ( id, name, code, release_date, generation_id, expansion_type, generations!inner ( name ) ),
       product_types ( name, label )`
    )
    .order("last_updated", { ascending: false })
    .abortSignal(signal);

  if (error) {
    if (signal.aborted || isAbortError(error)) {
      throw new DOMException("Aborted", "AbortError");
    }
    throw new Error(error.message);
  }

  return (data ?? []).map(transformProductRow);
}

async function fetchHistoryPage(
  productIds: number[],
  startDateStr: string,
  from: number,
  to: number,
  signal: AbortSignal
): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from("product_price_history")
    .select("product_id, usd_price, recorded_at")
    .in("product_id", productIds)
    .gte("recorded_at", startDateStr)
    .order("recorded_at", { ascending: false })
    .order("product_id", { ascending: true })
    .range(from, to)
    .abortSignal(signal);

  if (error) {
    if (signal.aborted || isAbortError(error)) {
      throw new DOMException("Aborted", "AbortError");
    }
    throw new Error(error.message);
  }

  return data ?? [];
}

function normalizeHistory(rows: HistoryRow[]): HistoryByProduct {
  const rowsByProductAndDay = new Map<number, Map<string, PriceHistoryEntry>>();

  for (const row of rows) {
    const productMap =
      rowsByProductAndDay.get(row.product_id) ?? new Map<string, PriceHistoryEntry>();
    const dayKey = row.recorded_at.slice(0, 10);

    if (!productMap.has(dayKey)) {
      productMap.set(dayKey, {
        usd_price: row.usd_price,
        recorded_at: row.recorded_at,
      });
      rowsByProductAndDay.set(row.product_id, productMap);
    }
  }

  const normalized: HistoryByProduct = {};

  for (const [productId, byDay] of rowsByProductAndDay.entries()) {
    normalized[productId] = Array.from(byDay.values()).sort((a, b) =>
      a.recorded_at.localeCompare(b.recorded_at)
    );
  }

  return normalized;
}

async function fetchHistoryFromSupabase(
  productIds: number[],
  chartTimeframe: ChartTimeframe,
  signal: AbortSignal
): Promise<HistoryByProduct> {
  if (productIds.length === 0) return {};

  const startDateStr = buildStartDateKey(getDaysForTimeframe(chartTimeframe));

  const { count, error } = await supabase
    .from("product_price_history")
    .select("product_id", { count: "exact", head: true })
    .in("product_id", productIds)
    .gte("recorded_at", startDateStr)
    .abortSignal(signal);

  if (error) {
    if (signal.aborted || isAbortError(error)) {
      throw new DOMException("Aborted", "AbortError");
    }
    throw new Error(error.message);
  }

  const totalRows = count ?? 0;
  if (totalRows === 0) return {};

  const pageCount = Math.ceil(totalRows / HISTORY_PAGE_SIZE);
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const from = pageIndex * HISTORY_PAGE_SIZE;
    const to = from + HISTORY_PAGE_SIZE - 1;
    return { from, to };
  });

  const allRows: HistoryRow[] = [];

  for (let i = 0; i < pages.length; i += HISTORY_PARALLEL_PAGES) {
    const batch = pages.slice(i, i + HISTORY_PARALLEL_PAGES);
    const results = await Promise.all(
      batch.map(({ from, to }) =>
        fetchHistoryPage(productIds, startDateStr, from, to, signal)
      )
    );

    for (const pageRows of results) {
      allRows.push(...pageRows);
    }
  }

  return normalizeHistory(allRows);
}

/**
 * Hook to fetch products and their price history from Supabase.
 */
export function useProductData(chartTimeframe: ChartTimeframe = "1M") {
  // Avoid reading sessionStorage during render to prevent SSR/client hydration mismatches.
  const cachedProducts = productCache.data;
  const [products, setProducts] = useState<Product[]>(cachedProducts ?? []);
  const [loading, setLoading] = useState(!cachedProducts);

  const productIdsKey = useMemo(
    () => products.map((product) => product.id).sort((a, b) => a - b).join(","),
    [products]
  );

  const memoryHistory = historyCacheByTimeframe.get(chartTimeframe);
  const [priceHistory, setPriceHistory] = useState<HistoryByProduct>(
    memoryHistory?.data ?? {}
  );
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let isCancelled = false;

    async function loadProducts() {
      const now = Date.now();

      if (productCache.data) {
        setProducts(productCache.data);
        setLoading(false);
      } else {
        const sessionProducts = readSessionStorage<Product[]>(PRODUCTS_STORAGE_KEY);
        if (sessionProducts && sessionProducts.length > 0) {
          // Cache in memory for subsequent renders/navigation.
          productCache.data = sessionProducts;
          // Unknown staleness; force background refresh by leaving fetchedAt stale.
          productCache.fetchedAt = 0;
          setProducts(sessionProducts);
          setLoading(false);
        }
      }

      const isCacheFresh =
        productCache.data !== null && now - productCache.fetchedAt < PRODUCT_CACHE_TTL_MS;

      if (isCacheFresh) {
        return;
      }

      if (!productCache.promise) {
        productCache.promise = fetchProductsFromSupabase(controller.signal)
          .then((freshProducts) => {
            productCache.data = freshProducts;
            productCache.fetchedAt = Date.now();
            writeSessionStorage(PRODUCTS_STORAGE_KEY, freshProducts);
            return freshProducts;
          })
          .finally(() => {
            productCache.promise = null;
          });
      }

      try {
        const freshProducts = await productCache.promise;
        if (!isCancelled) {
          setProducts(freshProducts);
          setLoading(false);
        }
      } catch (error) {
        if (!isCancelled && !isAbortError(error)) {
          setLoading(false);
        }
      }
    }

    loadProducts();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (products.length === 0) return;

    const controller = new AbortController();
    let isCancelled = false;

    async function loadHistory() {
      const productIds = products.map((product) => product.id);
      const now = Date.now();
      const cache = historyCacheByTimeframe.get(chartTimeframe);
      const isCompatibleCache = cache?.productIdsKey === productIdsKey;
      const isCacheFresh =
        isCompatibleCache && now - (cache?.fetchedAt ?? 0) < HISTORY_CACHE_TTL_MS;

      if (isCompatibleCache) {
        setPriceHistory(cache.data);
      } else {
        const fromStorage = readSessionStorage<HistoryByProduct>(
          getStorageHistoryKey(chartTimeframe, productIdsKey)
        );
        if (fromStorage) {
          setPriceHistory(fromStorage);
          historyCacheByTimeframe.set(chartTimeframe, {
            data: fromStorage,
            productIdsKey,
            fetchedAt: Date.now(),
            promise: null,
          });
        }
      }

      if (isCacheFresh) {
        return;
      }

      setHistoryLoading(true);

      const cacheEntry = historyCacheByTimeframe.get(chartTimeframe);

      if (!cacheEntry || cacheEntry.productIdsKey !== productIdsKey) {
        historyCacheByTimeframe.set(chartTimeframe, {
          data: {},
          productIdsKey,
          fetchedAt: 0,
          promise: null,
        });
      }

      const resolvedEntry = historyCacheByTimeframe.get(chartTimeframe)!;

      if (!resolvedEntry.promise) {
        resolvedEntry.promise = fetchHistoryFromSupabase(
          productIds,
          chartTimeframe,
          controller.signal
        )
          .then((history) => {
            resolvedEntry.data = history;
            resolvedEntry.productIdsKey = productIdsKey;
            resolvedEntry.fetchedAt = Date.now();
            writeSessionStorage(
              getStorageHistoryKey(chartTimeframe, productIdsKey),
              history
            );
            return history;
          })
          .finally(() => {
            resolvedEntry.promise = null;
          });
      }

      try {
        const history = await resolvedEntry.promise;
        if (!isCancelled) {
          setPriceHistory(history);
        }
      } catch (error) {
        if (!isCancelled && !isAbortError(error)) {
          console.error("[useProductData] Failed to load history:", error);
        }
      } finally {
        if (!isCancelled) {
          setHistoryLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [products, chartTimeframe, productIdsKey]);

  return {
    products,
    priceHistory,
    loading,
    historyLoading,
  };
}
