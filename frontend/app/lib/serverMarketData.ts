import "server-only";

import { unstable_cache } from "next/cache";
import {
  PriceHistoryEntry,
  Product,
} from "../components/ProductPrices/types";
import {
  DEFAULT_EXCHANGE_RATE,
  ExchangeRateSnapshot,
  groupHistoryRowsByProduct,
  mapMarketSummaryRowToProduct,
  mapProductsQueryResultToProducts,
  MarketSummaryRow,
  SetAnalyticsRow,
} from "./marketData";
import { createServerSupabaseClient } from "./serverSupabase";

const DAY_MS = 24 * 60 * 60 * 1000;

type FallbackSetStats = Omit<SetAnalyticsRow, "investScore" | "rank">;

function getReleaseMs(releaseDate?: string | null) {
  if (!releaseDate) return null;
  const dateKey = releaseDate.split("T")[0].split(" ")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function getReturnPercent(
  history: PriceHistoryEntry[] | undefined,
  days: number
): number | null {
  if (!history || history.length < 2) return null;

  const latestEntry = history[history.length - 1];
  const latestEntryDate = new Date(latestEntry.recorded_at);
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - days);

  if (latestEntryDate <= targetDate) return null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entryDate = new Date(history[i].recorded_at);
    if (entryDate <= targetDate) {
      const pastPrice = history[i].usd_price;
      if (pastPrice === 0) return null;
      return ((latestEntry.usd_price - pastPrice) / pastPrice) * 100;
    }
  }

  return null;
}

function buildDailySeries(
  history: PriceHistoryEntry[] | undefined,
  maxDays?: number
) {
  if (!history || history.length === 0) return [];

  const map = new Map<string, number>();
  for (const entry of history) {
    const dateKey = new Date(entry.recorded_at).toISOString().split("T")[0];
    if (!map.has(dateKey)) {
      map.set(dateKey, entry.usd_price);
    }
  }

  const points = Array.from(map.entries())
    .map(([dateKey, price]) => ({ dateKey, price }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  return maxDays && points.length > maxDays ? points.slice(-maxDays) : points;
}

function getVolatility(points: Array<{ dateKey: string; price: number }>) {
  if (points.length < 3) return null;

  const changes: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1].price;
    if (previous === 0) continue;
    changes.push(((points[i].price - previous) / previous) * 100);
  }

  if (changes.length < 2) return null;

  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const variance =
    changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    changes.length;

  return Math.sqrt(variance);
}

