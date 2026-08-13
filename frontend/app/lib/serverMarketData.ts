import "server-only";

import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import {
  PriceHistoryEntry,
  Product,
  ProductVolumeMetrics,
  SalesHistoryEntry,
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
import {
  getFreshUsdPrice,
  getLatestPriceRecordedAt,
  PRICE_STALENESS_TOLERANCE_DAYS,
  utcMidnightMs,
} from "./marketPulse";
import { logCaughtError, logSupabaseError } from "./logger";
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.invalid";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_KEY || "placeholder-key";

if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_KEY
) {
  // eslint-disable-next-line no-console
  console.warn(
    "[serverMarketData] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_KEY is unset; using placeholders, runtime calls will fail."
  );
}

function createMarketDataSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

type FallbackSetStats = Omit<SetAnalyticsRow, "investScore" | "rank">;

type PriceHistoryRow = {
  product_id: number;
  usd_price: number;
  recorded_at: string;
};

type MarketDataSupabaseClient = ReturnType<
  typeof createMarketDataSupabaseClient
>;

const HISTORY_PAGE_SIZE = 1000;
// Bounded loop - MAX_PAGES * PAGE_SIZE caps the worst-case fetch so a runaway
// query can't tie up a serverless function indefinitely.
const HISTORY_MAX_PAGES = 50;

/**
 * Page through product_price_history for a set of products.
 *
 * The cap is a real ceiling, not a formality: a full year across every active
 * product is comfortably over 100k rows, so the 367-day callers come back
 * short and the rows they do get are the oldest ones. That is survivable for
 * the returns built from them and fatal for a freshness verdict, which is why
 * freshness has its own narrow window — see fetchNewestPricedAt. Truncation is
 * logged either way; silently returning half a history is how this went
 * unnoticed.
 */
async function fetchPriceHistoryPages(
  supabase: MarketDataSupabaseClient,
  productIds: number[],
  startDateStr: string
): Promise<PriceHistoryRow[]> {
  const rows: PriceHistoryRow[] = [];
  let from = 0;

  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const to = from + HISTORY_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("product_price_history")
      .select("product_id, usd_price, recorded_at")
      .in("product_id", productIds)
      .gte("recorded_at", startDateStr)
      .order("recorded_at", { ascending: true })
      // recorded_at alone is not a total order — the scraper writes a batch of
      // rows per tick and they can share a timestamp — so offset paging could
      // repeat or skip a row at a page boundary. A skipped row in
      // fetchNewestPricedAt reads as "this product has no recent history" and
      // withholds a current price.
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return rows;
    }

    rows.push(...data);
    if (data.length < HISTORY_PAGE_SIZE) {
      return rows;
    }

    from += HISTORY_PAGE_SIZE;
  }

  logCaughtError(
    "price_history_page_cap_reached",
    new Error(
      `Stopped at ${rows.length} rows from ${startDateStr}; the tail is missing.`
    )
  );
  return rows;
}

/**
 * product_id -> newest recorded_at, for products priced inside the staleness
 * tolerance. Products absent from the map have no recent price row.
 *
 * Its own query rather than a max() over the paged history above, because that
 * fetch is ordered oldest-first and gets cut off by the page cap: the newest
 * row it can show is months old, which would read as "every product is stale"
 * and blank every price on the site. This window is only
 * PRICE_STALENESS_TOLERANCE_DAYS wide, so it is a few thousand rows and always
 * complete.
 */
async function fetchNewestPricedAt(
  supabase: MarketDataSupabaseClient,
  productIds: number[]
): Promise<Map<number, { recordedAt: string; usdPrice: number | null }>> {
  const windowStart = new Date(
    utcMidnightMs() - PRICE_STALENESS_TOLERANCE_DAYS * DAY_MS
  )
    .toISOString()
    .split("T")[0];

  const rows = await fetchPriceHistoryPages(supabase, productIds, windowStart);

  const newestByProduct = new Map<
    number,
    { recordedAt: string; usdPrice: number | null }
  >();
  for (const row of rows) {
    const current = newestByProduct.get(row.product_id);
    if (current === undefined || row.recorded_at > current.recordedAt) {
      newestByProduct.set(row.product_id, {
        recordedAt: row.recorded_at,
        usdPrice: row.usd_price,
      });
    }
  }
  return newestByProduct;
}

