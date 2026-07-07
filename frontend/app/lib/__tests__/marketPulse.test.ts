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
    const sales = [
      makeSale("2026-07-06", 3),
      makeSale("2026-07-01", 2),
      makeSale("2026-06-30", 4),
      // Outside a 7-day window ending 2026-07-06 (starts 2026-06-30).
      makeSale("2026-06-29", 100),
    ];

    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBe(9);
  });

  it("applies offsetDays to shift the window into the past", () => {
    const sales = [
      makeSale("2026-07-06", 3),
      makeSale("2026-06-05", 7),
      makeSale("2026-05-20", 5),
    ];

    // Prior 30d window: 2026-05-08 .. 2026-06-06.
    expect(getUnitsSoldWindow(sales, 30, 30, REFERENCE_DATE)).toBe(12);
  });

  it("ignores week rows and treats null quantities as zero", () => {
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

  it("returns 0 when day rows exist but none fall in the window", () => {
    const sales = [makeSale("2026-01-01", 8)];
    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBe(0);
  });
});

describe("getPriorUnitsSold30d", () => {
  // Prior-30d window for REFERENCE_DATE (2026-07-06): 2026-05-08..2026-06-06.
  // Weekly fallback window: bucket_date in 2026-05-04..2026-05-31.

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

    // Math.max(day sum 0, round(28 * 30/28)) = 30.
    expect(getPriorUnitsSold30d(sales, REFERENCE_DATE)).toBe(30);
  });

  it("prefers the larger of day sum and week approximation", () => {
    const sales = [
      // Full day coverage of the prior window summing to 50.
      makeSale("2026-05-20", 25),
      makeSale("2026-06-01", 25),
      // Week rows in the fallback window summing to 14 -> scaled 15.
      makeSale("2026-05-11", 7, "week"),
      makeSale("2026-05-18", 7, "week"),
    ];

    expect(getPriorUnitsSold30d(sales, REFERENCE_DATE)).toBe(50);
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