function getMaxDrawdown(points: Array<{ dateKey: string; price: number }>) {
  if (points.length < 2) return null;
  let peak = points[0].price;
  let maxDrawdown = 0;

  for (const point of points) {
    if (point.price > peak) {
      peak = point.price;
      continue;
    }

    const drawdown = ((point.price - peak) / peak) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return Math.abs(maxDrawdown);
}

function getTrendSlope(points: Array<{ dateKey: string; price: number }>) {
  if (points.length < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const n = points.length;

  for (let i = 0; i < n; i += 1) {
    const y = points[i].price;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const meanPrice = sumY / n;
  if (meanPrice === 0) return null;

  return (slope / meanPrice) * 100;
}

function getAverage(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getMedian(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function getConsistency(values: number[]) {
  if (values.length === 0) return null;
  return (values.filter((value) => value > 0).length / values.length) * 100;
}

function computeZScore(value: number | null, mean: number, std: number) {
  if (value === null || std === 0) return 0;
  return (value - mean) / std;
}

async function fetchSetAnalyticsFallback(): Promise<SetAnalyticsRow[]> {
  const supabase = createServerSupabaseClient();
  const products = await getCachedMarketProductSummaries();
  if (products.length === 0) return [];

  const productIds = products.map((product) => product.id);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 367);
  const startDateStr = startDate.toISOString().split("T")[0];

  const PAGE_SIZE = 1000;
  const allRows: Array<{
    product_id: number;
    usd_price: number;
    recorded_at: string;
  }> = [];

  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("product_price_history")
      .select("product_id, usd_price, recorded_at")
      .in("product_id", productIds)
      .gte("recorded_at", startDateStr)
      .order("recorded_at", { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...data);
    if (data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  const priceHistory = groupHistoryRowsByProduct(allRows);
  const setMap = new Map<
    string,
    {
      name: string;
      code: string;
      generation: string;
      releaseDate: string | null;
      productCount: number;
      returns30: number[];
      returns90: number[];
      returns365: number[];
      vol90: number[];
      drawdown365: number[];
      trend90: number[];
      trend365: number[];
      pricePerDay: number[];
    }
  >();

  for (const product of products) {
    const set = product.sets;
    if (!set) continue;

    const key = `${set.code || "unknown"}:${set.name || "Unknown Set"}`;
    if (!setMap.has(key)) {
      setMap.set(key, {
        name: set.name || "Unknown Set",
        code: set.code || "N/A",
        generation: set.generations?.name || "Unknown",
        releaseDate: set.release_date || null,
        productCount: 0,
        returns30: [],
        returns90: [],
        returns365: [],
        vol90: [],
        drawdown365: [],
        trend90: [],
        trend365: [],
        pricePerDay: [],
      });
    }

    const entry = setMap.get(key)!;
    entry.productCount += 1;

    const history = priceHistory[product.id];
    const ret30 = getReturnPercent(history, 30);
    const ret90 = getReturnPercent(history, 90);
    const ret365 = getReturnPercent(history, 365);
    if (ret30 !== null) entry.returns30.push(ret30);
    if (ret90 !== null) entry.returns90.push(ret90);
    if (ret365 !== null) entry.returns365.push(ret365);

    const series90 = buildDailySeries(history, 90);
    const series365 = buildDailySeries(history, 365);
    const volatility90 = getVolatility(series90);
    const maxDrawdown365 = getMaxDrawdown(series365);
    const trend90 = getTrendSlope(series90);
    const trend365 = getTrendSlope(series365);

    if (volatility90 !== null) entry.vol90.push(volatility90);
    if (maxDrawdown365 !== null) entry.drawdown365.push(maxDrawdown365);
    if (trend90 !== null) entry.trend90.push(trend90);
    if (trend365 !== null) entry.trend365.push(trend365);

    const releaseMs = getReleaseMs(set.release_date);
    if (
      releaseMs !== null &&
      typeof product.usd_price === "number" &&
      product.usd_price > 0
    ) {
      const today = new Date();
      const todayUtcMs = Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate()
      );
      const daysSinceRelease = Math.max(
        0,
        Math.floor((todayUtcMs - releaseMs) / DAY_MS)
      );
      if (daysSinceRelease > 0) {
        entry.pricePerDay.push(product.usd_price / daysSinceRelease);
      }
    }
  }

  const today = new Date();
  const todayUtcMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  const setStats: FallbackSetStats[] = Array.from(setMap.entries()).map(
    ([key, entry]) => {
      const releaseMs = getReleaseMs(entry.releaseDate);
      const daysSinceRelease =
        releaseMs === null
          ? null
          : Math.max(0, Math.floor((todayUtcMs - releaseMs) / DAY_MS));

      const avg30 = getAverage(entry.returns30);
      const avg90 = getAverage(entry.returns90);
      const avg365 = getAverage(entry.returns365);

      return {
        key,
        name: entry.name,
        code: entry.code,
        generation: entry.generation,
        releaseDate: entry.releaseDate,
        daysSinceRelease,
        productCount: entry.productCount,
        avg30,
        avg90,
        avg365,
        median30: getMedian(entry.returns30),
        median90: getMedian(entry.returns90),
        median365: getMedian(entry.returns365),
        consistency90: getConsistency(entry.returns90),
        consistency365: getConsistency(entry.returns365),
        volatility90: getAverage(entry.vol90),
        maxDrawdown365: getAverage(entry.drawdown365),
        trend90: getAverage(entry.trend90),
        trend365: getAverage(entry.trend365),
        pricePerDay: getAverage(entry.pricePerDay),
        momentumScore:
          avg90 !== null || avg30 !== null || avg365 !== null
            ? (avg90 ?? 0) * 0.5 + (avg30 ?? 0) * 0.3 + (avg365 ?? 0) * 0.2
            : null,
      };
    }
  );

  const metrics = {
    avg30: { mean: 0, std: 0 },
    avg90: { mean: 0, std: 0 },
    avg365: { mean: 0, std: 0 },
    consistency90: { mean: 0, std: 0 },
    consistency365: { mean: 0, std: 0 },
    trend90: { mean: 0, std: 0 },
    trend365: { mean: 0, std: 0 },
    volatility90: { mean: 0, std: 0 },
    maxDrawdown365: { mean: 0, std: 0 },
  };

  (Object.keys(metrics) as Array<keyof typeof metrics>).forEach((key) => {
    const values = setStats
      .map((set) => set[key])
      .filter((value): value is number => value !== null);

    if (values.length === 0) return;

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      values.length;
    metrics[key] = { mean, std: Math.sqrt(variance) };
  });

  const scored = setStats
    .map((set) => {
      const investScore =
        computeZScore(set.avg30, metrics.avg30.mean, metrics.avg30.std) * 0.2 +
        computeZScore(set.avg90, metrics.avg90.mean, metrics.avg90.std) * 0.4 +
        computeZScore(set.avg365, metrics.avg365.mean, metrics.avg365.std) * 0.2 +
        computeZScore(
          set.consistency90,
          metrics.consistency90.mean,
          metrics.consistency90.std
        ) * 0.15 +
        computeZScore(
          set.consistency365,
          metrics.consistency365.mean,
          metrics.consistency365.std
        ) * 0.1 +
        computeZScore(set.trend90, metrics.trend90.mean, metrics.trend90.std) * 0.1 +
        computeZScore(set.trend365, metrics.trend365.mean, metrics.trend365.std) * 0.05 -
        computeZScore(
          set.volatility90,
          metrics.volatility90.mean,
          metrics.volatility90.std
        ) * 0.2 -
        computeZScore(
          set.maxDrawdown365,
          metrics.maxDrawdown365.mean,
          metrics.maxDrawdown365.std
        ) * 0.15;

      return {
        ...set,
        investScore,
      };
    })
    .sort((a, b) => b.investScore - a.investScore)
    .map((set, index) => ({
      ...set,
      rank: index + 1,
    }));

  return scored;
}

async function fetchLatestExchangeRate(): Promise<ExchangeRateSnapshot> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("usd_to_cad, recorded_at")
    .order("recorded_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return { rate: DEFAULT_EXCHANGE_RATE, date: null };
  }

  return {
    rate: data.usd_to_cad,
    date: data.recorded_at ?? null,
  };
}

async function fetchProductsWithFallbackReturns(): Promise<Product[]> {
  const supabase = createServerSupabaseClient();
  const { data: fallbackData, error: fallbackError } = await supabase
    .from("products")
    .select(
      `id, usd_price, last_updated, url, image_url, variant, sku,
       sets ( id, name, code, release_date, generation_id, expansion_type, generations!inner ( id, name ) ),
       product_types ( id, name, label )`
    )
    .eq("active", true)
    .order("last_updated", { ascending: false });

  if (fallbackError) {
    throw fallbackError;
  }

  const products = mapProductsQueryResultToProducts(fallbackData || []);
  if (products.length === 0) {
    return products;
  }

  const productIds = products.map((product) => product.id);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 367);
  const startDateStr = startDate.toISOString().split("T")[0];

  const PAGE_SIZE = 1000;
  const allRows: Array<{
    product_id: number;
    usd_price: number;
    recorded_at: string;
  }> = [];

  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("product_price_history")
      .select("product_id, usd_price, recorded_at")
      .in("product_id", productIds)
      .gte("recorded_at", startDateStr)
      .order("recorded_at", { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...data);
    if (data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  const historyByProduct = groupHistoryRowsByProduct(allRows);

  return products.map((product) => ({
    ...product,
    returns: {
      "1D": getReturnPercent(historyByProduct[product.id], 1),
      "7D": getReturnPercent(historyByProduct[product.id], 7),
      "1M": getReturnPercent(historyByProduct[product.id], 30),
      "3M": getReturnPercent(historyByProduct[product.id], 90),
      "6M": getReturnPercent(historyByProduct[product.id], 180),
      "1Y": getReturnPercent(historyByProduct[product.id], 365),
    },
  }));
}

async function fetchMarketProductSummaries(): Promise<Product[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_market_product_summaries");

  if (!error && data) {
    return ((data || []) as MarketSummaryRow[]).map(mapMarketSummaryRowToProduct);
  }

  return fetchProductsWithFallbackReturns();
}

async function fetchSetAnalytics(): Promise<SetAnalyticsRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_set_analytics");

  if (error) {
    console.error("[serverMarketData] get_set_analytics failed:", error);
    return fetchSetAnalyticsFallback();
  }

  return ((data || []) as any[]).map((row) => ({
    key: row.key,
    name: row.name,
    code: row.code,
    generation: row.generation,
    releaseDate: row.release_date ?? null,
    daysSinceRelease: row.days_since_release ?? null,
    productCount: row.product_count,
    avg30: row.avg30 ?? null,
    avg90: row.avg90 ?? null,
    avg365: row.avg365 ?? null,
    median30: row.median30 ?? null,
    median90: row.median90 ?? null,
    median365: row.median365 ?? null,
    consistency90: row.consistency90 ?? null,
    consistency365: row.consistency365 ?? null,
    volatility90: row.volatility90 ?? null,
    maxDrawdown365: row.max_drawdown365 ?? null,
    trend90: row.trend90 ?? null,
    trend365: row.trend365 ?? null,
    pricePerDay: row.price_per_day ?? null,
    momentumScore: row.momentum_score ?? null,
    investScore: row.invest_score ?? null,
    rank: row.rank ?? null,
  }));
}

export const getCachedExchangeRate = unstable_cache(fetchLatestExchangeRate, ["exchange-rate"], {
  revalidate: 3600,
  tags: ["exchange-rate"],
});

export const getCachedMarketProductSummaries = unstable_cache(
  fetchMarketProductSummaries,
  ["market-product-summaries"],
  {
    revalidate: 3600,
    tags: ["market-products"],
  }
);

export const getCachedSetAnalytics = unstable_cache(fetchSetAnalytics, ["set-analytics"], {
  revalidate: 3600,
  tags: ["set-analytics"],
});
