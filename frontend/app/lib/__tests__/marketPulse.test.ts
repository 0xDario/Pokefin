import {
  getDaysOfSupply,
  getPriorUnitsSold30d,
  getPulseSignal,
  getUnitsSoldWindow,
  getVolumeTrendPercent,
  PULSE_SIGNAL_META,
} from "../marketPulse";
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

describe("getVolumeTrendPercent", () => {
  it("computes percent change vs the prior window", () => {
    expect(getVolumeTrendPercent(30, 20)).toBeCloseTo(50, 6);
    expect(getVolumeTrendPercent(10, 20)).toBeCloseTo(-50, 6);
  });

  it("returns null when prior is null or zero", () => {
    expect(getVolumeTrendPercent(30, null)).toBeNull();
    expect(getVolumeTrendPercent(30, 0)).toBeNull();
  });

  it("returns null when current is null", () => {
    expect(getVolumeTrendPercent(null, 20)).toBeNull();
  });
});

describe("getDaysOfSupply", () => {
  it("divides available quantity by the daily sales rate", () => {
    // 60 units at 30 sold/30d = 1/day -> 60 days of supply.
    expect(getDaysOfSupply(60, 30)).toBeCloseTo(60, 6);
    // 10 units at 60 sold/30d = 2/day -> 5 days.
    expect(getDaysOfSupply(10, 60)).toBeCloseTo(5, 6);
  });

  it("returns null for null inputs or zero sales", () => {
    expect(getDaysOfSupply(null, 30)).toBeNull();
    expect(getDaysOfSupply(60, null)).toBeNull();
    expect(getDaysOfSupply(60, 0)).toBeNull();
  });
});