/**
 * The price to publish for a product, or null.
 *
 * Mirrors the gate in migration 0023: the value must be recent AND must still
 * equal the history row that dates it. products.usd_price and the history row
 * are two independent writes in main.py, so a failed update leaves the cached
 * value behind its own timestamp, and a timestamp-only check would publish one
 * event's value under another's date.
 */
function guardedPrice(
  ownPrice: number | null | undefined,
  newest: { recordedAt: string; usdPrice: number | null } | undefined
): { price: number | null; recordedAt: string | null } {
  const recordedAt = newest?.recordedAt ?? null;
  if (newest === undefined || !Object.is(ownPrice ?? null, newest.usdPrice)) {
    return { price: null, recordedAt };
  }
  return { price: getFreshUsdPrice(ownPrice, recordedAt), recordedAt };
}

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
  const supabase = createMarketDataSupabaseClient();
  const products = await getCachedMarketProductSummaries();
  if (products.length === 0) return [];

  const productIds = products.map((product) => product.id);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 367);
  const startDateStr = startDate.toISOString().split("T")[0];

  const [allRows, newestPricedAt] = await Promise.all([
    fetchPriceHistoryPages(supabase, productIds, startDateStr),
    fetchNewestPricedAt(supabase, productIds),
  ]);

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

    // Resolved before the returns, not after: a product with no current price
    // must not contribute one to the set's averages either. Mirrors the gate
    // 0023 puts on get_set_analytics, which this path stands in for.
    const freshPrice = guardedPrice(
      product.usd_price,
      newestPricedAt.get(product.id)
    ).price;

    if (freshPrice !== null) {
      const ret30 = getReturnPercent(history, 30);
      const ret90 = getReturnPercent(history, 90);
      const ret365 = getReturnPercent(history, 365);
      if (ret30 !== null) entry.returns30.push(ret30);
      if (ret90 !== null) entry.returns90.push(ret90);
      if (ret365 !== null) entry.returns365.push(ret365);
    }

    // Volatility, drawdown and trend stay ungated — they come from the
    // recorded daily series and remain true descriptions of it however old
    // its last point is. Same split as the SQL.
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

    // Non-nullness alone was never enough here: a product whose SKU has gone
    // dead keeps its last successful price forever, and averaging that into
    // the set's price/day presents a months-old number as today's. freshPrice
    // comes from the tolerance-window query above, not from `history` — that
    // one is page-capped, and reading its truncation as staleness would empty
    // price/day for every set on the board.
    const releaseMs = getReleaseMs(set.release_date);
    if (releaseMs !== null && freshPrice !== null && freshPrice > 0) {
      const daysSinceRelease = Math.max(
        0,
        Math.floor((utcMidnightMs() - releaseMs) / DAY_MS)
      );
      if (daysSinceRelease > 0) {
        entry.pricePerDay.push(freshPrice / daysSinceRelease);
      }
    }
  }

  const todayUtcMs = utcMidnightMs();

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
      // Mirrors the guard 0023 puts on invest_score: with every return
      // average withheld, computeZScore turns each of them into a 0 —
      // "exactly market average" — and the set would be scored and ranked on
      // the two ungated series metrics alone, landing in the stats page's top
      // sets with no current price behind it.
      if (set.avg30 === null && set.avg90 === null && set.avg365 === null) {
        return { ...set, investScore: null };
      }

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
    // Unscored sets sort last and are left unranked, so "no rank" stays a
    // statement the output actually makes rather than position 64.
    .sort((a, b) => {
      if (a.investScore === null && b.investScore === null) return 0;
      if (a.investScore === null) return 1;
      if (b.investScore === null) return -1;
      return b.investScore - a.investScore;
    })
    .reduce<Array<SetAnalyticsRow>>((rows, set) => {
      rows.push({
        ...set,
        rank: set.investScore === null ? null : rows.length + 1,
      });
      return rows;
    }, []);

  return scored;
}

export type ProductListingsSnapshot = {
  active_listings: number | null;
  total_quantity_available: number | null;
  lowest_listing_price: number | null;
  snapshot_date: string | null;
};

