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
import {
  getFreshUsdPrice,
  PRICE_STALENESS_TOLERANCE_DAYS,
  utcMidnightMs,
} from "./marketPulse";
import { logCaughtError, logSupabaseError } from "./logger";
import { supabase } from "./supabase";

/**
 * How long a fetched market-products array may be reused.
 *
 * It used to be reused for the whole browser session. That was tolerable when
 * every consumer just displayed a price, but these products now carry a
 * freshness verdict decided at fetch time: usd_price is already nulled, or
 * not, according to how old price_recorded_at was when the RPC ran. A
 * long-lived tab therefore kept computing box NAV — and its buy/hold/avoid
 * verdict — from a price that had since changed or crossed the 14-day cutoff,
 * with no way to notice. An hour matches the server-side
 * getCachedMarketProductSummaries revalidate, so both halves of the app age
 * their view of the catalog at the same rate.
 */
const MARKET_PRODUCTS_TTL_MS = 60 * 60 * 1000;

let marketProductsCache: Product[] | null = null;
let marketProductsCachedAt = 0;
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

const FRESHNESS_PAGE_SIZE = 1000;
const FRESHNESS_MAX_PAGES = 30;

/**
 * product_id -> newest recorded_at inside the staleness tolerance. Products
 * absent from the map have no current price.
 *
 * Paged, because PostgREST caps a response at 1000 rows and the whole-catalog
 * form of this query wants roughly 306 products x 14 days. Unpaged it would
 * return the first thousand and leave every other product looking stale —
 * which is the failure this guard exists to avoid, arrived at from the other
 * direction. Ordering breaks ties on id so a row cannot repeat or vanish
 * across a page boundary.
 *
 * Pass productIds to scope it; omit for the whole active catalog.
 */
export async function fetchNewestPricedAtClient(
  productIds?: number[]
): Promise<Map<number, string>> {
  const newestByProduct = new Map<number, string>();
  if (productIds && productIds.length === 0) return newestByProduct;

  const windowStart = new Date(
    utcMidnightMs() - PRICE_STALENESS_TOLERANCE_DAYS * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .split("T")[0];

  for (let page = 0; page < FRESHNESS_MAX_PAGES; page++) {
    const from = page * FRESHNESS_PAGE_SIZE;
    let query = supabase
      .from("product_price_history")
      .select("product_id, recorded_at")
      .gte("recorded_at", windowStart);
    if (productIds) query = query.in("product_id", productIds);

    const { data, error } = await query
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + FRESHNESS_PAGE_SIZE - 1);

    if (error) {
      // Fail closed: a partial read would mark real products stale, so throw
      // away what we have rather than publish a verdict built on half the data.
      logSupabaseError("client_price_freshness_failed", error);
      return new Map();
    }
    if (!data || data.length === 0) return newestByProduct;

    for (const row of data as Array<{
      product_id: number;
      recorded_at: string;
    }>) {
      const current = newestByProduct.get(row.product_id);
      if (current === undefined || row.recorded_at > current) {
        newestByProduct.set(row.product_id, row.recorded_at);
      }
    }

    if (data.length < FRESHNESS_PAGE_SIZE) return newestByProduct;
  }

  logCaughtError(
    "client_price_freshness_page_cap_reached",
    new Error("Freshness window exceeded the page cap; verdicts may be wrong.")
  );
  return newestByProduct;
}

/**
 * Used when the summaries RPC is missing. It reads the products table
 * directly, so nothing has applied the freshness guard for it — and unlike
 * mapMarketSummaryRowToProduct, which passes a price through when the RPC
 * predates migration 0023 because there is genuinely no signal to judge by,
 * here the signal is one query away. Its server-side twin,
 * fetchProductsWithFallbackReturns, is guarded; this one was the last read
 * path in the frontend that rendered raw products.usd_price.
 */
async function fetchProductsFallback(): Promise<Product[]> {
  const [{ data, error }, newestPricedAt] = await Promise.all([
    supabase
      .from("products")
      .select(
        `id, usd_price, last_updated, url, image_url, variant, sku,
         sets ( id, name, code, release_date, generation_id, expansion_type, generations!inner ( id, name ) ),
         product_types ( id, name, label )`
      )
      .eq("active", true)
      .order("last_updated", { ascending: false }),
    fetchNewestPricedAtClient(),
  ]);

  if (error) {
    throw error;
  }

  return mapProductsQueryResultToProducts(data || []).map((product) => {
    const priceRecordedAt = newestPricedAt.get(product.id) ?? null;
    return {
      ...product,
      usd_price: getFreshUsdPrice(product.usd_price, priceRecordedAt),
      price_recorded_at: priceRecordedAt,
    };
  });
}

export async function fetchMarketProductsClient(): Promise<Product[]> {
  if (
    marketProductsCache &&
    Date.now() - marketProductsCachedAt < MARKET_PRODUCTS_TTL_MS
  ) {
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
        marketProductsCachedAt = Date.now();
        return fallbackProducts;
      }

      const products = ((data || []) as MarketSummaryRow[]).map(
        mapMarketSummaryRowToProduct
      );
      marketProductsCache = products;
      marketProductsCachedAt = Date.now();
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
