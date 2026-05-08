"use client";

import { ChartTimeframe, PriceHistoryEntry, Product } from "../components/ProductPrices/types";
import {
  getDaysForTimeframe,
  getHistoryStartDate,
  groupHistoryRowsByProduct,
  mapMarketSummaryRowToProduct,
  mapProductsQueryResultToProducts,
  MarketSummaryRow,
} from "./marketData";
import { supabase } from "./supabase";

let marketProductsCache: Product[] | null = null;
let marketProductsPromise: Promise<Product[]> | null = null;

const productHistoryCache = new Map<number, { daysLoaded: number; history: PriceHistoryEntry[] }>();
const productHistoryPromiseCache = new Map<string, Promise<PriceHistoryEntry[]>>();

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