export type ProductDetail = {
  product: Product;
  history: PriceHistoryEntry[];
  salesHistory: SalesHistoryEntry[];
  listings: ProductListingsSnapshot | null;
  siblings: Product[];
};

async function fetchProductDetail(
  productId: number
): Promise<ProductDetail | null> {
  const allProducts = await getCachedMarketProductSummaries();
  const summary = allProducts.find((p) => p.id === productId);
  if (!summary) return null;

  const supabase = createMarketDataSupabaseClient();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 367);
  const startDateStr = startDate.toISOString().split("T")[0];

  // Sales-volume history (both 'day' and 'week' granularities). The tables
  // may not exist yet pre-migration; errors degrade to an empty array.
  const salesStartDate = new Date();
  salesStartDate.setDate(salesStartDate.getDate() - 400);
  const salesStartDateStr = salesStartDate.toISOString().split("T")[0];

  // The three queries have no data dependency on each other, so they run
  // concurrently: a cold product page otherwise pays three serial round trips
  // before any HTML is emitted.
  const [
    { data: historyRows, error },
    { data: salesRows, error: salesError },
    { data: listingsRows, error: listingsError },
  ] = await Promise.all([
    supabase
      .from("product_price_history")
      .select("product_id, usd_price, recorded_at")
      .eq("product_id", productId)
      .gte("recorded_at", startDateStr)
      .order("recorded_at", { ascending: true }),
    supabase
      .from("product_sales_history")
      .select(
        "bucket_date, granularity, quantity_sold, transaction_count, low_sale_price, high_sale_price, market_price"
      )
      .eq("product_id", productId)
      .gte("bucket_date", salesStartDateStr)
      .order("bucket_date", { ascending: true }),
    supabase
      .from("product_listings_history")
      .select(
        "active_listings, total_quantity_available, lowest_listing_price, snapshot_date"
      )
      .eq("product_id", productId)
      .order("snapshot_date", { ascending: false })
      .limit(1),
  ]);

  if (error) {
    logSupabaseError("server_product_history_failed", error);
  }

  const history = groupHistoryRowsByProduct(historyRows || [])[productId] || [];

  // This page has the product's own price history in hand, so it decides
  // freshness from the newest recorded_at directly rather than trusting the
  // summaries RPC to have been migrated — the same reason isListingsSnapshotFresh
  // guards the listings query below instead of relying on the volume RPC.
  // History is fetched 367 days back, so a product last priced before that
  // window has an empty history and is correctly treated as unpriced.
  const priceRecordedAt =
    getLatestPriceRecordedAt(history) ?? summary.price_recorded_at ?? null;
  const freshPrice = getFreshUsdPrice(summary.usd_price, priceRecordedAt);
  const product: Product = {
    ...summary,
    usd_price: freshPrice,
    price_recorded_at: priceRecordedAt,
    // The verdict reached here is stricter than the RPC's, so the returns
    // that came with the summary have to be re-judged against it too.
    // Otherwise this page prints "No current price" above six numeric
    // returns — and priceReturn30d feeds the Market Pulse signal, which
    // could still award "Demand surge" to a product nobody can price.
    returns: freshPrice === null ? null : summary.returns,
  };

  let salesHistory: SalesHistoryEntry[] = [];
  if (salesError) {
    logSupabaseError("server_product_sales_history_failed", salesError);
  } else {
    salesHistory = (salesRows || []) as SalesHistoryEntry[];
  }

  // Latest marketplace listings snapshot; null when missing.
  let listings: ProductListingsSnapshot | null = null;
  if (listingsError) {
    logSupabaseError("server_product_listings_failed", listingsError);
  } else {
    const row = listingsRows?.[0];
    if (row) {
      listings = {
        active_listings: row.active_listings ?? null,
        total_quantity_available: row.total_quantity_available ?? null,
        lowest_listing_price: row.lowest_listing_price ?? null,
        snapshot_date: row.snapshot_date ?? null,
      };
    }
  }

  // Siblings share the same set. Match on set id when present, falling back to
  // code so products from the cached summaries still group correctly.
  const setKey = product.sets?.id ?? product.sets?.code;
  const siblings =
    setKey === undefined || setKey === null
      ? []
      : allProducts.filter(
          (p) =>
            p.id !== productId &&
            (p.sets?.id ?? p.sets?.code) === setKey
        );

  return { product, history, salesHistory, listings, siblings };
}

