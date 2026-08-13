import { supabase } from "./supabase";
import {
  fetchMarketProductsClient,
  fetchNewestPricedAtClient,
  type NewestPricedAt,
} from "./clientMarketData";
import {
  getFreshUsdPrice,
  isPriceFresh,
  PRICE_STALENESS_TOLERANCE_DAYS,
  utcMidnightMs,
} from "./marketPulse";
import { logCaughtError, logSupabaseError } from "./logger";
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

type ProductWithPrice = {
  id: number;
  usd_price: number | null;
  price_recorded_at?: string | null;
};

/**
 * The guarded prices, or null when the freshness source itself is unavailable.
 *
 * Null and an empty map mean different things and callers must not conflate
 * them: null is "no verdict was reached", which fails closed onto "--", while
 * a map that simply lacks a product is a verdict about that product — see
 * pickGuardedPrice.
 */
async function getFreshProductsById(): Promise<Map<
  number,
  ProductWithPrice
> | null> {
  try {
    const products = await fetchMarketProductsClient();
    return new Map(products.map((product) => [product.id, product]));
  } catch (error) {
    // Fail closed: an unavailable freshness source means the price is unknown,
    // not that products.usd_price is safe to present as current.
    logCaughtError("portfolio_fresh_prices_failed", error);
    return null;
  }
}

/**
 * Newest recorded_at inside the staleness tolerance, for products the market
 * summaries do not describe.
 *
 * The summaries cover active products only, so a holding of a deactivated one
 * is absent from that map. Absence is not evidence of staleness — but it is
 * not evidence of freshness either, and `products.usd_price` is
 * last-write-wins, so trusting it would let a deactivated product contribute
 * an indefinitely old value to portfolio totals. Rather than guess in either
 * direction, look the freshness up. Usually a no-op: nothing is queried when
 * every product is in the map, which is the normal case.
 */
async function fetchRecordedAtForMissing(
  productsById: Map<number, ProductWithPrice> | null,
  productIds: number[]
): Promise<Map<number, NewestPricedAt>> {
  if (productsById === null) return new Map();

  const missing = [...new Set(productIds)].filter((id) => !productsById.has(id));
  if (missing.length === 0) return new Map();

  // Scoped to the unmatched ids and shared with the catalog fallback, so the
  // paging and the fail-closed behaviour are defined once.
  return fetchNewestPricedAtClient(missing);
}

/**
 * Resolve one product's price against the freshness map.
 *
 * Three cases, and they mean different things: an absent map is a failed
 * lookup and withholds; a product in the map already carries the server's
 * verdict; a product missing from a map that loaded is judged against the
 * timestamp fetched by fetchRecordedAtForMissing.
 */
function pickGuardedPrice(
  productsById: Map<number, ProductWithPrice> | null,
  missingRecordedAt: Map<number, NewestPricedAt>,
  productId: number,
  ownPrice: number | null | undefined
): { usd_price: number | null; price_recorded_at: string | null } {
  if (productsById === null) {
    return { usd_price: null, price_recorded_at: null };
  }

  const guarded = productsById.get(productId);
  if (guarded === undefined) {
    const newest = missingRecordedAt.get(productId) ?? null;
    const recordedAt = newest?.recordedAt ?? null;
    // The row's own price must still match the value being judged, the same
    // check migration 0023 makes — a timestamp alone can date a value that a
    // failed products update left behind.
    const agrees = newest !== null && Object.is(ownPrice ?? null, newest.usdPrice);
    return {
      usd_price: agrees ? getFreshUsdPrice(ownPrice, recordedAt) : null,
      price_recorded_at: recordedAt,
    };
  }

  return {
    usd_price: guarded.usd_price ?? null,
    price_recorded_at: guarded.price_recorded_at ?? null,
  };
}

async function applyFreshPricesToHoldings(
  holdings: HoldingWithProduct[],
  productsById: Map<number, ProductWithPrice> | null
): Promise<HoldingWithProduct[]> {
  const missingRecordedAt = await fetchRecordedAtForMissing(
    productsById,
    holdings.map((holding) => holding.product_id)
  );
  return holdings.map((holding) => ({
    ...holding,
    products: {
      ...holding.products,
      ...pickGuardedPrice(
        productsById,
        missingRecordedAt,
        holding.product_id,
        holding.products?.usd_price
      ),
    },
  }));
}

