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

  it("uses guarded summary prices and excludes products with no current price", async () => {
    fetchProductsMock.mockResolvedValue([
      makeProduct(1, 8.5),
      makeProduct(2, null),
      makeProduct(3, 150, "booster_box"),
    ]);

    const { result } = renderHook(() => useBoosterPackPrices());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.boosterPackPrices).toEqual([
      {
        setId: 1,
        setName: "Set 1",
        usdPrice: 8.5,
        variant: null,
      },
    ]);
  });

  it("finishes loading with no prices when the guarded source fails", async () => {
    fetchProductsMock.mockRejectedValue(new Error("summary RPC unavailable"));

    const { result } = renderHook(() => useBoosterPackPrices());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.boosterPackPrices).toEqual([]);
  });
});
