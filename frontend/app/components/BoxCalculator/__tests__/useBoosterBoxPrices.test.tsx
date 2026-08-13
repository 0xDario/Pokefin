import { renderHook, waitFor } from "@testing-library/react";
import { fetchMarketProductsClient } from "../../../lib/clientMarketData";
import { useBoosterPackPrices } from "../hooks/useBoosterBoxPrices";
import type { Product } from "../../ProductPrices/types";

jest.mock("../../../lib/clientMarketData", () => ({
  fetchMarketProductsClient: jest.fn(),
}));

jest.mock("../../../lib/logger", () => ({
  logCaughtError: jest.fn(),
}));

const fetchProductsMock =
  fetchMarketProductsClient as jest.MockedFunction<
    typeof fetchMarketProductsClient
  >;

function makeProduct(
  id: number,
  usdPrice: number | null,
  typeName = "booster_pack"
): Product {
  return {
    id,
    usd_price: usdPrice,
    price_recorded_at: "2026-08-11T04:00:00",
    url: `https://example.com/${id}`,
    last_updated: "2026-08-11T04:00:00",
    variant: null,
    sets: {
      id,
      name: `Set ${id}`,
      code: `S${id}`,
      release_date: "2026-01-01",
    },
    product_types: {
      id: 1,
      name: typeName,
      label: typeName === "booster_pack" ? "Booster Pack" : "Booster Box",
    },
  };
}

describe("useBoosterPackPrices", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses guarded summary prices and lists an unpriced pack with a null price", async () => {
    // Listed rather than dropped: getPackPrice has to be able to tell a set
    // with no standard pack from one whose standard pack cannot be priced.
    fetchProductsMock.mockResolvedValue([
      makeProduct(1, 8.5),
      makeProduct(2, null),
      makeProduct(3, 150, "booster_box"),
    ]);

    const { result } = renderHook(() => useBoosterPackPrices());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.boosterPackPrices).toEqual([
      { setId: 1, setName: "Set 1", usdPrice: 8.5, variant: null },
      { setId: 2, setName: "Set 2", usdPrice: null, variant: null },
    ]);
    expect(result.current.getPackPrice(1)).toBe(8.5);
    expect(result.current.getPackPrice(2)).toBeNull();
  });

  it("does not substitute a variant when the standard pack is unpriced", async () => {
    // A recipe names only the set, so pricing ordinary packs off a variant's
    // SKU would understate or overstate the NAV without saying so.
    const standard = makeProduct(1, null);
    const variant = makeProduct(1, 4.25);
    variant.variant = "Reverse Holo";

    fetchProductsMock.mockResolvedValue([standard, variant]);

    const { result } = renderHook(() => useBoosterPackPrices());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getPackPrice(1)).toBeNull();
  });

  it("falls back to the cheapest variant when a set has no standard pack", async () => {
    const cheap = makeProduct(1, 4.25);
    cheap.variant = "Reverse Holo";
    const dear = makeProduct(1, 9.75);
    dear.variant = "Master Ball";

    fetchProductsMock.mockResolvedValue([dear, cheap]);

    const { result } = renderHook(() => useBoosterPackPrices());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getPackPrice(1)).toBe(4.25);
  });

  it("finishes loading with no prices when the guarded source fails", async () => {
    fetchProductsMock.mockRejectedValue(new Error("summary RPC unavailable"));

    const { result } = renderHook(() => useBoosterPackPrices());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.boosterPackPrices).toEqual([]);
  });
});
