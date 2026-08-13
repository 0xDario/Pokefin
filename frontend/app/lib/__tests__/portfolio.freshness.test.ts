/**
 * Tests for the price-freshness guard where it meets real portfolio data.
 *
 * The pure helpers (isPriceFresh, getFreshUsdPrice) are covered in
 * marketPulse.test.ts. What is covered here is the integration points those
 * tests cannot reach: what the guard does to a portfolio that is only
 * partially priced, and what it does to a holding the market summaries do not
 * describe at all.
 */

jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock("../clientMarketData", () => ({
  fetchMarketProductsClient: jest.fn(),
  fetchNewestPricedAtClient: jest.fn(),
}));

jest.mock("../logger", () => ({
  logCaughtError: jest.fn(),
  logSupabaseError: jest.fn(),
}));

import { supabase } from "../supabase";
import {
  fetchMarketProductsClient,
  fetchNewestPricedAtClient,
} from "../clientMarketData";
import {
  calculatePortfolioSummary,
  getHoldings,
  getPortfolioHistory,
} from "../portfolio";
import type { HoldingWithProduct } from "../../components/Portfolio/types";

const fromMock = supabase.from as jest.Mock;
const fetchProductsMock = fetchMarketProductsClient as jest.MockedFunction<
  typeof fetchMarketProductsClient
>;
const fetchNewestPricedAtMock =
  fetchNewestPricedAtClient as jest.MockedFunction<
    typeof fetchNewestPricedAtClient
  >;

function makeHolding(
  overrides: Partial<{
    id: number;
    product_id: number;
    quantity: number;
    purchase_price_usd: number;
    purchase_date: string;
    usd_price: number | null;
  }> = {}
): HoldingWithProduct {
  const usdPrice =
    overrides.usd_price !== undefined ? overrides.usd_price : 100;
  return {
    id: overrides.id ?? 1,
    portfolio_id: 1,
    product_id: overrides.product_id ?? 100,
    quantity: overrides.quantity ?? 1,
    purchase_price_usd: overrides.purchase_price_usd ?? 50,
    purchase_date: overrides.purchase_date ?? "2020-01-01",
    notes: null,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    products: {
      id: overrides.product_id ?? 100,
      usd_price: usdPrice,
      image_url: null,
      variant: null,
      url: "https://example.com/product",
      sets: {
        id: 1,
        name: "Test Set",
        code: "TST",
        release_date: "2020-01-01",
        expansion_type: "Expansion",
        generations: { id: 1, name: "Generation 1" },
      },
      product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    },
  } as HoldingWithProduct;
}

/** UTC date key `offset` days from today, matching the chart's date series. */
function dateKeyDaysAgo(offset: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)
  )
    .toISOString()
    .split("T")[0];
}

/**
 * Serve price-history rows through the paged call shape the loader uses.
 * `.range(from, to)` slices, so a test can hand over more than one page and
 * check that every page is stitched back together.
 */
