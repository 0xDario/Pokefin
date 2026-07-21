import {
  ChartTimeframe,
  PriceHistoryEntry,
  Product,
  ProductReturnMetrics,
  SalesHistoryEntry,
} from "../components/ProductPrices/types";

export type MarketSummaryRow = {
  id: number;
  usd_price: number | null;
  url: string | null;
  last_updated: string | null;
  variant: string | null;
  image_url: string | null;
  sku: string | null;
  set_id: number | null;
  set_name: string | null;
  set_code: string | null;
  set_release_date: string | null;
  set_expansion_type: string | null;
  generation_id: number | null;
  generation_name: string | null;
  product_type_id: number | null;
  product_type_name: string | null;
  product_type_label: string | null;
  return_1d: number | null;
  return_7d: number | null;
  return_30d: number | null;
  return_90d: number | null;
  return_180d: number | null;
  return_365d: number | null;
};

export type ExchangeRateSnapshot = {
  rate: number;
  date: string | null;
};

export type SetAnalyticsRow = {
  key: string;
  name: string;
  code: string;
  generation: string;
  releaseDate: string | null;
  daysSinceRelease: number | null;
  productCount: number;
  avg30: number | null;
  avg90: number | null;
  avg365: number | null;
  median30: number | null;
  median90: number | null;
  median365: number | null;
  consistency90: number | null;
  consistency365: number | null;
  volatility90: number | null;
  maxDrawdown365: number | null;
  trend90: number | null;
  trend365: number | null;
  pricePerDay: number | null;
  momentumScore: number | null;
  investScore: number | null;
  rank: number | null;
};

export const DEFAULT_EXCHANGE_RATE = 1.36;

const TIMEFRAME_TO_DAYS: Record<ChartTimeframe, number> = {
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
};

export function getDaysForTimeframe(timeframe: ChartTimeframe): number {
  return TIMEFRAME_TO_DAYS[timeframe];
}

export function getHistoryStartDate(timeframe: ChartTimeframe): string {
  const now = new Date();
  const startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - getDaysForTimeframe(timeframe) - 2
  );
  return startDate.toISOString().split("T")[0];
}

export type VolumeSeriesPoint = {
  date: string;
  volume: number;
  isWeekly: boolean;
};

// Timeframes covering at most this many days render one volume bar per day
// (7D and 1M); longer timeframes aggregate into Monday-start weekly buckets.
// The scraper only maintains ~30 trailing daily buckets, so a daily-only 3M
// chart would render its first ~60 days as zero even though backfilled
// weekly rows cover them — 3M and up must take the weekly merge path.
const DAILY_VOLUME_MAX_DAYS = 35;

function toLocalDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Date-only strings must be parsed via split, never new Date("YYYY-MM-DD"),
// which is UTC midnight and shifts a day in negative-offset timezones.
function parseLocalDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getMondayOfWeek(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // 0 for Monday, 6 for Sunday
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

/**
 * Build a zero-filled sales-volume series aligned to the chart's local-date
 * calendar. Short timeframes (<= 92 days) get one point per day from
 * granularity='day' rows; longer timeframes get Monday-week-start buckets
 * that prefer summed day rows and fall back to the TCGPlayer 'week' row
 * (whose bucket_dates are Mondays). Volume is never forward-filled.
 */
export function buildVolumeSeries(
  sales: SalesHistoryEntry[],
  timeframe: ChartTimeframe,
  referenceDate: Date = new Date()
): VolumeSeriesPoint[] {
  const days = getDaysForTimeframe(timeframe);
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const startDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - days + 1
  );

  if (days <= DAILY_VOLUME_MAX_DAYS) {
    const startKey = toLocalDateKey(startDate);
    const endKey = toLocalDateKey(today);

    const volumeByDay = new Map<string, number>();
    for (const entry of sales) {
      if (entry.granularity !== "day") continue;
      if (entry.bucket_date < startKey || entry.bucket_date > endKey) continue;
      volumeByDay.set(
        entry.bucket_date,
        (volumeByDay.get(entry.bucket_date) ?? 0) + (entry.quantity_sold ?? 0)
      );
    }

    const result: VolumeSeriesPoint[] = [];
    const cursor = new Date(startDate);
    while (cursor <= today) {
      const key = toLocalDateKey(cursor);
      result.push({
        date: key,
        volume: volumeByDay.get(key) ?? 0,
        isWeekly: false,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  const firstMonday = getMondayOfWeek(startDate);
  const lastMonday = getMondayOfWeek(today);
  const firstMondayKey = toLocalDateKey(firstMonday);
  const lastMondayKey = toLocalDateKey(lastMonday);

  const daySumByWeek = new Map<string, number>();
  const weekRowByWeek = new Map<string, number>();
  for (const entry of sales) {
    const weekKey = toLocalDateKey(
      getMondayOfWeek(parseLocalDateKey(entry.bucket_date))
    );
    if (weekKey < firstMondayKey || weekKey > lastMondayKey) continue;
    if (entry.granularity === "day") {
      daySumByWeek.set(
        weekKey,
        (daySumByWeek.get(weekKey) ?? 0) + (entry.quantity_sold ?? 0)
      );
    } else if (!weekRowByWeek.has(weekKey)) {
      weekRowByWeek.set(weekKey, entry.quantity_sold ?? 0);
    }
  }

  const result: VolumeSeriesPoint[] = [];
  const cursor = new Date(firstMonday);
  while (cursor <= lastMonday) {
    const key = toLocalDateKey(cursor);
    const daySum = daySumByWeek.get(key);
    const weekRow = weekRowByWeek.get(key);
    // Day rows only cover ~30 trailing days, so the week at the edge of daily
    // coverage has a partial day sum alongside a complete week row — take the
    // larger of the two rather than letting a partial sum shadow the full week.
    const volume =
      daySum !== undefined && weekRow !== undefined
        ? Math.max(daySum, weekRow)
        : daySum ?? weekRow ?? 0;
    result.push({
      // The first Monday can precede the chart window; clamp it to the window
      // start so the calendar merge in PriceChart doesn't drop the bucket.
      date: cursor < startDate ? toLocalDateKey(startDate) : key,
      volume,
      isWeekly: true,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return result;
}

export function buildProductReturnMetrics(
  row: Pick<
    MarketSummaryRow,
    | "return_1d"
    | "return_7d"
    | "return_30d"
    | "return_90d"
    | "return_180d"
    | "return_365d"
  >
): ProductReturnMetrics {
  return {
    "1D": row.return_1d,
    "7D": row.return_7d,
    "1M": row.return_30d,
    "3M": row.return_90d,
    "6M": row.return_180d,
    "1Y": row.return_365d,
  };
}

export function mapMarketSummaryRowToProduct(row: MarketSummaryRow): Product {
  return {
    id: row.id,
    usd_price: typeof row.usd_price === "number" ? row.usd_price : 0,
    url: row.url ?? "",
    last_updated: row.last_updated ?? "",
    variant: row.variant,
    image_url: row.image_url,
    sku: row.sku,
    sets: row.set_id
      ? {
          id: row.set_id,
          name: row.set_name ?? "Unknown Set",
          code: row.set_code ?? "N/A",
          release_date: row.set_release_date ?? "",
          expansion_type: row.set_expansion_type ?? undefined,
          generation_id: row.generation_id ?? 0,
          generations: row.generation_id
            ? {
                id: row.generation_id,
                name: row.generation_name ?? "Unknown",
              }
            : undefined,
        }
      : null,
    product_types: row.product_type_id
      ? {
          id: row.product_type_id,
          name: row.product_type_name ?? "unknown",
          label: row.product_type_label ?? undefined,
        }
      : null,
    returns: buildProductReturnMetrics(row),
  } as Product;
}

export function mapProductsQueryResultToProducts(data: any[]): Product[] {
  return data.map((item: any) => ({
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
    returns: null,
  }));
}

export function groupHistoryRowsByProduct(
  rows: Array<{ product_id: number; usd_price: number; recorded_at: string }>
): Record<number, PriceHistoryEntry[]> {
  const historyByProduct: Record<number, PriceHistoryEntry[]> = {};

  for (const entry of rows) {
    if (!historyByProduct[entry.product_id]) {
      historyByProduct[entry.product_id] = [];
    }
    historyByProduct[entry.product_id].push({
      usd_price: entry.usd_price,
      recorded_at: entry.recorded_at,
    });
  }

  for (const productId of Object.keys(historyByProduct)) {
    historyByProduct[Number(productId)].sort(
      (a, b) =>
        new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );
  }

  return historyByProduct;
}
