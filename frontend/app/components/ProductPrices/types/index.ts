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
  usd_price: number;
  url: string;
  last_updated: string;
  variant?: string | null;
  image_url?: string | null;
  sku?: string | null;
  sets?: {
    name: string;
    code: string;
    release_date: string;
    expansion_type?: string;
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