describe("getUnitsSoldWindow", () => {
  it("sums day rows inside the trailing window", () => {
    // Contiguous: TCGPlayer writes an explicit zero bucket on a no-sale day,
    // so a fully-collected window has a row for every date.
    const sales = [
      makeSale("2026-06-30", 4),
      makeSale("2026-07-01", 2),
      makeSale("2026-07-02", 0),
      makeSale("2026-07-03", 0),
      makeSale("2026-07-04", 0),
      makeSale("2026-07-05", 0),
      makeSale("2026-07-06", 3),
      // Outside a 7-day window ending 2026-07-06 (starts 2026-06-30).
      makeSale("2026-06-29", 100),
    ];

    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBe(9);
  });

  it("applies offsetDays to shift the window into the past", () => {
    // Prior 30d window: 2026-05-08 .. 2026-06-06. Fill it contiguously with
    // 1/day, so the expected sum is exactly 30.
    const sales = [makeSale("2026-07-06", 3)];
    for (let d = new Date(2026, 4, 8); d <= new Date(2026, 5, 6); d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      sales.push(makeSale(key, 1));
    }

    expect(getUnitsSoldWindow(sales, 30, 30, REFERENCE_DATE)).toBe(30);
  });

  it("ignores week rows and does not count a null quantity as data", () => {
    const sales = [
      makeSale("2026-07-06", null),
      makeSale("2026-07-05", 2),
      makeSale("2026-07-06", 50, "week"),
    ];

    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBe(2);
  });

  it("returns null when no day rows exist at all", () => {
    expect(getUnitsSoldWindow([], 7, 0, REFERENCE_DATE)).toBeNull();
    expect(
      getUnitsSoldWindow([makeSale("2026-07-06", 12, "week")], 7, 0, REFERENCE_DATE)
    ).toBeNull();
  });

  it("returns null (not 0) when day rows exist but none fall in the window", () => {
    // An absent day bucket means "no data collected" — TCGPlayer writes
    // explicit zero buckets — so this must never read as "nothing sold".
    const sales = [makeSale("2026-01-01", 8)];
    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBeNull();
  });

  it("returns null when daily collection stopped before the window ended", () => {
    // Production state: the scraper's newest day bucket lags the window end by
    // more than the 2-day tolerance, so the 7d sum would silently undercount.
    const sales = [
      makeSale("2026-06-30", 5),
      makeSale("2026-07-01", 4),
      makeSale("2026-07-02", 6),
    ];

    // 7D window is 2026-06-30..2026-07-06; newest bucket 2026-07-02 < 07-04.
    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBeNull();
  });

  it("tolerates a bucket lagging today by up to two days", () => {
    const sales = [
      makeSale("2026-07-01", 4),
      makeSale("2026-07-02", 0),
      makeSale("2026-07-03", 0),
      makeSale("2026-07-04", 6),
    ];

    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBe(10);
  });

  it("returns null when a day is missing from the middle of the window", () => {
    // A skipped API bucket or a partial upsert. Summing the rest would
    // silently understate the window, so report unknown instead.
    const sales = [
      makeSale("2026-07-01", 4),
      // 2026-07-02 never collected
      makeSale("2026-07-03", 5),
      makeSale("2026-07-04", 6),
    ];

    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBeNull();
  });

  it("treats a null quantity as a hole, not a zero", () => {
    // parse_daily_sales_buckets writes NULL for a malformed/negative value.
    // Counting it as 0 would understate the window while looking complete.
    const sales = [
      makeSale("2026-07-01", 4),
      makeSale("2026-07-02", null),
      makeSale("2026-07-03", 5),
      makeSale("2026-07-04", 6),
    ];

    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBeNull();
  });

  it("still reports a lifetime total for a product younger than the window", () => {
    // Only three days of history: there is deliberately no "window start must
    // be covered" condition, so this is a real 3-day total, not null.
    const sales = [
      makeSale("2026-07-04", 2),
      makeSale("2026-07-05", 3),
      makeSale("2026-07-06", 4),
    ];

    expect(getUnitsSoldWindow(sales, 30, 0, REFERENCE_DATE)).toBe(9);
  });

  it("measures staleness against the window end, not today", () => {
    // Prior-30d window ends 2026-06-06. Day rows stop at 2026-07-06, which is
    // fresh relative to that window end, so the sum is trustworthy.
    const sales = [makeSale("2026-06-01", 7), makeSale("2026-07-06", 3)];

    expect(getUnitsSoldWindow(sales, 30, 30, REFERENCE_DATE)).toBe(7);
  });
});

