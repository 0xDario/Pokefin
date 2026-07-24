/**
 * Regression tests for the Market View infinite re-render / refetch loop.
 *
 * Lives under MarketView/__tests__ because that is the directory this change
 * owns; the hook under test is ProductPrices/hooks/useProductData and is the
 * data source for MarketView, ProductPrices and RecentlyReleased.
 */
import { act, renderHook } from "@testing-library/react";

jest.mock("../../../lib/clientMarketData", () => ({
  fetchMarketProductsClient: jest.fn(),
  fetchProductHistoryClient: jest.fn(),
}));

import {
  fetchMarketProductsClient,
  fetchProductHistoryClient,
} from "../../../lib/clientMarketData";
import { useProductData } from "../../ProductPrices/hooks/useProductData";
import type { PriceHistoryEntry, Product } from "../../ProductPrices/types";

const fetchHistoryMock = fetchProductHistoryClient as jest.MockedFunction<
  typeof fetchProductHistoryClient
>;
const fetchProductsMock = fetchMarketProductsClient as jest.MockedFunction<
  typeof fetchMarketProductsClient
>;

// id 442 (XY Yveltal ETB) is one of the four live products with zero rows in
// product_price_history; expanding it used to pin the main thread.
const EMPTY_HISTORY_PRODUCT_ID = 442;

function makeProduct(id: number): Product {
  return {
    id,
    usd_price: 100,
    url: "https://example.test/product",
    last_updated: "2026-07-01T00:00:00",
    sets: { name: "Test Set", code: "TST", release_date: "2026-01-01" },
    product_types: { id: 1, name: "elite_trainer_box", label: "Elite Trainer Box" },
  };
}

function makeHistory(count: number): PriceHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    usd_price: 100 + index,
    recorded_at: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00`,
  }));
}

const PRODUCTS = [makeProduct(EMPTY_HISTORY_PRODUCT_ID), makeProduct(475)];

beforeEach(() => {
  jest.clearAllMocks();
  fetchProductsMock.mockResolvedValue([]);
  fetchHistoryMock.mockResolvedValue([]);
});

describe("useProductData - ensureHistoryLoaded stability", () => {
  it("keeps a single identity across rerenders and across state updates", async () => {
    fetchHistoryMock.mockResolvedValue(makeHistory(3));

    const { result, rerender } = renderHook(
      (props: { initialProducts: Product[] }) => useProductData(props),
      { initialProps: { initialProducts: PRODUCTS } }
    );

    const first = result.current.ensureHistoryLoaded;

    rerender({ initialProducts: PRODUCTS });
    expect(result.current.ensureHistoryLoaded).toBe(first);

    // A fetch flips loadingProductIds and priceHistory; the callback identity
    // must survive both of those state updates, otherwise every consumer
    // effect that lists it as a dependency re-fires and refetches forever.
    await act(async () => {
      await result.current.ensureHistoryLoaded(475, "1Y");
    });

    expect(result.current.priceHistory[475]).toHaveLength(3);
    expect(result.current.ensureHistoryLoaded).toBe(first);

    // A brand new (but content-identical) initialProducts array — what an
    // inline `= []` prop default or a parent `.filter()` produces every render
    // — must not change the identity either.
    rerender({ initialProducts: [...PRODUCTS] });
    expect(result.current.ensureHistoryLoaded).toBe(first);
  });

  it("does not refetch a product whose history is legitimately empty", async () => {
    fetchHistoryMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useProductData({ initialProducts: PRODUCTS })
    );

    await act(async () => {
      await result.current.ensureHistoryLoaded(EMPTY_HISTORY_PRODUCT_ID, "1Y");
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);

    // The old guard required history.length > 0, so this second call (and
    // every subsequent effect re-fire) issued another network request.
    let second: PriceHistoryEntry[] = [];
    await act(async () => {
      second = await result.current.ensureHistoryLoaded(
        EMPTY_HISTORY_PRODUCT_ID,
        "1Y"
      );
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual([]);

    await act(async () => {
      await result.current.ensureHistoryLoaded(EMPTY_HISTORY_PRODUCT_ID, "7D");
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("still refetches when a wider timeframe is requested, then caches it", async () => {
    fetchHistoryMock.mockImplementation(async (_productId, timeframe) =>
      makeHistory(timeframe === "1Y" ? 10 : 2)
    );

    const { result } = renderHook(() =>
      useProductData({ initialProducts: PRODUCTS })
    );

    await act(async () => {
      await result.current.ensureHistoryLoaded(475, "1M");
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
    expect(result.current.priceHistory[475]).toHaveLength(2);

    // Wider range -> must refetch.
    await act(async () => {
      await result.current.ensureHistoryLoaded(475, "1Y");
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(2);
    expect(result.current.priceHistory[475]).toHaveLength(10);

    // Narrower range afterwards -> served from the widened cache.
    await act(async () => {
      await result.current.ensureHistoryLoaded(475, "1M");
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(2);
    expect(result.current.priceHistory[475]).toHaveLength(10);
  });

  it("collapses concurrent calls for the same product and range", async () => {
    const { result } = renderHook(() =>
      useProductData({ initialProducts: PRODUCTS })
    );

    await act(async () => {
      await Promise.all([
        result.current.ensureHistoryLoaded(EMPTY_HISTORY_PRODUCT_ID, "1Y"),
        result.current.ensureHistoryLoaded(EMPTY_HISTORY_PRODUCT_ID, "1Y"),
        result.current.ensureHistoryLoaded(EMPTY_HISTORY_PRODUCT_ID, "1Y"),
      ]);
    });

    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
    expect(result.current.loadingProductIds).toEqual([]);
  });

  it("clears the loading flag and returns [] when the fetch fails", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    fetchHistoryMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useProductData({ initialProducts: PRODUCTS })
    );

    let history: PriceHistoryEntry[] = [{ usd_price: 1, recorded_at: "x" }];
    await act(async () => {
      history = await result.current.ensureHistoryLoaded(475, "1Y");
    });

    expect(history).toEqual([]);
    expect(result.current.loadingProductIds).toEqual([]);
    // A failed fetch must NOT be recorded as loaded, so a retry is possible.
    await act(async () => {
      await result.current.ensureHistoryLoaded(475, "1Y");
    });
    expect(fetchHistoryMock).toHaveBeenCalledTimes(2);

    consoleError.mockRestore();
  });
});

describe("useProductData - products effect", () => {
  it("fetches products only once when initialProducts is an unstable empty array", async () => {
    const { rerender } = renderHook(
      (props: { initialProducts: Product[] }) => useProductData(props),
      { initialProps: { initialProducts: [] as Product[] } }
    );

    await act(async () => {
      rerender({ initialProducts: [] });
      rerender({ initialProducts: [] });
      rerender({ initialProducts: [] });
    });

    expect(fetchProductsMock).toHaveBeenCalledTimes(1);
  });
});