async function fetchLatestExchangeRate(): Promise<ExchangeRateSnapshot> {
  const supabase = createMarketDataSupabaseClient();
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
  const supabase = createMarketDataSupabaseClient();
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

  const [allRows, newestPricedAt] = await Promise.all([
    fetchPriceHistoryPages(supabase, productIds, startDateStr),
    fetchNewestPricedAt(supabase, productIds),
  ]);

  const historyByProduct = groupHistoryRowsByProduct(allRows);

  return products.map((product) => {
    // The products table has no freshness column, so this path derives it from
    // the tolerance-window query. Not from the year of history paged in above:
    // that fetch is ordered oldest-first and the page cap truncates it well
    // short of today, so every product would look months stale and the whole
    // catalog would render "--".
    const guarded = guardedPrice(product.usd_price, newestPricedAt.get(product.id));
    const priceRecordedAt =
      guarded.recordedAt ?? getLatestPriceRecordedAt(historyByProduct[product.id]);
    const freshPrice = guarded.price;
    const history = historyByProduct[product.id];
    return {
      ...product,
      usd_price: freshPrice,
      price_recorded_at: priceRecordedAt,
      // Returns are withheld with the price, matching the gate 0023 applies
      // to the RPC this path stands in for. getReturnPercent only needs the
      // latest history row to fall inside the window, so a product last
      // priced 15-29 days ago would otherwise report a numeric 1M return
      // beside a blank price — the same "one stale number becomes six" the
      // migration exists to stop.
      returns:
        freshPrice === null
          ? null
          : {
              "1D": getReturnPercent(history, 1),
              "7D": getReturnPercent(history, 7),
              "1M": getReturnPercent(history, 30),
              "3M": getReturnPercent(history, 90),
              "6M": getReturnPercent(history, 180),
              "1Y": getReturnPercent(history, 365),
            },
    };
  });
}

async function fetchMarketProductSummaries(): Promise<Product[]> {
  const supabase = createMarketDataSupabaseClient();
  const { data, error } = await supabase.rpc("get_market_product_summaries");

  if (!error && data) {
    return ((data || []) as MarketSummaryRow[]).map(mapMarketSummaryRowToProduct);
  }

  return fetchProductsWithFallbackReturns();
}

/**
 * Per-product sales-volume metrics keyed by product_id — the server-side twin
 * of fetchVolumeMetrics in clientMarketData. Shipping this in the rendered HTML
 * means market/catalog pages never have to round-trip for it after hydration.
 * Errors — including the RPC not existing yet — degrade to an empty record.
 */
async function fetchVolumeMetrics(): Promise<
  Record<number, ProductVolumeMetrics>
> {
  const supabase = createMarketDataSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_market_product_volume_metrics"
  );

  if (error) {
    logSupabaseError("server_volume_metrics_failed", error);
    return {};
  }

  const byProduct: Record<number, ProductVolumeMetrics> = {};
  for (const row of (data || []) as ProductVolumeMetrics[]) {
    byProduct[row.product_id] = row;
  }
  return byProduct;
}

async function fetchSetAnalytics(): Promise<SetAnalyticsRow[]> {
  const supabase = createMarketDataSupabaseClient();
  const { data, error } = await supabase.rpc("get_set_analytics");

  if (error) {
    logSupabaseError("server_set_analytics_failed", error);
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

export const getCachedVolumeMetrics = unstable_cache(
  fetchVolumeMetrics,
  ["market-volume-metrics"],
  {
    revalidate: 3600,
    tags: ["market-products"],
  }
);

export const getCachedSetAnalytics = unstable_cache(fetchSetAnalytics, ["set-analytics"], {
  revalidate: 3600,
  tags: ["set-analytics"],
});

export const getCachedProductDetail = unstable_cache(
  fetchProductDetail,
  ["product-detail"],
  {
    revalidate: 3600,
    tags: ["market-products"],
  }
);