describe("getPriorUnitsSold30d", () => {
  // Prior-30d window for REFERENCE_DATE (2026-07-06): 2026-05-08..2026-06-06.
  // Weekly fallback window: bucket_date in 2026-05-04..2026-05-31.

  /** Consecutive day rows ending 2026-06-06 (the prior-window end). */
  function priorWindowDayRows(count: number, quantity: number) {
    const rows: SalesHistoryEntry[] = [];
    for (let back = count - 1; back >= 0; back -= 1) {
      const d = new Date(2026, 5, 6 - back);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(d.getDate()).padStart(2, "0")}`;
      rows.push(makeSale(key, quantity));
    }
    return rows;
  }

  it("falls back to scaled week rows when day rows don't cover the window", () => {
    const sales = [
      // Day rows exist only for the last 30 days (launch state), so the
      // day-based prior sum is 0.
      makeSale("2026-07-06", 3),
      makeSale("2026-06-15", 2),
      // Four backfilled Monday week buckets inside the fallback window.
      makeSale("2026-05-04", 7, "week"),
      makeSale("2026-05-11", 7, "week"),
      makeSale("2026-05-18", 7, "week"),
      makeSale("2026-05-25", 7, "week"),
      // Outside the fallback window: ignored.
      makeSale("2026-06-01", 100, "week"),
      makeSale("2026-04-27", 100, "week"),
    ];

    // No day coverage of the prior window -> round(28 * 30/28) = 30.
    expect(getPriorUnitsSold30d(sales, REFERENCE_DATE)).toBe(30);
  });

  it("prefers the exact day sum once daily rows cover the whole window", () => {
    const sales = [
      // 30 of 30 prior-window days covered, summing to exactly 30.
      ...priorWindowDayRows(30, 1),
      // Week rows summing to 56 -> scaled 60. The old GREATEST rule would
      // have returned 60 and inflated the trend denominator; coverage is
      // complete, so the exact daily sum must win.
      makeSale("2026-05-04", 14, "week"),
      makeSale("2026-05-11", 14, "week"),
      makeSale("2026-05-18", 14, "week"),
      makeSale("2026-05-25", 14, "week"),
    ];

    expect(getPriorUnitsSold30d(sales, REFERENCE_DATE)).toBe(30);
  });

  it("accepts 28 of 30 covered days as complete enough", () => {
    const sales = [
      ...priorWindowDayRows(28, 1),
      makeSale("2026-05-04", 14, "week"),
      makeSale("2026-05-11", 14, "week"),
      makeSale("2026-05-18", 14, "week"),
      makeSale("2026-05-25", 14, "week"),
    ];

    expect(getPriorUnitsSold30d(sales, REFERENCE_DATE)).toBe(28);
  });

  it("uses the weekly estimate when daily coverage is partial", () => {
    const sales = [
      // Only 10 of 30 days covered, but summing high (100). A partial daily
      // sum must not beat the weekly estimate just because it is larger.
      ...priorWindowDayRows(10, 10),
      makeSale("2026-05-04", 7, "week"),
      makeSale("2026-05-11", 7, "week"),
      makeSale("2026-05-18", 7, "week"),
      makeSale("2026-05-25", 7, "week"),
    ];

    expect(getPriorUnitsSold30d(sales, REFERENCE_DATE)).toBe(30);
  });

  it("uses the partial day sum when there are no week rows at all", () => {
    const sales = priorWindowDayRows(10, 10);

    expect(getPriorUnitsSold30d(sales, REFERENCE_DATE)).toBe(100);
  });

  it("returns null when neither source has data", () => {
    expect(getPriorUnitsSold30d([], REFERENCE_DATE)).toBeNull();
    expect(
      getPriorUnitsSold30d([makeSale("2026-06-01", 5, "week")], REFERENCE_DATE)
    ).toBeNull();
  });
});

describe("getPulseSignal", () => {
  it("classifies each price/volume quadrant", () => {
    expect(getPulseSignal(2, 20)).toBe("demand_surge");
    expect(getPulseSignal(5, -25)).toBe("thin_supply");
    expect(getPulseSignal(-3, 40)).toBe("distribution");
    expect(getPulseSignal(-2, -20)).toBe("cooling");
  });

  it("returns null below the thresholds", () => {
    expect(getPulseSignal(1.99, 50)).toBeNull();
    expect(getPulseSignal(5, 19.99)).toBeNull();
    expect(getPulseSignal(0, 0)).toBeNull();
    expect(getPulseSignal(-1, -19)).toBeNull();
  });

  it("returns null for null inputs", () => {
    expect(getPulseSignal(null, 50)).toBeNull();
    expect(getPulseSignal(5, null)).toBeNull();
    expect(getPulseSignal(null, null)).toBeNull();
  });
});

describe("PULSE_SIGNAL_META", () => {
  it("has label, description, and tone for every signal", () => {
    expect(PULSE_SIGNAL_META.demand_surge.label).toBe("Demand surge");
    expect(PULSE_SIGNAL_META.demand_surge.tone).toBe("gain");
    expect(PULSE_SIGNAL_META.thin_supply.label).toBe("Thin supply");
    expect(PULSE_SIGNAL_META.distribution.label).toBe("Distribution");
    expect(PULSE_SIGNAL_META.cooling.label).toBe("Cooling off");

    for (const meta of Object.values(PULSE_SIGNAL_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(["gain", "loss", "warn", "neutral"]).toContain(meta.tone);
    }
  });
});