async function applyFreshPricesToSearchResults(
  products: ProductSearchResult[],
  productsById: Map<number, ProductWithPrice> | null
): Promise<ProductSearchResult[]> {
  const missingRecordedAt = await fetchRecordedAtForMissing(
    productsById,
    products.map((product) => product.id)
  );
  return products.map((product) => ({
    ...product,
    ...pickGuardedPrice(
      productsById,
      missingRecordedAt,
      product.id,
      product.usd_price
    ),
  }));
}

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
    logSupabaseError("portfolio_fetch_failed", fetchError);
    return null;
  }

  // Create a new portfolio
  const { data: newPortfolio, error: createError } = await supabase
    .from("portfolios")
    .insert({ user_id: userId, name: "My Portfolio" })
    .select()
    .single();

  if (createError) {
    logSupabaseError("portfolio_create_failed", createError);
    return null;
  }

  return newPortfolio as Portfolio;
}

/**
 * Get portfolio by ID. Caller passes userId so we filter by owner
 * server-side as defense-in-depth on top of RLS.
 */
export async function getPortfolioById(
  portfolioId: number,
  userId: string
): Promise<Portfolio | null> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("portfolio_fetch_failed", { code: error.code });
    return null;
  }

  return data as Portfolio | null;
}

/**
 * Update portfolio name. Ownership-checked to defend against
 * accidental RLS regressions.
 */
export async function updatePortfolioName(
  portfolioId: number,
  userId: string,
  name: string
): Promise<Portfolio | null> {
  const { data, error } = await supabase
    .from("portfolios")
    .update({ name })
    .eq("id", portfolioId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("portfolio_update_failed", { code: error.code });
    return null;
  }

  return data as Portfolio | null;
}

// ============================================
// Holdings CRUD Operations
// ============================================

/**
 * Get all holdings for a portfolio with product data
 */
export async function getHoldings(portfolioId: number): Promise<HoldingWithProduct[]> {
  // Both requests are independent, so they go out together — awaiting the
  // freshness map after the holdings query would put a second full round trip
  // in front of first paint.
  const [{ data, error }, productsById] = await Promise.all([
    supabase
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
      .order("created_at", { ascending: false }),
    getFreshProductsById(),
  ]);

  if (error) {
    logSupabaseError("holdings_fetch_failed", error);
    return [];
  }

  const holdings = (data || []) as unknown as HoldingWithProduct[];
  return await applyFreshPricesToHoldings(holdings, productsById);
}

/**
 * Pre-flight ownership check. Returns true if the given holding
 * belongs to a portfolio owned by userId. Used as defense-in-depth
 * on top of RLS for mutations that don't accept a join filter.
 */
async function userOwnsHolding(holdingId: number, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select("id, portfolios!inner(user_id)")
    .eq("id", holdingId)
    .eq("portfolios.user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("ownership_check_failed", { code: error.code });
    return false;
  }
  return data !== null;
}

/**
 * Get a single holding by ID, scoped to the calling user via an
 * inner join on portfolios.user_id.
 */
export async function getHoldingById(
  holdingId: number,
  userId: string
): Promise<HoldingWithProduct | null> {
  const [{ data, error }, productsById] = await Promise.all([
    supabase
      .from("portfolio_holdings")
      .select(`
        id, portfolio_id, product_id, quantity, purchase_price_usd, purchase_date, notes, created_at, updated_at,
        portfolios!inner ( user_id ),
        products (
          id, usd_price, image_url, variant, url,
          sets ( id, name, code, release_date, expansion_type, generations ( id, name ) ),
          product_types ( id, name, label )
        )
      `)
      .eq("id", holdingId)
      .eq("portfolios.user_id", userId)
      .maybeSingle(),
    getFreshProductsById(),
  ]);

  if (error) {
    console.error("holding_fetch_failed", { code: error.code });
    return null;
  }

  if (!data) return null;
  const [holding] = await applyFreshPricesToHoldings(
    [data as unknown as HoldingWithProduct],
    productsById
  );
  return holding;
}

