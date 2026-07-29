"use client";

import {
  ChartTimeframe,
  PriceHistoryEntry,
  Product,
  ProductVolumeMetrics,
  SalesHistoryEntry,
} from "../components/ProductPrices/types";
import {
  getDaysForTimeframe,
  getHistoryStartDate,
  groupHistoryRowsByProduct,
  mapMarketSummaryRowToProduct,
  mapProductsQueryResultToProducts,
  MarketSummaryRow,
} from "./marketData";
import { logCaughtError, logSupabaseError } from "./logger";
import { supabase } from "./supabase";

let marketProductsCache: Product[] | null = null;
let marketProductsPromise: Promise<Product[]> | null = null;

const productHistoryCache = new Map<number, { daysLoaded: number; history: PriceHistoryEntry[] }>();
const productHistoryPromiseCache = new Map<string, Promise<PriceHistoryEntry[]>>();

let volumeMetricsCache: Record<number, ProductVolumeMetrics> | null = null;
let volumeMetricsPromise: Promise<Record<number, ProductVolumeMetrics>> | null = null;

const salesHistoryCache = new Map<number, { daysLoaded: number; sales: SalesHistoryEntry[] }>();
const salesHistoryPromiseCache = new Map<string, Promise<SalesHistoryEntry[]>>();

function isMissingRpc(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.message?.includes("Could not find the function") ||
    error.message?.includes("does not exist") ||
    false
  );
}

async function fetchProductsFallback(): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select(
      `id, usd_price, last_updated, url, image_url, variant, sku,
       sets ( id, name, code, release_date, generation_id, expansion_type, generations!inner ( id, name ) ),
       product_types ( id, name, label )`
    )
    .eq("active", true)
    .order("last_updated", { ascending: false });

  if (error) {
    throw error;
  }

  return mapProductsQueryResultToProducts(data || []);
}

export async function fetchMarketProductsClient(): Promise<Product[]> {
  if (marketProductsCache) {
    return marketProductsCache;
  }

  if (marketProductsPromise) {
    return marketProductsPromise;
  }

  marketProductsPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc("get_market_product_summaries");
      if (error) {
        if (!isMissingRpc(error)) {
          throw error;
        }
        const fallbackProducts = await fetchProductsFallback();
        marketProductsCache = fallbackProducts;
        return fallbackProducts;
      }

      const products = ((data || []) as MarketSummaryRow[]).map(
        mapMarketSummaryRowToProduct
      );
      marketProductsCache = products;
      return products;
    } finally {
      marketProductsPromise = null;
    }
  })();

  return marketProductsPromise;
}

export async function fetchProductHistoryClient(
  productId: number,
  timeframe: ChartTimeframe
): Promise<PriceHistoryEntry[]> {
  const requestedDays = getDaysForTimeframe(timeframe);
  const cached = productHistoryCache.get(productId);
  if (cached && cached.daysLoaded >= requestedDays) {
    return cached.history;
  }

  const cacheKey = `${productId}:${timeframe}`;
  const inFlight = productHistoryPromiseCache.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const fetchPromise = (async () => {
    const startDate = getHistoryStartDate(timeframe);
    const { data, error } = await supabase
      .from("product_price_history")
      .select("product_id, usd_price, recorded_at")
      .eq("product_id", productId)
      .gte("recorded_at", startDate)
      .order("recorded_at", { ascending: true });

    if (error) {
      throw error;
    }

    const history = groupHistoryRowsByProduct(data || [])[productId] || [];
    const currentCache = productHistoryCache.get(productId);
    if (!currentCache || currentCache.daysLoaded < requestedDays) {
      productHistoryCache.set(productId, { daysLoaded: requestedDays, history });
    }
    return history;
  })();

  productHistoryPromiseCache.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    productHistoryPromiseCache.delete(cacheKey);
  }
}

/**
 * Fetch per-product sales-volume metrics via the
 * get_market_product_volume_metrics RPC. The result is cached for the
 * session (mirrors the market-products cache); errors — including the
 * RPC not existing yet — degrade to an empty record.
 */
export async function fetchVolumeMetrics(): Promise<Record<number, ProductVolumeMetrics>> {
  if (volumeMetricsCache) {
    return volumeMetricsCache;
  }

  if (volumeMetricsPromise) {
    return volumeMetricsPromise;
  }

  volumeMetricsPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc(
        "get_market_product_volume_metrics"
      );
      if (error) {
        logSupabaseError("volume_metrics_load_failed", error);
        volumeMetricsCache = {};
        return volumeMetricsCache;
      }

      const byProduct: Record<number, ProductVolumeMetrics> = {};
      for (const row of (data || []) as ProductVolumeMetrics[]) {
        byProduct[row.product_id] = row;
      }
      volumeMetricsCache = byProduct;
      return byProduct;
    } catch (error) {
      logCaughtError("volume_metrics_load_failed", error);
      volumeMetricsCache = {};
      return volumeMetricsCache;
    } finally {
      volumeMetricsPromise = null;
    }
  })();

  return volumeMetricsPromise;
}

/**
 * Fetch sales history (both 'day' and 'week' granularities) for one product,
 * covering at least the requested number of days back from today. Cached per
 * product with the same daysLoaded short-circuit as price history; errors
 * degrade to an empty array.
 */
export async function fetchSalesHistory(
  productId: number,
  days: number
): Promise<SalesHistoryEntry[]> {
  const cached = salesHistoryCache.get(productId);
  if (cached && cached.daysLoaded >= days) {
    return cached.sales;
  }

  const cacheKey = `${productId}:${days}`;
  const inFlight = salesHistoryPromiseCache.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const fetchPromise = (async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    const yyyy = start.getFullYear();
    const mm = String(start.getMonth() + 1).padStart(2, "0");
    const dd = String(start.getDate()).padStart(2, "0");
    const startDate = `${yyyy}-${mm}-${dd}`;

    let sales: SalesHistoryEntry[] = [];
    try {
      const { data, error } = await supabase
        .from("product_sales_history")
        .select(
          "bucket_date, granularity, quantity_sold, transaction_count, low_sale_price, high_sale_price, market_price"
        )
        .eq("product_id", productId)
        .gte("bucket_date", startDate)
        .order("bucket_date", { ascending: true });

      if (error) {
        logSupabaseError("sales_history_load_failed", error);
      } else {
        sales = (data || []) as SalesHistoryEntry[];
      }
    } catch (error) {
      logCaughtError("sales_history_load_failed", error);
    }

    const currentCache = salesHistoryCache.get(productId);
    if (!currentCache || currentCache.daysLoaded < days) {
      salesHistoryCache.set(productId, { daysLoaded: days, sales });
    }
    return sales;
  })();

  salesHistoryPromiseCache.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    salesHistoryPromiseCache.delete(cacheKey);
  }
}
