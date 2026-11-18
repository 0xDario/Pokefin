import { eraNumberMatches, normalizeEraNumber } from "../eraNumber";
import { filterProducts } from "../../components/ProductPrices/utils/filtering";
import { mapMarketSummaryRowToProduct, MarketSummaryRow } from "../marketData";
import { Product } from "../../components/ProductPrices/types";

describe("normalizeEraNumber", () => {
  it.each([
    ["SV1", "SV1"],
    ["sv3.5", "SV3.5"],
    ["SV 3.5", "SV3.5"],
    ["sv03.5", "SV3.5"],
    ["swsh-12.5", "SWSH12.5"],
    ["me2.5", "ME2.5"],
    ["XY0", "XY0"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeEraNumber(input)).toBe(expected);
  });

  it.each(["sv", "151", "Destined Rivals", "SV3.7", "DRI"])(
    "returns null for %s",
    (input) => {
      expect(normalizeEraNumber(input)).toBeNull();
    }
  );
});

describe("eraNumberMatches", () => {
  it("matches an era-shaped term exactly, so SV1 does not hit SV10", () => {
    expect(eraNumberMatches("SV1", "sv1")).toBe(true);
    expect(eraNumberMatches("SV10", "sv1")).toBe(false);
    expect(eraNumberMatches("SV10.5", "sv1")).toBe(false);
    expect(eraNumberMatches("SV10.5", "sv10.5")).toBe(true);
  });

  it("falls back to a substring match for a bare prefix", () => {
    expect(eraNumberMatches("SWSH7.5", "swsh")).toBe(true);
    expect(eraNumberMatches("SM3.5", "swsh")).toBe(false);
  });

  it("never matches a set without a number", () => {
    expect(eraNumberMatches(null, "sv1")).toBe(false);
    expect(eraNumberMatches(undefined, "sv")).toBe(false);
  });
});

function makeProduct(id: number, code: string, era_number: string | null): Product {
  return {
    id,
    usd_price: 100,
    url: "",
    last_updated: "2026-01-01T00:00:00Z",
    sets: { name: `Set ${code}`, code, era_number, release_date: "2026-01-01" },
    product_types: { id: 1, name: "booster_box", label: "Booster Box" },
  };
}

describe("filterProducts by era number", () => {
  const products = [
    makeProduct(1, "SVI", "SV1"),
    makeProduct(2, "DRI", "SV10"),
    makeProduct(3, "MEW", "SV3.5"),
    makeProduct(4, "WHT", "SV10.5"),
    makeProduct(5, "BLK", "SV10.5"),
    makeProduct(6, "OLD", null),
  ];
  const filter = (searchTerm: string) =>
    filterProducts(products, {
      selectedGeneration: "all",
      selectedProductType: "all",
      searchTerm,
    }).map((p) => p.id);

  it("finds a special expansion by its .5 number", () => {
    expect(filter("SV3.5")).toEqual([3]);
  });

  it("finds both sets that share a slot", () => {
    expect(filter("sv10.5")).toEqual([4, 5]);
  });

  it("does not widen SV1 to SV10", () => {
    expect(filter("SV1")).toEqual([1]);
  });

  it("still finds sets by their 3-letter code", () => {
    expect(filter("dri")).toEqual([2]);
  });
});

describe("mapMarketSummaryRowToProduct era number", () => {
  const row = {
    id: 1,
    usd_price: null,
    url: null,
    last_updated: null,
    variant: null,
    image_url: null,
    sku: null,
    set_id: 4,
    set_name: "151",
    set_code: "MEW",
    set_release_date: "2023-09-22",
    set_expansion_type: "Special Expansion",
    generation_id: 1,
    generation_name: "Scarlet & Violet",
    product_type_id: 1,
    product_type_name: "booster_box",
    product_type_label: "Booster Box",
    return_1d: null,
    return_7d: null,
    return_30d: null,
    return_90d: null,
    return_180d: null,
    return_365d: null,
  } satisfies MarketSummaryRow;

  it("carries set_era_number onto the set", () => {
    const product = mapMarketSummaryRowToProduct({ ...row, set_era_number: "SV3.5" });
    expect(product.sets?.era_number).toBe("SV3.5");
  });

  it("tolerates a database that predates migration 0026", () => {
    const product = mapMarketSummaryRowToProduct(row);
    expect(product.sets?.era_number).toBeNull();
  });
});