/**
 * Add a new holding to the portfolio. Accepts an idempotency key so
 * a retried submit doesn't double-insert (unique index on
 * (portfolio_id, client_idempotency_key) enforces this in the DB).
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
      client_idempotency_key:
        holding.client_idempotency_key ?? crypto.randomUUID(),
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation; treat as success (idempotent retry).
    if (error.code === "23505") {
      return null;
    }
    console.error("holding_insert_failed", { code: error.code });
    return null;
  }

  return data as Holding;
}

/**
 * Update an existing holding. Caller supplies userId so we can
 * verify ownership server-side before issuing the UPDATE.
 */
export async function updateHolding(
  holdingId: number,
  userId: string,
  updates: UpdateHolding
): Promise<Holding | null> {
  if (!(await userOwnsHolding(holdingId, userId))) return null;

  const { data, error } = await supabase
    .from("portfolio_holdings")
    .update(updates)
    .eq("id", holdingId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("holding_update_failed", { code: error.code });
    return null;
  }

  return data as Holding | null;
}

/**
 * Delete a holding after verifying the caller owns it.
 */
export async function deleteHolding(
  holdingId: number,
  userId: string
): Promise<boolean> {
  if (!(await userOwnsHolding(holdingId, userId))) return false;

  const { error } = await supabase
    .from("portfolio_holdings")
    .delete()
    .eq("id", holdingId);

  if (error) {
    console.error("holding_delete_failed", { code: error.code });
    return false;
  }

  return true;
}

// ============================================
// Analytics & Calculations
// ============================================

type PortfolioPriceHistoryRow = {
  product_id: number;
  usd_price: number;
  recorded_at: string;
};

const PRICE_HISTORY_PAGE_SIZE = 1000;
// A 1Y chart asks for days+14 rows per held product, so 50 pages covered only
// ~132 daily-priced products — reachable, since nothing caps how many holdings
// a portfolio may have. 300 pages covers ~790, past any plausible portfolio,
// and hitting it now FAILS rather than returning the oldest rows as if they
// were all of them.
const PRICE_HISTORY_MAX_PAGES = 300;

/**
 * Every price-history row for these products since `startIso`, paged.
 *
 * PostgREST caps a response at 1000 rows, and this query asks for one row per
 * product per day: 23 held products over a 1Y chart is ~8,200 rows, so a
 * single request returns the oldest 1,000 and silently drops the rest. Ordered
 * ascending, what gets dropped is the recent end — the carried-forward price
 * then fails the freshness check from the truncation point onward and most of
 * the chart reads as unpriced. Ordering breaks ties on id so a row cannot be
 * repeated or skipped across a page boundary.
 */
async function fetchPortfolioPriceHistory(
  productIds: number[],
  startIso: string
): Promise<{
  rows: PortfolioPriceHistoryRow[] | null;
  error: Parameters<typeof logSupabaseError>[1];
}> {
  const rows: PortfolioPriceHistoryRow[] = [];

  for (let page = 0; page < PRICE_HISTORY_MAX_PAGES; page++) {
    const from = page * PRICE_HISTORY_PAGE_SIZE;
    const { data, error } = await supabase
      .from("product_price_history")
      .select("product_id, usd_price, recorded_at")
      .in("product_id", productIds)
      .gte("recorded_at", startIso)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PRICE_HISTORY_PAGE_SIZE - 1);

    if (error) return { rows: null, error };
    if (!data || data.length === 0) return { rows, error: null };

    rows.push(...(data as PortfolioPriceHistoryRow[]));
    if (data.length < PRICE_HISTORY_PAGE_SIZE) return { rows, error: null };
  }

  // Fail closed. Ordered ascending, a truncated read is missing exactly the
  // NEWEST rows, so every carried-forward price expires and the recent chart
  // reads as unpriced — a wrong chart presented as a complete one. An empty
  // chart is the honest answer to "we could not read your history".
  const capError = new Error(
    `Stopped at ${rows.length} rows; the newest history is missing.`
  );
  logCaughtError("portfolio_price_history_page_cap_reached", capError);
  return { rows: null, error: capError };
}

