import {
  compareSortValues,
  getDefaultSortDirection,
  isMissingSortValue,
  type SortValue,
} from "../sorting";

function sortValues(values: SortValue[], direction: "asc" | "desc") {
  return [...values].sort((a, b) => compareSortValues(a, b, direction));
}

describe("isMissingSortValue", () => {
  it("treats null and NaN as missing but keeps 0 and empty string", () => {
    expect(isMissingSortValue(null)).toBe(true);
    expect(isMissingSortValue(Number.NaN)).toBe(true);
    expect(isMissingSortValue(0)).toBe(false);
    expect(isMissingSortValue("")).toBe(false);
  });
});

describe("compareSortValues", () => {
  it("sinks nulls to the bottom when sorting descending", () => {
    // Regression: the Vol (30d) / Vol Δ / 1Y columns used to lead with a block
    // of "--" rows because nulls were flipped to the front by the descending
    // multiplier.
    expect(sortValues([null, 5, null, 12, 3], "desc")).toEqual([
      12,
      5,
      3,
      null,
      null,
    ]);
  });

  it("sinks nulls to the bottom when sorting ascending", () => {
    expect(sortValues([null, 5, null, 12, 3], "asc")).toEqual([
      3,
      5,
      12,
      null,
      null,
    ]);
  });

  it("sinks NaN alongside null in both directions", () => {
    expect(sortValues([Number.NaN, 2, null, 9], "desc")).toEqual([
      9,
      2,
      Number.NaN,
      null,
    ]);
    expect(sortValues([Number.NaN, 2, null, 9], "asc")).toEqual([
      2,
      9,
      Number.NaN,
      null,
    ]);
  });

  it("sinks nulls for string columns too", () => {
    expect(sortValues(["beta", null, "alpha"], "desc")).toEqual([
      "beta",
      "alpha",
      null,
    ]);
    expect(sortValues(["beta", null, "alpha"], "asc")).toEqual([
      "alpha",
      "beta",
      null,
    ]);
  });

  it("keeps two missing values equal", () => {
    expect(compareSortValues(null, Number.NaN, "desc")).toBe(0);
    expect(compareSortValues(null, null, "asc")).toBe(0);
  });

  it("does not treat negative numbers or zero as missing", () => {
    expect(sortValues([0, -4, null, 7], "desc")).toEqual([7, 0, -4, null]);
    expect(sortValues([0, -4, null, 7], "asc")).toEqual([-4, 0, 7, null]);
  });
});

describe("getDefaultSortDirection", () => {
  it("opens name-like and lower-is-better columns ascending", () => {
    expect(getDefaultSortDirection("product")).toBe("asc");
    expect(getDefaultSortDirection("set")).toBe("asc");
    expect(getDefaultSortDirection("days_since_release")).toBe("asc");
    expect(getDefaultSortDirection("max_drawdown")).toBe("asc");
    expect(getDefaultSortDirection("volatility_30d")).toBe("asc");
  });

  it("opens the volume columns descending (highest volume first)", () => {
    expect(getDefaultSortDirection("vol_30d")).toBe("desc");
    expect(getDefaultSortDirection("vol_trend")).toBe("desc");
  });
});
