/**
 * Tests for the freshness derivation on serverMarketData's fallback paths.
 *
 * These paths run when the summaries RPC is unavailable, and they used to read
 * freshness out of a year-long price history fetched through a page cap. That
 * fetch is ordered oldest-first and production overruns the cap by a factor of
 * two, so the newest row it could ever see was ~6 months old and every product
 * in the catalog was judged stale. The freshness signal now comes from its own
 * tolerance-window query; what follows pins that down.
 */

jest.mock("server-only", () => ({}));

const rpcMock = jest.fn();
const fromMock = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: rpcMock,
    from: fromMock,
  }),
}));

jest.mock("../logger", () => ({
  logSupabaseError: jest.fn(),
  logCaughtError: jest.fn(),
}));

jest.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { getCachedMarketProductSummaries } from "../serverMarketData";

type HistoryRow = {
  product_id: number;
  usd_price: number;
  recorded_at: string;
};

const PRODUCT_ROW = {
  id: 42,
  usd_price: 449.95,
  last_updated: "2026-08-11T04:00:00",
  url: "https://example.com/42",
  image_url: null,
  variant: null,
  sku: null,
  sets: [
    {
      id: 7,
      name: "XY",
      code: "XY",
      release_date: "2014-02-05",
      generation_id: 6,
      expansion_type: null,
      generations: [{ id: 6, name: "XY" }],
    },
  ],
  product_types: [{ id: 3, name: "elite_trainer_box", label: "ETB" }],
};

function recordedDaysAgo(days: number): string {
  const now = new Date();
  return `${new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)
  )
    .toISOString()
    .split("T")[0]}T09:00:00`;
}

/**
 * Stand in for the two price-history queries the fallback issues.
 *
 * `longWindow` is the 367-day fetch the returns are built from; `recentWindow`
 * is the freshness query. They are distinguished by their `gte` bound, exactly
 * as the real ones are.
 */
function mockSupabase(longWindow: HistoryRow[], recentWindow: HistoryRow[]) {
  const toleranceBound = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  fromMock.mockImplementation((table: string) => {
    if (table === "products") {
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [PRODUCT_ROW], error: null }),
          }),
        }),
      };
    }

    if (table === "product_price_history") {
      return {
        select: () => ({
          in: () => ({
            gte: (_column: string, bound: string) => ({
              order: () => ({
                range: (from: number) => {
                  const rows = bound >= toleranceBound ? recentWindow : longWindow;
                  return Promise.resolve({
                    data: from === 0 ? rows : [],
                    error: null,
                  });
                },
              }),
            }),
          }),
        }),
      };
    }

    throw new Error(`unexpected table in this test: ${table}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Force the fallback path: the summaries RPC is unavailable.
  rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
});

describe("market products fallback freshness", () => {
  it("keeps the price when a recent row exists, even though the long history is stale", async () => {
    // The regression in one case: the paged year of history stops months back
    // because the cap truncated it, while the product is in fact priced daily.
    mockSupabase(
      [
        {
          product_id: 42,
          usd_price: 449.95,
          recorded_at: recordedDaysAgo(183),
        },
      ],
      [{ product_id: 42, usd_price: 449.95, recorded_at: recordedDaysAgo(1) }]
    );

    const products = await getCachedMarketProductSummaries();

    expect(products).toHaveLength(1);
    expect(products[0].usd_price).toBe(449.95);
    expect(products[0].price_recorded_at).toBe(recordedDaysAgo(1));
  });

  it("withholds the price when the product has no row in the tolerance window", async () => {
    mockSupabase(
      [
        {
          product_id: 42,
          usd_price: 449.95,
          recorded_at: recordedDaysAgo(95),
        },
      ],
      []
    );

    const products = await getCachedMarketProductSummaries();

    expect(products).toHaveLength(1);
    expect(products[0].usd_price).toBeNull();
    // The last-known date still survives the guard, for the product page.
    expect(products[0].price_recorded_at).toBe(recordedDaysAgo(95));
  });
});
