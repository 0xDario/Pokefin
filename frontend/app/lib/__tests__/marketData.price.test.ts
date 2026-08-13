import { mapMarketSummaryRowToProduct } from "../marketData";
import type { MarketSummaryRow } from "../marketData";

// mapMarketSummaryRowToProduct judges freshness against the real clock, so
// these build their timestamps relative to now instead of pinning a date.
// UTC, because recorded_at's date part is a UTC date key.
function recordedDaysAgo(days: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)
  );
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T09:00:00`;
}

function makeRow(overrides: Partial<MarketSummaryRow> = {}): MarketSummaryRow {
  return {
    id: 42,
    usd_price: 449.95,
    url: "https://www.tcgplayer.com/product/97747",
    price_recorded_at: recordedDaysAgo(1),
    last_updated: recordedDaysAgo(0),
    variant: null,
    image_url: null,
    sku: null,
    set_id: 7,
    set_name: "XY",
    set_code: "XY",
    set_release_date: "2014-02-05",
    set_expansion_type: null,
    generation_id: 6,
    generation_name: "XY",
    product_type_id: 3,
    product_type_name: "elite_trainer_box",
    product_type_label: "Elite Trainer Box",
    return_1d: null,
    return_7d: null,
    return_30d: null,
    return_90d: null,
    return_180d: null,
    return_365d: null,
    ...overrides,
  };
}

describe("mapMarketSummaryRowToProduct price freshness", () => {
  it("keeps a price recorded inside the tolerance", () => {
    const product = mapMarketSummaryRowToProduct(
      makeRow({ price_recorded_at: recordedDaysAgo(13) })
    );

    expect(product.usd_price).toBe(449.95);
  });

  it("withholds a price whose newest recording is stale", () => {
    // Production state of product 42: last real price row 95 days back, but
    // products.usd_price still carries $449.95 and the catalog rendered it.
    const product = mapMarketSummaryRowToProduct(
      makeRow({ price_recorded_at: recordedDaysAgo(95) })
    );

    expect(product.usd_price).toBeNull();
  });

  it("reports when a withheld price was last recorded", () => {
    const recordedAt = recordedDaysAgo(55);
    const product = mapMarketSummaryRowToProduct(
      makeRow({ id: 415, usd_price: 1649.99, price_recorded_at: recordedAt })
    );

    // The date survives the guard so the product page can say why the price
    // is missing, exactly as listings_snapshot_date does for supply.
    expect(product.usd_price).toBeNull();
    expect(product.price_recorded_at).toBe(recordedAt);
  });

  it("maps a null price to null rather than to zero", () => {
    // The four dead-SKU products that never got a price at all. Zero used to
    // reach formatPrice and render as "$0.00" — a real-looking market price.
    const product = mapMarketSummaryRowToProduct(
      makeRow({ usd_price: null, price_recorded_at: null })
    );

    expect(product.usd_price).toBeNull();
  });

  it("withholds a non-null price that has never been recorded", () => {
    const product = mapMarketSummaryRowToProduct(
      makeRow({ price_recorded_at: null })
    );

    expect(product.usd_price).toBeNull();
  });

  it("withholds the returns along with the price", () => {
    // Every return is anchored on the current price, so a row with none has
    // nothing to measure from. Without this the guard would replace one stale
    // number with six derived from it.
    const product = mapMarketSummaryRowToProduct(
      makeRow({
        price_recorded_at: recordedDaysAgo(95),
        return_1d: 0,
        return_30d: 0,
        return_365d: 12.5,
      })
    );

    expect(product.usd_price).toBeNull();
    expect(product.returns).toBeNull();
  });

  it("keeps the returns when the price is current", () => {
    const product = mapMarketSummaryRowToProduct(
      makeRow({ price_recorded_at: recordedDaysAgo(1), return_30d: 12.5 })
    );

    expect(product.usd_price).toBe(449.95);
    expect(product.returns?.["1M"]).toBe(12.5);
  });

  it("passes the price through when the RPC predates migration 0023", () => {
    // No price_recorded_at column at all: there is no freshness signal to
    // judge by, and blanking every price because the database is behind on
    // migrations would be the worse failure.
    const row = makeRow();
    delete row.price_recorded_at;
    const product = mapMarketSummaryRowToProduct(row);

    expect(product.usd_price).toBe(449.95);
    expect(product.price_recorded_at).toBeNull();
  });
});
