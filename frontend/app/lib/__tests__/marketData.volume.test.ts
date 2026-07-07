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
  it("zero-fills missing days across the full window", () => {
    const sales = [makeSale("2026-07-06", 3), makeSale("2026-07-02", 1)];

    const series = buildVolumeSeries(sales, "7D", REFERENCE_DATE);

    expect(series).toHaveLength(7);
    expect(series[0]).toEqual({ date: "2026-06-30", volume: 0, isWeekly: false });
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

    expect(series).toHaveLength(7);
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

    expect(series).toHaveLength(30);
    expect(series.find((p) => p.date === "2026-07-04")?.volume).toBe(2);
    expect(series.find((p) => p.date === "2026-07-03")?.volume).toBe(0);
  });

  it("returns an all-zero series for empty input", () => {
    const series = buildVolumeSeries([], "1M", REFERENCE_DATE);

    expect(series).toHaveLength(30);
    expect(series.every((p) => p.volume === 0 && !p.isWeekly)).toBe(true);
  });
});

describe("buildVolumeSeries (weekly timeframes)", () => {
  it("buckets by Monday week-start, covering the whole range", () => {
    const series = buildVolumeSeries([], "6M", REFERENCE_DATE);

    // 180-day range starts 2026-01-08 (Thu); the week bucket for Monday
    // 2026-01-05 is clamped to the window start so the chart merge keeps it.
    expect(series[0].date).toBe("2026-01-08");
    expect(series[series.length - 1].date).toBe("2026-07-06");
    expect(series).toHaveLength(27);
    expect(series.every((p) => p.isWeekly)).toBe(true);
    expect(series.every((p) => p.volume === 0)).toBe(true);
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
    expect(series.find((p) => p.date === "2026-07-06")?.volume).toBe(0);
  });
});
