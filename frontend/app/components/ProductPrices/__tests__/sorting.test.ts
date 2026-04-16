import { getProductSortOrder, sortProducts } from "../utils/sorting";
import { Product } from "../types";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    usd_price: 100,
    url: "",
    last_updated: "2026-01-01T00:00:00Z",
    variant: null,
    sets: {
      name: "Test Set",
      code: "TST",
      release_date: "2026-01-01",
    },
    product_types: {
      id: 1,
      name: "unknown_type",
      label: "Unknown Type",
    },
    ...overrides,
  };
}

describe("getProductSortOrder", () => {
  it("applies the requested product priority order", () => {
    const boosterBox = makeProduct({
      product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    });
    const pkcEtb = makeProduct({
      product_types: { id: 2, name: "elite_trainer_box", label: "Elite Trainer Box" },
      variant: "Pokemon Center Exclusive",
    });
    const etb = makeProduct({
      product_types: { id: 3, name: "elite_trainer_box", label: "Elite Trainer Box" },
    });
    const boosterBundle = makeProduct({
      product_types: { id: 4, name: "booster_bundle", label: "Booster Bundle" },
    });
    const collection = makeProduct({
      product_types: { id: 5, name: "collection_box", label: "Collection Box" },
    });
    const boxSet = makeProduct({
      product_types: { id: 6, name: "box_set", label: "Box Set" },
    });
    const other = makeProduct({
      product_types: { id: 7, name: "tin", label: "Tin" },
    });
    const boosterPack = makeProduct({
      product_types: { id: 8, name: "booster_pack", label: "Booster Pack" },
    });

    expect(getProductSortOrder(boosterBox)).toBeLessThan(getProductSortOrder(pkcEtb));
    expect(getProductSortOrder(pkcEtb)).toBeLessThan(getProductSortOrder(etb));
    expect(getProductSortOrder(etb)).toBeLessThan(getProductSortOrder(boosterBundle));
    expect(getProductSortOrder(boosterBundle)).toBeLessThan(getProductSortOrder(collection));
    expect(getProductSortOrder(collection)).toBeLessThan(getProductSortOrder(boxSet));
    expect(getProductSortOrder(boxSet)).toBeLessThan(getProductSortOrder(other));
    expect(getProductSortOrder(other)).toBeLessThan(getProductSortOrder(boosterPack));
  });
});

describe("sortProducts", () => {
  it("uses product-type priority as tie-breaker when release date is equal", () => {
    const setReleaseDate = "2026-02-01";

    const products = [
      makeProduct({
        id: 1,
        product_types: { id: 1, name: "booster_pack", label: "Booster Pack" },
        sets: { name: "Set A", code: "A", release_date: setReleaseDate },
      }),
      makeProduct({
        id: 2,
        product_types: { id: 2, name: "elite_trainer_box", label: "Elite Trainer Box" },
        sets: { name: "Set A", code: "A", release_date: setReleaseDate },
      }),
      makeProduct({
        id: 3,
        product_types: { id: 3, name: "booster_box", label: "Booster Box" },
        sets: { name: "Set A", code: "A", release_date: setReleaseDate },
      }),
    ];

    const sorted = sortProducts(products, "release_date", "desc");
    expect(sorted.map((p) => p.id)).toEqual([3, 2, 1]);
  });
});