/**
 * Calculate portfolio summary metrics.
 *
 * Unpriced holdings are excluded from the valuation and counted, rather than
 * collapsing the whole portfolio to "unknown": one dead SKU out of twenty-odd
 * holdings should not erase every number on the screen. This is the same
 * degrade-precisely rule the listings guard follows — withhold the part that
 * is unknown, keep reporting the part that is not, and say which is which via
 * unpriced_holdings_count.
 *
 * Gain/loss is deliberately measured against priced_cost_basis, not
 * total_cost_basis: comparing the value of the priced holdings to the cost of
 * all of them would read as a loss the size of the unpriced ones.
 */
export function calculatePortfolioSummary(holdings: HoldingWithProduct[]): PortfolioSummary {
  let totalCostBasis = 0;
  let pricedCostBasis = 0;
  let pricedCurrentValue = 0;
  let pricedHoldings = 0;
  const productIds = new Set<number>();

  for (const holding of holdings) {
    const costBasis = holding.quantity * holding.purchase_price_usd;
    const currentPrice = holding.products?.usd_price ?? null;

    totalCostBasis += costBasis;
    if (currentPrice !== null) {
      pricedHoldings += 1;
      pricedCostBasis += costBasis;
      pricedCurrentValue += holding.quantity * currentPrice;
    }
    productIds.add(holding.product_id);
  }

  // Null when holdings exist but none could be valued — "$0.00" would read as
  // a portfolio that lost everything. An empty portfolio really is worth zero.
  const currentValue =
    holdings.length > 0 && pricedHoldings === 0 ? null : pricedCurrentValue;
  const totalGainLoss =
    currentValue === null ? null : currentValue - pricedCostBasis;
  const totalGainLossPercent =
    totalGainLoss === null
      ? null
      : pricedCostBasis > 0
        ? (totalGainLoss / pricedCostBasis) * 100
        : 0;

  return {
    total_cost_basis: totalCostBasis,
    priced_cost_basis: pricedCostBasis,
    total_current_value: currentValue,
    total_gain_loss: totalGainLoss,
    total_gain_loss_percent: totalGainLossPercent,
    holdings_count: holdings.length,
    unpriced_holdings_count: holdings.length - pricedHoldings,
    unique_products_count: productIds.size,
  };
}

/**
 * Calculate performance for a single holding
 */
export function calculateHoldingPerformance(holding: HoldingWithProduct): HoldingPerformance {
  const costBasis = holding.quantity * holding.purchase_price_usd;
  const currentPrice = holding.products?.usd_price ?? null;
  const currentValue =
    currentPrice === null ? null : holding.quantity * currentPrice;
  const gainLoss = currentValue === null ? null : currentValue - costBasis;
  const gainLossPercent =
    gainLoss === null ? null : costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;

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
  days: number,
  holdingsInput?: HoldingWithProduct[]
): Promise<PortfolioHistoryPoint[]> {
  const holdings = holdingsInput ?? (await getHoldings(portfolioId));
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
  // Anchored to UTC midnight, not to now-minus-N-days. isPriceFresh judges by
  // calendar date, so a bound carrying the current time of day would exclude
  // rows recorded earlier on the oldest allowed date — the scraper writes
  // around 04:00 UTC, so a chart built in the afternoon would miss them and
  // report that holding unpriced on the first day it covers.
  const priceHistoryStartDate = new Date(
    utcMidnightMs(startDate) - PRICE_STALENESS_TOLERANCE_DAYS * 24 * 60 * 60 * 1000
  );

  const { rows: priceHistory, error } = await fetchPortfolioPriceHistory(
    productIds,
    priceHistoryStartDate.toISOString()
  );

  if (error || !priceHistory) {
    logSupabaseError("price_history_fetch_failed", error);
    return [];
  }

  const priceHistoryByProduct = new Map<
    number,
    {
      entries: Array<{ date: string; price: number; recordedAt: string }>;
      index: number;
      price: number | null;
      recordedAt: string | null;
    }
  >();

  for (const holding of holdings) {
    if (!priceHistoryByProduct.has(holding.product_id)) {
      priceHistoryByProduct.set(holding.product_id, {
        entries: [],
        index: 0,
        price: null,
        recordedAt: null,
      });
    }
  }

  for (const entry of priceHistory) {
    const date = entry.recorded_at.split("T")[0];
    const productHistory = priceHistoryByProduct.get(entry.product_id);
    if (productHistory) {
      productHistory.entries.push({
        date,
        price: entry.usd_price,
        recordedAt: entry.recorded_at,
      });
    }
  }

  // Generate date series
  const history: PortfolioHistoryPoint[] = [];
  const today = new Date();

  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    let dailyValue = 0;
    let heldProducts = 0;
    let pricedProducts = 0;

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

      heldProducts += 1;

      while (
        priceData.index < priceData.entries.length &&
        priceData.entries[priceData.index].date <= dateStr
      ) {
        priceData.price = priceData.entries[priceData.index].price;
        priceData.recordedAt = priceData.entries[priceData.index].recordedAt;
        priceData.index += 1;
      }

      const referenceDate = new Date(`${dateStr}T12:00:00Z`);
      if (
        priceData.price === null ||
        !isPriceFresh(priceData.recordedAt, referenceDate)
      ) {
        continue;
      }

      pricedProducts += 1;
      dailyValue += holdingData.quantity * priceData.price;
    }

    // Chart what is known and record the coverage, rather than blanking the
    // whole portfolio because one product has no price on this day. Products
    // are tracked from the day they are added, so a holding bought before its
    // first history row leaves a legitimate gap — holdings 316/318/319 are 56
    // days short — and nulling the day for everyone hides twenty other
    // holdings that were priced perfectly well. Null only when nothing on this
    // day could be valued; zero would read as a portfolio worth nothing.
    history.push({
      date: dateStr,
      value: pricedProducts === 0 ? null : dailyValue,
      priced_products: pricedProducts,
      held_products: heldProducts,
    });
  }

  return history;
}

