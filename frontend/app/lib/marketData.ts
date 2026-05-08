import { ChartTimeframe, PriceHistoryEntry, Product, ProductReturnMetrics } from "../components/ProductPrices/types";

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
