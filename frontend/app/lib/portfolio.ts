import { supabase } from "./supabase";
import type {
  Portfolio,
  Holding,
  HoldingWithProduct,
  NewHolding,
  UpdateHolding,
  PortfolioSummary,
  HoldingPerformance,
  PortfolioHistoryPoint,
  ProductSearchResult,
} from "../components/Portfolio/types";

// ============================================
// Portfolio CRUD Operations
// ============================================

/**
 * Get the user's portfolio (creates one if doesn't exist)
 */
export async function getOrCreatePortfolio(userId: string): Promise<Portfolio | null> {
  // First try to get existing portfolio
  const { data: existing, error: fetchError } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (existing) {
    return existing as Portfolio;
  }

  // If no portfolio exists and it's not just a "no rows" error, return null
  if (fetchError && fetchError.code !== "PGRST116") {
    console.error("Error fetching portfolio:", fetchError);
    return null;
  }

  // Create a new portfolio
  const { data: newPortfolio, error: createError } = await supabase
    .from("portfolios")
    .insert({ user_id: userId, name: "My Portfolio" })
    .select()
    .single();

  if (createError) {
    console.error("Error creating portfolio:", createError);
    return null;
  }

  return newPortfolio as Portfolio;
}

/**
 * Get portfolio by ID
 */
export async function getPortfolioById(portfolioId: number): Promise<Portfolio | null> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .single();

  if (error) {
    console.error("Error fetching portfolio:", error);
    return null;
  }

  return data as Portfolio;
}

/**
 * Update portfolio name
 */
export async function updatePortfolioName(
  portfolioId: number,
  name: string
): Promise<Portfolio | null> {
  const { data, error } = await supabase
    .from("portfolios")
    .update({ name })
    .eq("id", portfolioId)
    .select()
    .single();

  if (error) {
    console.error("Error updating portfolio:", error);
    return null;
  }

  return data as Portfolio;
}

// ============================================
// Holdings CRUD Operations
// ============================================

/**
 * Get all holdings for a portfolio with product data
 */
export async function getHoldings(portfolioId: number): Promise<HoldingWithProduct[]> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select(`
      id, portfolio_id, product_id, quantity, purchase_price_usd, purchase_date, notes, created_at, updated_at,
      products (
        id, usd_price, image_url, variant, url,
        sets ( id, name, code, release_date, expansion_type, generations ( id, name ) ),
        product_types ( id, name, label )
      )
    `)
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching holdings:", error);
    return [];
  }

  return (data || []) as unknown as HoldingWithProduct[];
}

/**
 * Get a single holding by ID
 */
export async function getHoldingById(holdingId: number): Promise<HoldingWithProduct | null> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select(`
      id, portfolio_id, product_id, quantity, purchase_price_usd, purchase_date, notes, created_at, updated_at,
      products (
        id, usd_price, image_url, variant, url,
        sets ( id, name, code, release_date, expansion_type, generations ( id, name ) ),
        product_types ( id, name, label )
      )
    `)
    .eq("id", holdingId)
    .single();

  if (error) {
    console.error("Error fetching holding:", error);
    return null;
  }

  return data as unknown as HoldingWithProduct;
}

/**
 * Add a new holding to the portfolio
 */
export async function addHolding(holding: NewHolding): Promise<Holding | null> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .insert({
      portfolio_id: holding.portfolio_id,
      product_id: holding.product_id,
      quantity: holding.quantity,
      purchase_price_usd: holding.purchase_price_usd,
      purchase_date: holding.purchase_date,
      notes: holding.notes || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error adding holding:", error);
    return null;
  }

  return data as Holding;
}

/**
 * Update an existing holding
 */
export async function updateHolding(
  holdingId: number,
  updates: UpdateHolding
): Promise<Holding | null> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .update(updates)
    .eq("id", holdingId)
    .select()
    .single();

  if (error) {
    console.error("Error updating holding:", error);
    return null;
  }

  return data as Holding;
}

/**
 * Delete a holding
 */
export async function deleteHolding(holdingId: number): Promise<boolean> {
  const { error } = await supabase
    .from("portfolio_holdings")
    .delete()
    .eq("id", holdingId);

  if (error) {
    console.error("Error deleting holding:", error);
    return false;
  }

  return true;
}

// ============================================
// Analytics & Calculations
// ============================================

/**
 * Calculate portfolio summary metrics
 */
export function calculatePortfolioSummary(holdings: HoldingWithProduct[]): PortfolioSummary {
  let totalCostBasis = 0;
  let totalCurrentValue = 0;
  const productIds = new Set<number>();

  for (const holding of holdings) {
    const costBasis = holding.quantity * holding.purchase_price_usd;
    const currentPrice = holding.products?.usd_price ?? 0;
    const currentValue = holding.quantity * currentPrice;

    totalCostBasis += costBasis;
    totalCurrentValue += currentValue;
    productIds.add(holding.product_id);
  }

  const totalGainLoss = totalCurrentValue - totalCostBasis;
  const totalGainLossPercent = totalCostBasis > 0
    ? (totalGainLoss / totalCostBasis) * 100
    : 0;

  return {
    total_cost_basis: totalCostBasis,
    total_current_value: totalCurrentValue,
    total_gain_loss: totalGainLoss,
    total_gain_loss_percent: totalGainLossPercent,
    holdings_count: holdings.length,
    unique_products_count: productIds.size,
  };
}

/**
 * Calculate performance for a single holding
 */
