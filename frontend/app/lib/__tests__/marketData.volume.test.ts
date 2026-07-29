import { buildVolumeSeries } from "../marketData";
import type { SalesHistoryEntry } from "../../components/ProductPrices/types";

function makeSale(
  bucketDate: string,
  quantitySold: number | null,
  granularity: "day" | "week" = "day"
): SalesHistoryEntry {
  return {
    bucket_date: bucketDate,
    granularity,
    quantity_sold: quantitySold,
    transaction_count: null,
    low_sale_price: null,
    high_sale_price: null,
    market_price: null,
  };
}

// Monday, July 6 2026, constructed as a LOCAL date.
const REFERENCE_DATE = new Date(2026, 6, 6, 12, 0, 0);

describe("buildVolumeSeries (daily timeframes)", () => {
  it("spans first covered day to last, zero-filling the gaps between", () => {
    const sales = [makeSale("2026-07-06", 3), makeSale("2026-07-02", 1)];

    const series = buildVolumeSeries(sales, "7D", REFERENCE_DATE);

    // Collection starts 07-02, so the series does too — days before the first
    // collected bucket were never observed and must not draw 0 bars.
    expect(series).toHaveLength(5);
    expect(series[0]).toEqual({ date: "2026-07-02", volume: 1, isWeekly: false });
    expect(series.find((p) => p.date === "2026-07-02")?.volume).toBe(1);
    expect(series[series.length - 1]).toEqual({
      date: "2026-07-06",
      volume: 3,
      isWeekly: false,
    });
    // Never forward-filled: days without sales stay at 0.
    expect(series.find((p) => p.date === "2026-07-05")?.volume).toBe(0);
  });

  it("uses only day rows and excludes rows outside the window", () => {
    const sales = [
      makeSale("2026-06-29", 50, "week"), // weekly row ignored in daily mode
      makeSale("2026-06-29", 9), // one day before the 7D window starts
      makeSale("2026-07-01", null), // null quantity treated as 0
      makeSale("2026-07-03", 4),
    ];

    const series = buildVolumeSeries(sales, "7D", REFERENCE_DATE);

    // Trimmed to the covered span 07-01..07-03 (the 06-29 row predates the
    // 7D window, and the weekly row is ignored in daily mode).
    expect(series).toHaveLength(3);
    expect(series.every((p) => !p.isWeekly)).toBe(true);
    expect(series.find((p) => p.date === "2026-07-01")?.volume).toBe(0);
    expect(series.find((p) => p.date === "2026-07-03")?.volume).toBe(4);
    expect(series.reduce((sum, p) => sum + p.volume, 0)).toBe(4);
  });

  it("keeps bucket_date strings timezone-safe (no UTC-midnight shift)", () => {
    // If bucket_date were parsed via new Date("YYYY-MM-DD"), negative-offset
    // timezones would shift this to the previous day and drop the point.
    const sales = [makeSale("2026-07-04", 2)];

    const series = buildVolumeSeries(sales, "1M", REFERENCE_DATE);

    // A single covered day yields a single point on exactly that date.
    expect(series).toEqual([
      { date: "2026-07-04", volume: 2, isWeekly: false },
    ]);
  });

  it("trims at the newest covered day instead of zero-filling to today", () => {
    // Production shape: the scraper stopped two weeks ago. Zero-filling the
    // uncollected tail rendered as a demand collapse; the series must simply
    // end where collection ended.
    const sales = [
      makeSale("2026-06-20", 5),
      makeSale("2026-06-21", 0),
      makeSale("2026-06-22", 4),
    ];

    const series = buildVolumeSeries(sales, "1M", REFERENCE_DATE);

    expect(series[0].date).toBe("2026-06-20"); // first covered day, not the window start
    expect(series[series.length - 1]).toEqual({
      date: "2026-06-22",
      volume: 4,
      isWeekly: false,
    });
    expect(series.some((p) => p.date > "2026-06-22")).toBe(false);
  });

  it("keeps zero-filling gaps BETWEEN covered days", () => {
    // TCGPlayer writes explicit zero buckets, so a no-sales day inside the
    // collected range is real data and must still render as a 0 bar.
    const sales = [
      makeSale("2026-07-01", 6),
      makeSale("2026-07-02", 0),
      makeSale("2026-07-04", 3),
    ];

    const series = buildVolumeSeries(sales, "7D", REFERENCE_DATE);

    expect(series.map((p) => p.date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
    expect(series.map((p) => p.volume)).toEqual([6, 0, 0, 3]);
  });

  it("does not fabricate zero bars before collection started", () => {
    // A product whose history begins inside the window: the days before its
    // first bucket were never collected, so they must not render as 0 sales.
    const sales = [makeSale("2026-07-04", 7), makeSale("2026-07-05", 2)];

    const series = buildVolumeSeries(sales, "1M", REFERENCE_DATE);

    expect(series[0].date).toBe("2026-07-04");
    expect(series.some((p) => p.date < "2026-07-04")).toBe(false);
    expect(series).toHaveLength(2);
  });

  it("returns an empty series when nothing in the window is covered", () => {
    expect(buildVolumeSeries([], "1M", REFERENCE_DATE)).toEqual([]);
    // Day rows exist, but all of them predate the window.
    expect(
      buildVolumeSeries([makeSale("2026-01-05", 9)], "1M", REFERENCE_DATE)
    ).toEqual([]);
    // 7D with only weekly rows: nothing to render.
    expect(
      buildVolumeSeries([makeSale("2026-06-29", 40, "week")], "7D", REFERENCE_DATE)
    ).toEqual([]);
  });
});

describe("buildVolumeSeries (weekly timeframes)", () => {
  it("buckets by Monday week-start from the window start to the last covered week", () => {
    const sales = [
      makeSale("2026-01-05", 3, "week"),
      makeSale("2026-07-06", 9, "week"),
    ];

    const series = buildVolumeSeries(sales, "6M", REFERENCE_DATE);

    // 180-day range starts 2026-01-08 (Thu); the week bucket for Monday
    // 2026-01-05 is clamped to the window start so the chart merge keeps it.
    expect(series[0].date).toBe("2026-01-08");
    expect(series[series.length - 1].date).toBe("2026-07-06");
    expect(series).toHaveLength(27);
    expect(series.every((p) => p.isWeekly)).toBe(true);
    // Uncovered weeks between the two covered ones stay at 0.
    expect(series[1].volume).toBe(0);
  });

  it("returns an empty series when no week in the range has data", () => {
    expect(buildVolumeSeries([], "6M", REFERENCE_DATE)).toEqual([]);
  });

  it("trims trailing weeks with no data at all", () => {
    // Weekly rows stop three weeks before today.
    const sales = [
      makeSale("2026-06-08", 10, "week"),
      makeSale("2026-06-15", 12, "week"),
    ];

    const series = buildVolumeSeries(sales, "3M", REFERENCE_DATE);

    expect(series[series.length - 1]).toEqual({
      date: "2026-06-15",
      volume: 12,
      isWeekly: true,
    });
    expect(series.some((p) => p.date > "2026-06-15")).toBe(false);
  });

  it("takes the larger of day-row sum and week row within a week", () => {
    const sales = [
      // Week of 2026-06-22: partial day coverage (7) must not shadow the
      // complete week row (99) — the boundary week of daily coverage.
      makeSale("2026-06-23", 2),
      makeSale("2026-06-24", 5),
      makeSale("2026-06-22", 99, "week"),
      // Week of 2026-06-29: only the week row exists.
      makeSale("2026-06-29", 12, "week"),
      // Week of 2026-06-08: fully-covered day rows exceed a stale week row.
      makeSale("2026-06-08", 4),
      makeSale("2026-06-09", 4),
      makeSale("2026-06-08", 5, "week"),
    ];

    const series = buildVolumeSeries(sales, "1Y", REFERENCE_DATE);

    expect(series.find((p) => p.date === "2026-06-22")?.volume).toBe(99);
    expect(series.find((p) => p.date === "2026-06-29")?.volume).toBe(12);
    expect(series.find((p) => p.date === "2026-06-08")?.volume).toBe(8);
    // Weeks with no rows at all are zero-filled, never forward-filled.
    expect(series.find((p) => p.date === "2026-06-15")?.volume).toBe(0);
  });

  it("assigns day rows to their Monday-start week", () => {
    // 2026-07-05 is a Sunday: it belongs to the week starting Monday 2026-06-29.
    const sales = [makeSale("2026-07-05", 6)];

    const series = buildVolumeSeries(sales, "6M", REFERENCE_DATE);

    expect(series.find((p) => p.date === "2026-06-29")?.volume).toBe(6);
    // Nothing covers the current week, so the series stops at 2026-06-29
    // rather than emitting a zero bar for it.
    expect(series[series.length - 1].date).toBe("2026-06-29");
    expect(series.find((p) => p.date === "2026-07-06")).toBeUndefined();
  });
});
