import { SalesHistoryEntry } from "../components/ProductPrices/types";

export type PulseSignal =
  | "demand_surge"
  | "thin_supply"
  | "distribution"
  | "cooling";

export type PulseTone = "gain" | "loss" | "warn" | "neutral";

export interface PulseSignalMeta {
  label: string;
  description: string;
  tone: PulseTone;
}

export const PULSE_SIGNAL_META: Record<PulseSignal, PulseSignalMeta> = {
  demand_surge: {
    label: "Demand surge",
    description: "Price and volume rising together — buyout pressure",
    tone: "gain",
  },
  thin_supply: {
    label: "Thin supply",
    description: "Price rising on falling volume — few boxes changing hands",
    tone: "warn",
  },
  distribution: {
    label: "Distribution",
    description: "Heavy selling into a falling price — supply hitting the market",
    tone: "loss",
  },
  cooling: {
    label: "Cooling off",
    description: "Price and volume both declining — interest fading",
    tone: "neutral",
  },
};

const PRICE_THRESHOLD_PCT = 2;
const VOLUME_THRESHOLD_PCT = 20;

function toLocalDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Percent change of the current window vs the prior window.
 * Null when either input is null or the prior window is 0 (no baseline).
 */
export function getVolumeTrendPercent(
  current: number | null,
  prior: number | null
): number | null {
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

/**
 * How many days the currently listed quantity would last at the trailing
 * 30-day sales rate. Null when inputs are null or nothing sold in 30 days.
 */
export function getDaysOfSupply(
  totalQuantityAvailable: number | null,
  unitsSold30d: number | null
): number | null {
  if (
    totalQuantityAvailable === null ||
    unitsSold30d === null ||
    unitsSold30d === 0
  ) {
    return null;
  }
  return totalQuantityAvailable / (unitsSold30d / 30);
}

/**
 * Sum quantity_sold over granularity='day' rows inside the local-date window
 * [today - offsetDays - days + 1, today - offsetDays]. Returns null when the
 * sales array has no day rows at all (no daily data yet), and 0 when day rows
 * exist but none fall inside the window.
 */
export function getUnitsSoldWindow(
  sales: SalesHistoryEntry[],
  days: number,
  offsetDays = 0,
  referenceDate: Date = new Date()
): number | null {
  const dayRows = sales.filter((entry) => entry.granularity === "day");
  if (dayRows.length === 0) return null;

  const endDate = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate() - offsetDays
  );
  const startDate = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate() - days + 1
  );
  const startKey = toLocalDateKey(startDate);
  const endKey = toLocalDateKey(endDate);

  let total = 0;
  for (const row of dayRows) {
    if (row.bucket_date >= startKey && row.bucket_date <= endKey) {
      total += row.quantity_sold ?? 0;
    }
  }
  return total;
}

/**
 * Units sold in the prior-30d window (days 30-59 back). Daily rows only
 * reach ~30 days back at launch, so when they don't cover that window this
 * falls back to the backfilled Monday-anchored week rows: the four buckets
 * spanning roughly days 36-63 back, scaled from 28 to 30 days. Mirrors the
 * same fallback in the get_market_product_volume_metrics() RPC; the larger
 * of the two estimates wins because each source can only undercount.
 */
export function getPriorUnitsSold30d(
  sales: SalesHistoryEntry[],
  referenceDate: Date = new Date()
): number | null {
  const daySum = getUnitsSoldWindow(sales, 30, 30, referenceDate);

  const startKey = toLocalDateKey(
    new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate() - 63
    )
  );
  const endKey = toLocalDateKey(
    new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate() - 36
    )
  );

  let weekTotal = 0;
  let weekRowsInWindow = 0;
  for (const row of sales) {
    if (row.granularity !== "week") continue;
    if (row.bucket_date >= startKey && row.bucket_date <= endKey) {
      weekTotal += row.quantity_sold ?? 0;
      weekRowsInWindow += 1;
    }
  }
  const weekSum =
    weekRowsInWindow > 0 ? Math.round((weekTotal * 30) / 28) : null;

  if (daySum !== null && weekSum !== null) return Math.max(daySum, weekSum);
  return daySum ?? weekSum;
}

/**
 * Classify the price/volume regime over the last 30 days. Both inputs are
 * percentages; null inputs (or a below-threshold combination) give null.
 */
export function getPulseSignal(
  priceReturn30dPct: number | null,
  volumeTrendPct: number | null
): PulseSignal | null {
  if (priceReturn30dPct === null || volumeTrendPct === null) return null;

  const priceUp = priceReturn30dPct >= PRICE_THRESHOLD_PCT;
  const priceDown = priceReturn30dPct <= -PRICE_THRESHOLD_PCT;
  const volumeUp = volumeTrendPct >= VOLUME_THRESHOLD_PCT;
  const volumeDown = volumeTrendPct <= -VOLUME_THRESHOLD_PCT;

  if (priceUp && volumeUp) return "demand_surge";
  if (priceUp && volumeDown) return "thin_supply";
  if (priceDown && volumeUp) return "distribution";
  if (priceDown && volumeDown) return "cooling";
  return null;
}
