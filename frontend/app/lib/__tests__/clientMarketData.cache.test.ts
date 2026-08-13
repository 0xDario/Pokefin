/**
 * Tests for the market-products cache lifetime.
 *
 * These products carry a freshness verdict baked in at fetch time — usd_price
 * is already nulled, or not, by how old price_recorded_at was when the RPC
 * ran. Reusing them for a whole browser session meant a long-lived tab kept
 * valuing box NAV from a price that had since moved or gone stale.
 */

const rpcMock = jest.fn();
const fromMock = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

jest.mock("../logger", () => ({
  logSupabaseError: jest.fn(),
  logCaughtError: jest.fn(),
}));

function summaryRow(usdPrice: number | null) {
  return {
    id: 1,
    usd_price: usdPrice,
    url: "https://example.com/1",
    price_recorded_at: new Date().toISOString().split("T")[0] + "T09:00:00",
    last_updated: "2026-08-12T04:00:00",
    variant: null,
    image_url: null,
    sku: null,
    set_id: 1,
    set_name: "Set",
    set_code: "S",
    set_release_date: "2024-01-01",
    set_expansion_type: null,
    generation_id: 1,
    generation_name: "Gen",
    product_type_id: 1,
    product_type_name: "booster_pack",
    product_type_label: "Booster Pack",
    return_1d: null,
    return_7d: null,
    return_30d: null,
    return_90d: null,
    return_180d: null,
    return_365d: null,
  };
}

describe("fetchMarketProductsClient cache lifetime", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves repeat calls inside the window from cache", async () => {
    const { fetchMarketProductsClient } = await import("../clientMarketData");
    rpcMock.mockResolvedValue({ data: [summaryRow(10)], error: null });

    const first = await fetchMarketProductsClient();
    const second = await fetchMarketProductsClient();

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(first[0].usd_price).toBe(10);
    expect(second[0].usd_price).toBe(10);
  });

  it("refetches once the cache is older than an hour", async () => {
    jest.useFakeTimers();
    const { fetchMarketProductsClient } = await import("../clientMarketData");

    rpcMock.mockResolvedValue({ data: [summaryRow(10)], error: null });
    const first = await fetchMarketProductsClient();
    expect(first[0].usd_price).toBe(10);

    // The scraper has since re-priced the product.
    rpcMock.mockResolvedValue({ data: [summaryRow(42)], error: null });

    // Still inside the window: the old value stands.
    jest.advanceTimersByTime(59 * 60 * 1000);
    expect((await fetchMarketProductsClient())[0].usd_price).toBe(10);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Past it: the calculator must not keep valuing NAV from the old price.
    jest.advanceTimersByTime(2 * 60 * 1000);
    expect((await fetchMarketProductsClient())[0].usd_price).toBe(42);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("picks up a price that has since been withheld as stale", async () => {
    jest.useFakeTimers();
    const { fetchMarketProductsClient } = await import("../clientMarketData");

    rpcMock.mockResolvedValue({ data: [summaryRow(10)], error: null });
    expect((await fetchMarketProductsClient())[0].usd_price).toBe(10);

    // The guard has since withheld it — the freshness verdict is decided
    // server-side at fetch time, so only a refetch can surface the change.
    rpcMock.mockResolvedValue({ data: [summaryRow(null)], error: null });

    jest.advanceTimersByTime(61 * 60 * 1000);
    expect((await fetchMarketProductsClient())[0].usd_price).toBeNull();
  });

  it("expires cached price history on the same clock as the products cache", async () => {
    // Giving only the products cache a TTL made the two disagree: after the
    // hour the card showed a refreshed price while the chart still forward-
    // filled the history loaded on first visit.
    jest.useFakeTimers();
    const { fetchProductHistoryClient } = await import("../clientMarketData");

    const history = (price: number) => ({
      data: [{ product_id: 1, usd_price: price, recorded_at: "2026-08-12T09:00:00" }],
      error: null,
    });

    let current = history(100);
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          gte: () => ({ order: () => Promise.resolve(current) }),
        }),
      }),
    }));

    expect((await fetchProductHistoryClient(1, "1M"))[0].usd_price).toBe(100);

    // The scraper has since re-priced it.
    current = history(142);

    jest.advanceTimersByTime(59 * 60 * 1000);
    expect((await fetchProductHistoryClient(1, "1M"))[0].usd_price).toBe(100);

    jest.advanceTimersByTime(2 * 60 * 1000);
    expect((await fetchProductHistoryClient(1, "1M"))[0].usd_price).toBe(142);
  });
});
