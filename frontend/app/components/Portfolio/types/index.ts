// Core types for Portfolio components

export interface Portfolio {
  id: number;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Holding {
  id: number;
  portfolio_id: number;
  product_id: number;
  quantity: number;
  purchase_price_usd: number;
  purchase_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortfolioLot {
  id: number;
  holding_id: number;
  quantity: number;
  purchase_price_usd: number;
  purchase_date: string;
  notes: string | null;
  created_at: string;
}

// Product data joined with holding
export interface HoldingProduct {
  id: number;
  usd_price: number | null;
  image_url: string | null;
  variant: string | null;
  url: string;
  sets: {
    id: number;
    name: string;
    code: string;
    release_date: string | null;
    expansion_type: string | null;
    generations: {
      id: number;
      name: string;
    } | null;
  } | null;
  product_types: {
    id: number;
    name: string;
    label: string | null;
  } | null;
}

// Joined holding with product data for display
export interface HoldingWithProduct extends Holding {
  products: HoldingProduct;
}

// New holding creation data
export interface NewHolding {
  portfolio_id: number;
  product_id: number;
  quantity: number;
  purchase_price_usd: number;
  purchase_date: string;
  notes?: string | null;
}

// Holding update data
export interface UpdateHolding {
  quantity?: number;
  purchase_price_usd?: number;
  purchase_date?: string;
  notes?: string | null;
}

// Portfolio summary metrics
export interface PortfolioSummary {
  total_cost_basis: number;
  total_current_value: number;
  total_gain_loss: number;
  total_gain_loss_percent: number;
  holdings_count: number;
  unique_products_count: number;
}

// Individual holding performance metrics
export interface HoldingPerformance {
  holding_id: number;
  cost_basis: number;
  current_value: number;
  gain_loss: number;
  gain_loss_percent: number;
  purchase_price: number;
  current_price: number;
}

// Historical portfolio value point
export interface PortfolioHistoryPoint {
  date: string;
  value: number;
}

// Allocation breakdown
export interface AllocationItem {
  name: string;
  value: number;
  percentage: number;
  color?: string;
}

// Chart timeframe options
export type PortfolioTimeframe = "7D" | "30D" | "90D" | "ALL";

// Sort options for holdings
export type HoldingSortBy = "name" | "value" | "gain_loss" | "gain_loss_percent" | "purchase_date";
export type HoldingSortDirection = "asc" | "desc";

// Product search result for adding holdings
export interface ProductSearchResult {
  id: number;
  usd_price: number | null;
  image_url: string | null;
  variant: string | null;
  sets: {
    name: string;
    code: string;
  } | null;
  product_types: {
    name: string;
    label: string | null;
  } | null;
}

// Collectr CSV Import types
export interface CollectrCSVRow {
  portfolioName: string;
  category: string;
  set: string;
  productName: string;
  cardNumber: string;
  rarity: string;
  variance: string;
  grade: string;
  cardCondition: string;
  averageCostPaid: number;
  quantity: number;
  marketPrice: number;
  priceOverride: number;
  watchlist: boolean;
  dateAdded: string;
  notes: string;
}

export interface ImportMatchResult {
  csvRow: CollectrCSVRow;
  matchedProduct: ProductSearchResult | null;
  matchConfidence: "exact" | "high" | "low" | "none";
  importStatus: "pending" | "imported" | "skipped" | "error";
  unmatchedReason?: string;
  errorMessage?: string;
}

export interface ImportSummary {
  total: number;
  matched: number;
  unmatched: number;
  imported: number;
  skipped: number;
  errors: number;
}
