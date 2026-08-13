// Core types for ProductPrices components

export type Currency = "USD" | "CAD";
export type ChartTimeframe = "7D" | "1M" | "3M" | "6M" | "1Y";
export type ViewMode = "flat" | "grouped" | "type_grouped";
export type SortBy = "release_date" | "price";
export type SortDirection = "asc" | "desc";

export interface PriceHistoryEntry {
  usd_price: number;
  recorded_at: string;
}

export interface SalesHistoryEntry {
  bucket_date: string;
  granularity: "day" | "week";
  quantity_sold: number | null;
  transaction_count: number | null;
  low_sale_price: number | null;
  high_sale_price: number | null;
  market_price: number | null;
}

export interface ProductVolumeMetrics {
  product_id: number;
  units_sold_7d: number | null;
  units_sold_30d: number | null;
  units_sold_prior_30d: number | null;
  transaction_count_30d: number | null;
  active_listings: number | null;
  total_quantity_available: number | null;
  lowest_listing_price: number | null;
  listings_snapshot_date: string | null;
}

export interface ProductReturnMetrics {
  "1D": number | null;
  "7D": number | null;
  "1M": number | null;
  "3M": number | null;
  "6M": number | null;
  "1Y": number | null;
}

export interface Product {
  id: number;
  // Null means "no current price", not "free": either nothing was ever
  // scraped, or the newest product_price_history row is past
  // PRICE_STALENESS_TOLERANCE_DAYS and the guard in marketPulse.ts withheld
  // it. Render it as "--", never as a number.
  usd_price: number | null;
  url: string;
  // When the price above was last recorded. Kept even when usd_price was
  // withheld, so a caller can still say when the product was last priced —
  // same reasoning as listings_snapshot_date surviving the listings guard.
  price_recorded_at?: string | null;
  last_updated: string;
  variant?: string | null;
  image_url?: string | null;
  sku?: string | null;
  sets?: {
    id?: number;
    name: string;
    code: string;
    release_date: string;
    expansion_type?: string;
    generation_id?: number;
    generations?: {
      id: number;
      name: string;
    };
  } | null;
  product_types?: {
    id: number;
    name: string;
    label?: string;
  } | null;
  returns?: ProductReturnMetrics | null;
}

export interface Generation {
  id: number;
  name: string;
}

export interface ProductSet {
  id: number;
  name: string;
  code: string;
  release_date: string;
  expansion_type?: string;
  generation_id: number;
  generations?: Generation;
}

export interface ProductType {
  id: number;
  name: string;
  label?: string;
}

export interface ReturnData {
  value: number | null;
  isPositive: boolean;
  displayText: string;
}