function mockPriceHistoryRows(
  rows: Array<{ product_id: number; usd_price: number; recorded_at: string }>
) {
  fromMock.mockImplementation((table: string) => {
    if (table !== "product_price_history") {
      throw new Error(`unexpected table in this test: ${table}`);
    }
    return {
      select: () => ({
        in: () => ({
          gte: () => ({
            order: () => ({
              order: () => ({
                range: (from: number, to: number) =>
                  Promise.resolve({
                    data: rows.slice(from, to + 1),
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("calculatePortfolioSummary with a partially priced portfolio", () => {
  it("values the priced holdings and counts the rest instead of blanking everything", () => {
    const holdings = [
      makeHolding({
        id: 1,
        product_id: 1,
        quantity: 2,
        purchase_price_usd: 100,
        usd_price: 150,
      }),
      makeHolding({
        id: 2,
        product_id: 2,
        quantity: 1,
        purchase_price_usd: 80,
        usd_price: null,
      }),
    ];

    const result = calculatePortfolioSummary(holdings);

    // 2 x 150 valued; the unpriced holding contributes nothing but is counted.
    expect(result.total_current_value).toBe(300);
    expect(result.unpriced_holdings_count).toBe(1);
    expect(result.holdings_count).toBe(2);
    // Cost basis still covers everything the user paid...
    expect(result.total_cost_basis).toBe(280);
    // ...but gain/loss is measured only against what could be valued, or the
    // unpriced holding's $80 would show up as an $80 loss.
    expect(result.priced_cost_basis).toBe(200);
    expect(result.total_gain_loss).toBe(100);
    expect(result.total_gain_loss_percent).toBe(50);
  });

  it("reports an unknown valuation only when nothing at all could be priced", () => {
    const result = calculatePortfolioSummary([
      makeHolding({ id: 1, product_id: 1, usd_price: null }),
      makeHolding({ id: 2, product_id: 2, usd_price: null }),
    ]);

    expect(result.total_current_value).toBeNull();
    expect(result.total_gain_loss).toBeNull();
    expect(result.total_gain_loss_percent).toBeNull();
    expect(result.unpriced_holdings_count).toBe(2);
  });
});

describe("getHoldings freshness map", () => {
  /**
   * @param rows           portfolio_holdings rows
   * @param historyRows    product_price_history rows inside the tolerance
   *                       window, for products the summaries do not cover
   */
  /** freshness entries are [productId, recordedAt, newestHistoryPrice]. */
  function mockHoldingsQuery(
    rows: unknown[],
    freshness: Array<[number, string, number | null]> = []
  ) {
    fetchNewestPricedAtMock.mockResolvedValue(
      new Map(freshness.map(([id, recordedAt, usdPrice]) => [
        id,
        { recordedAt, usdPrice },
      ]))
    );
    fromMock.mockImplementation((table: string) => {
      if (table !== "portfolio_holdings") {
        throw new Error(`unexpected table in this test: ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      };
    });
  }

  it("keeps a deactivated product's price when it was recorded recently", async () => {
    // get_market_product_summaries covers active products only, so a holding
    // of a deactivated one is absent from the map. Absence is not evidence of
    // staleness, so its freshness is looked up rather than assumed.
    mockHoldingsQuery(
      [makeHolding({ product_id: 42, usd_price: 449.95 })],
      [[42, `${dateKeyDaysAgo(1)}T09:00:00`, 449.95]]
    );
    fetchProductsMock.mockResolvedValue([]);

    const [holding] = await getHoldings(1);

    expect(holding.products?.usd_price).toBe(449.95);
  });

  it("withholds a deactivated product's price when nothing was recorded recently", async () => {
    // Absence from the map is not evidence of freshness either: products
    // .usd_price is last-write-wins, so a deactivated product would otherwise
    // contribute an indefinitely old value to the portfolio total.
    mockHoldingsQuery([makeHolding({ product_id: 42, usd_price: 449.95 })], []);
    fetchProductsMock.mockResolvedValue([]);

    const [holding] = await getHoldings(1);

    expect(holding.products?.usd_price).toBeNull();
  });

  it("takes the guarded price when the product is present", async () => {
    mockHoldingsQuery([makeHolding({ product_id: 42, usd_price: 449.95 })]);
    fetchProductsMock.mockResolvedValue([
      { id: 42, usd_price: null, price_recorded_at: "2026-05-08T04:07:55" },
    ] as never);

    const [holding] = await getHoldings(1);

    expect(holding.products?.usd_price).toBeNull();
    expect(holding.products?.price_recorded_at).toBe("2026-05-08T04:07:55");
  });

  it("withholds every price when the freshness source itself fails", async () => {
    mockHoldingsQuery([makeHolding({ product_id: 42, usd_price: 449.95 })]);
    fetchProductsMock.mockRejectedValue(new Error("summaries unavailable"));

    const [holding] = await getHoldings(1);

    expect(holding.products?.usd_price).toBeNull();
  });
});

describe("getPortfolioHistory coverage", () => {
  it("charts the priced holdings on a day when another has no price yet", async () => {
    const holdings = [
      makeHolding({ id: 1, product_id: 1, quantity: 2 }),
      makeHolding({ id: 2, product_id: 2, quantity: 1 }),
    ];

    // Product 1 is priced daily; product 2 has no history at all, the shape of
    // a holding bought before the scraper started tracking it.
    // Oldest first, as the real query orders them.
    mockPriceHistoryRows(
      [4, 3, 2, 1, 0].map((offset) => ({
        product_id: 1,
        usd_price: 10,
        recorded_at: `${dateKeyDaysAgo(offset)}T09:00:00`,
      }))
    );

    const history = await getPortfolioHistory(1, 3, holdings);

    expect(history.length).toBeGreaterThan(0);
    for (const point of history) {
      expect(point.value).toBe(20);
      expect(point.priced_products).toBe(1);
      expect(point.held_products).toBe(2);
    }
  });

  it("pages past the 1000-row response cap to reach the newest history", async () => {
    // PostgREST returns at most 1000 rows per request and this query is
    // ordered oldest-first, so a single page stops well short of today: 23
    // held products over a 1Y chart is ~8,200 rows. Everything after the cut
    // would fail the freshness check and the recent chart would read as
    // unpriced. Here the newest row sits past the first page boundary.
    const holdings = [makeHolding({ id: 1, product_id: 1, quantity: 2 })];

    const filler = Array.from({ length: 1200 }, () => ({
      product_id: 999,
      usd_price: 1,
      recorded_at: `${dateKeyDaysAgo(300)}T09:00:00`,
    }));
    const recent = [4, 3, 2, 1, 0].map((offset) => ({
      product_id: 1,
      usd_price: 10,
      recorded_at: `${dateKeyDaysAgo(offset)}T09:00:00`,
    }));
    mockPriceHistoryRows([...filler, ...recent]);

    const history = await getPortfolioHistory(1, 3, holdings);

    expect(history.length).toBeGreaterThan(0);
    for (const point of history) {
      expect(point.value).toBe(20);
      expect(point.priced_products).toBe(1);
    }
  });

  it("returns null for a day on which nothing could be priced", async () => {
    const holdings = [makeHolding({ id: 1, product_id: 1, quantity: 2 })];

    // A price far past the staleness tolerance is not a current price.
    mockPriceHistoryRows([
      {
        product_id: 1,
        usd_price: 10,
        recorded_at: `${dateKeyDaysAgo(400)}T09:00:00`,
      },
    ]);

    const history = await getPortfolioHistory(1, 3, holdings);

    expect(history.length).toBeGreaterThan(0);
    for (const point of history) {
      expect(point.value).toBeNull();
      expect(point.priced_products).toBe(0);
      expect(point.held_products).toBe(1);
    }
  });
});