export function calculateHoldingPerformance(holding: HoldingWithProduct): HoldingPerformance {
  const costBasis = holding.quantity * holding.purchase_price_usd;
  const currentPrice = holding.products?.usd_price ?? 0;
  const currentValue = holding.quantity * currentPrice;
  const gainLoss = currentValue - costBasis;
  const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;

  return {
    holding_id: holding.id,
    cost_basis: costBasis,
    current_value: currentValue,
    gain_loss: gainLoss,
    gain_loss_percent: gainLossPercent,
    purchase_price: holding.purchase_price_usd,
    current_price: currentPrice,
  };
}

/**
 * Get portfolio value history for charting
 */
export async function getPortfolioHistory(
  portfolioId: number,
  days: number
): Promise<PortfolioHistoryPoint[]> {
  // Get holdings
  const holdings = await getHoldings(portfolioId);
  if (holdings.length === 0) return [];

  // Group holdings by product with purchase-date ordering
  const holdingsByProduct = new Map<
    number,
    { entries: Array<{ date: string; quantity: number }>; index: number; quantity: number }
  >();

  for (const holding of holdings) {
    if (!holdingsByProduct.has(holding.product_id)) {
      holdingsByProduct.set(holding.product_id, { entries: [], index: 0, quantity: 0 });
    }
    holdingsByProduct.get(holding.product_id)!.entries.push({
      date: holding.purchase_date,
      quantity: holding.quantity,
    });
  }

  for (const product of holdingsByProduct.values()) {
    product.entries.sort((a, b) => a.date.localeCompare(b.date));
  }

  const productIds = Array.from(holdingsByProduct.keys());

  // Get price history for all products
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: priceHistory, error } = await supabase
    .from("product_price_history")
    .select("product_id, usd_price, recorded_at")
    .in("product_id", productIds)
    .gte("recorded_at", startDate.toISOString())
    .order("recorded_at", { ascending: true });

  if (error || !priceHistory) {
    console.error("Error fetching price history:", error);
    return [];
  }

  const priceHistoryByProduct = new Map<
    number,
    { entries: Array<{ date: string; price: number }>; index: number; price: number }
  >();

  for (const holding of holdings) {
    if (!priceHistoryByProduct.has(holding.product_id)) {
      priceHistoryByProduct.set(holding.product_id, {
        entries: [],
        index: 0,
        price: holding.products?.usd_price ?? 0,
      });
    }
  }

  for (const entry of priceHistory) {
    const date = entry.recorded_at.split("T")[0];
    const productHistory = priceHistoryByProduct.get(entry.product_id);
    if (productHistory) {
      productHistory.entries.push({ date, price: entry.usd_price });
    }
  }

  // Generate date series
  const history: PortfolioHistoryPoint[] = [];
  const today = new Date();

  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    let dailyValue = 0;

    for (const productId of productIds) {
      const holdingData = holdingsByProduct.get(productId);
      const priceData = priceHistoryByProduct.get(productId);

      if (!holdingData || !priceData) continue;

      while (
        holdingData.index < holdingData.entries.length &&
        holdingData.entries[holdingData.index].date <= dateStr
      ) {
        holdingData.quantity += holdingData.entries[holdingData.index].quantity;
        holdingData.index += 1;
      }

      if (holdingData.quantity === 0) {
        continue;
      }

      while (
        priceData.index < priceData.entries.length &&
        priceData.entries[priceData.index].date <= dateStr
      ) {
        priceData.price = priceData.entries[priceData.index].price;
        priceData.index += 1;
      }

      dailyValue += holdingData.quantity * priceData.price;
    }

    history.push({ date: dateStr, value: dailyValue });
  }

  return history;
}

// ============================================
// Product Search
// ============================================

/**
 * Search products for adding to portfolio
 */
export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  if (!query || query.length < 2) return [];

  const { data, error } = await supabase
    .from("products")
    .select(`
      id, usd_price, image_url, variant,
      sets ( name, code ),
      product_types ( name, label )
    `)
    .ilike("variant", `%${query}%`)
    .limit(20);

  if (error) {
    console.error("Error searching products:", error);
    return [];
  }

  return (data || []) as unknown as ProductSearchResult[];
}

/**
 * Search products by set name
 */
export async function searchProductsBySet(setName: string): Promise<ProductSearchResult[]> {
  // First, find sets matching the name
  const { data: setsData, error: setsError } = await supabase
    .from("sets")
    .select("id")
    .ilike("name", `%${setName}%`);

  if (setsError || !setsData || setsData.length === 0) {
    if (setsError) console.error("Error searching sets:", setsError);
    return [];
  }

  const setIds = setsData.map((s) => s.id);

  const { data, error } = await supabase
    .from("products")
    .select(`
      id, usd_price, image_url, variant,
      sets ( name, code ),
      product_types ( name, label )
    `)
    .in("set_id", setIds)
    .limit(50);

  if (error) {
    console.error("Error searching products by set:", error);
    return [];
  }

  return (data || []) as unknown as ProductSearchResult[];
}

/**
 * Get all products (for initial load or dropdown)
 */
export async function getAllProducts(): Promise<ProductSearchResult[]> {
  const { data, error } = await supabase
    .from("products")
    .select(`
      id, usd_price, image_url, variant,
      sets ( name, code ),
      product_types ( name, label )
    `)
    .order("id", { ascending: true });

  if (error) {
    console.error("Error fetching all products:", error);
    return [];
  }

  return (data || []) as unknown as ProductSearchResult[];
}