// ============================================
// Product Search
// ============================================

/**
 * Escape Postgres LIKE/ILIKE special characters so user-supplied
 * input cannot be used to enumerate via wildcards (e.g. "%" matching
 * everything when a single character was intended).
 */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

/**
 * Search products for adding to portfolio
 */
export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  if (!query || query.length < 2) return [];

  const [{ data, error }, productsById] = await Promise.all([
    supabase
      .from("products")
      .select(`
        id, usd_price, image_url, variant,
        sets ( name, code ),
        product_types ( name, label )
      `)
      .ilike("variant", `%${escapeLike(query)}%`)
      .limit(20),
    getFreshProductsById(),
  ]);

  if (error) {
    console.error("product_search_failed", { code: error.code });
    return [];
  }

  const products = (data || []) as unknown as ProductSearchResult[];
  return await applyFreshPricesToSearchResults(products, productsById);
}

/**
 * Search products by set name
 */
export async function searchProductsBySet(setName: string): Promise<ProductSearchResult[]> {
  // First, find sets matching the name
  const { data: setsData, error: setsError } = await supabase
    .from("sets")
    .select("id")
    .ilike("name", `%${escapeLike(setName)}%`);

  if (setsError || !setsData || setsData.length === 0) {
    if (setsError) logSupabaseError("sets_search_failed", setsError);
    return [];
  }

  const setIds = setsData.map((s) => s.id);

  const [{ data, error }, productsById] = await Promise.all([
    supabase
      .from("products")
      .select(`
        id, usd_price, image_url, variant,
        sets ( name, code ),
        product_types ( name, label )
      `)
      .in("set_id", setIds)
      .limit(50),
    getFreshProductsById(),
  ]);

  if (error) {
    logSupabaseError("products_by_set_search_failed", error);
    return [];
  }

  const products = (data || []) as unknown as ProductSearchResult[];
  return await applyFreshPricesToSearchResults(products, productsById);
}

/**
 * Get all products (for initial load or dropdown)
 */
export async function getAllProducts(): Promise<ProductSearchResult[]> {
  const [{ data, error }, productsById] = await Promise.all([
    supabase
      .from("products")
      .select(`
        id, usd_price, image_url, variant,
        sets ( name, code ),
        product_types ( name, label )
      `)
      .order("id", { ascending: true }),
    getFreshProductsById(),
  ]);

  if (error) {
    logSupabaseError("all_products_fetch_failed", error);
    return [];
  }

  const products = (data || []) as unknown as ProductSearchResult[];
  return await applyFreshPricesToSearchResults(products, productsById);
}
