import {
  PriceHistoryEntry,
  SalesHistoryEntry,
} from "../components/ProductPrices/types";

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

// Date-only strings must be parsed by splitting, never new Date("YYYY-MM-DD"),
// which is UTC midnight and shifts a day in negative-offset timezones.
function parseLocalDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toLocalDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toUtcDateKey(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The date part of a product_price_history.recorded_at value.
 *
 * recorded_at is `timestamp without time zone` written by the scraper from
 * datetime.now(timezone.utc), so its date part is a UTC date key. It is taken
 * by string split rather than by new Date(...): the value carries no offset,
 * so parsing it would attach the runtime's local zone and shift the day.
 * Null for anything that is not a leading YYYY-MM-DD.
 */
function toRecordedDateKey(recordedAt: string | null | undefined): string | null {
  if (!recordedAt) return null;
  const dateKey = recordedAt.split("T")[0].split(" ")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : null;
}

/**
 * Whether a recorded price is recent enough to present as the current price.
 *
 * The freshness signal is deliberately the newest product_price_history row
 * for the product, never products.last_updated. That product-level field is
 * nullable for products that have never priced and is not itself an auditable
 * price event; the history row is the evidence that this exact value was
 * recorded. Failed upstream lookups write neither field, so only the history
 * also preserves the price series the guard is meant to judge.
 *
 * Mirrors the guard in migrations/0023_price_freshness_guard.sql, which
 * applies the identical rule to get_market_product_summaries — otherwise the
 * catalog and /product/[id] would contradict each other for the same product.
 * Keep both sides in sync.
 */
export function isPriceFresh(
  recordedAt: string | null | undefined,
  referenceDate: Date = new Date()
): boolean {
  const recordedDateKey = toRecordedDateKey(recordedAt);
  if (recordedDateKey === null) return false;

  const oldestAllowed = toUtcDateKey(
    new Date(
      Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate() - PRICE_STALENESS_TOLERANCE_DAYS
      )
    )
  );
  return recordedDateKey >= oldestAllowed;
}

/**
 * The newest recorded_at in a price history, or null for an empty history.
 * groupHistoryRowsByProduct sorts ascending, but this scans rather than
 * trusting that: callers pass histories from several query paths.
 */
export function getLatestPriceRecordedAt(
  history: PriceHistoryEntry[] | null | undefined
): string | null {
  if (!history || history.length === 0) return null;

  let newest: string | null = null;
  for (const entry of history) {
    const dateKey = toRecordedDateKey(entry.recorded_at);
    if (dateKey === null) continue;
    if (newest === null || entry.recorded_at > newest) {
      newest = entry.recorded_at;
    }
  }
  return newest;
}

/**
 * A price to render, or null when there is nothing current to show.
 *
 * Null — meaning "unknown", not "free" — is what callers turn into "--", the
 * same treatment the volume and listings metrics give stale data. A price that
 * is merely non-null is not enough: six active products currently return no
 * TCGPlayer sales history, and two of them still carry the last price
 * that ever scraped successfully (55 and 95 days old as of 2026-08-11), which
 * without this guard renders as today's market price.
 */
export function getFreshUsdPrice(
  usdPrice: number | null | undefined,
  recordedAt: string | null | undefined,
  referenceDate: Date = new Date()
): number | null {
  if (usdPrice === null || usdPrice === undefined || Number.isNaN(usdPrice)) {
    return null;
  }
  return isPriceFresh(recordedAt, referenceDate) ? usdPrice : null;
}

/**
 * Whether a listings snapshot is recent enough to describe the market now.
 *
 * Supply metrics have no equivalent of the sales-window hole/staleness checks
 * — there is exactly one row to look at — so without this a stalled scraper
 * would keep presenting the last snapshot as current, and days-of-supply
 * would be derived from it.
 */
export function isListingsSnapshotFresh(
  snapshotDate: string | null | undefined,
  referenceDate: Date = new Date()
): boolean {
  if (!snapshotDate) return false;

  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const oldestAllowed = toLocalDateKey(
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - LISTINGS_STALENESS_TOLERANCE_DAYS
    )
  );
  return snapshotDate >= oldestAllowed;
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

// TCGPlayer writes explicit zero buckets, so a MISSING day row means "no data
// collected", never "nothing sold". The current-day bucket is partial and the
// scraper runs once a day, so the newest bucket normally trails today by a day
// or two — anything beyond that tolerance means daily coverage has stopped and
// a window sum would silently undercount.
// Mirror of the staleness guard in migrations/0018_volume_staleness_guard.sql,
// which applies the identical rule to the RPC that feeds /market and /prices —
// otherwise those pages and /product/[id] contradict each other for the same
// product. TCGPlayer's current-day bucket is partial and the scraper visits
// each product about once a day, so a few days of lag is normal operation.
// Keep both sides in sync.
const DAILY_DATA_STALENESS_TOLERANCE_DAYS = 3;

// Mirror of the prior_day_coverage rule in
// migrations/0017_volume_prior_window_coverage.sql: the exact daily sum is only
// preferred over the scaled weekly estimate once daily rows cover at least this
// many of the 30 days in the prior window. Keep both sides in sync.
const PRIOR_WINDOW_MIN_DAY_COVERAGE = 28;

// Listings are snapshotted once per product per day, so the newest snapshot
// normally trails today by a day at most. Beyond this the depth on screen is
// no longer describing the market a buyer would see. Mirrors the guard in
// migrations/0022_listings_freshness_guard.sql — keep both sides in sync.
const LISTINGS_STALENESS_TOLERANCE_DAYS = 3;

// A price is a far slower signal than a daily volume bucket, so it gets a far
// wider tolerance than the 3 days above. The scraper re-prices each product at
// most once per 23h, so a healthy product gains a history row about daily and
// single missed days are routine (a skipped cron tick, a rate limit, one 5xx);
// blanking the catalog on those would hide data that is still a fair
// description of the market, since sealed prices move on the order of
// percent-per-week. Two full weeks with nothing recorded cannot be a blip — it
// means the product is not currently producing usable price data. 14 also
// keeps a rendered
// price inside half of the shortest return window on screen (1M / 30 days), so
// a price can never be more than half its own return window out of date.
// Mirror of the guard in migrations/0023_price_freshness_guard.sql, which
// applies the identical rule to get_market_product_summaries and to the
// price_per_day input of get_set_analytics. Keep both sides in sync.
const PRICE_STALENESS_TOLERANCE_DAYS = 14;

// The prior window's weekly fallback range (today-63 .. today-36) is 28 days,
// i.e. exactly four Monday-anchored buckets. Mirrors the same requirement in
// migrations/0021_volume_freshness_and_weekly_coverage.sql.
const PRIOR_WINDOW_WEEK_BUCKETS = 4;

/**
 * Sum quantity_sold over granularity='day' rows inside the local-date window
 * [today - offsetDays - days + 1, today - offsetDays].
 *
 * Returns null — meaning "unknown", not "zero" — when the daily data does not
 * actually cover the window:
 *   (a) no day row with a real quantity falls inside the window, or
 *   (b) the newest day bucket anywhere in the array is more than
 *       DAILY_DATA_STALENESS_TOLERANCE_DAYS older than the window end, so the
 *       window is only partially collected, or
 *   (c) there is a hole inside the collected span (a skipped bucket or a
 *       partial upsert), which would otherwise pass as a complete window.
 * A product younger than the window still reports its lifetime total: there is
 * deliberately no "window start must be covered" condition.
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
  let newestDayKey: string | null = null;
  // Only buckets carrying an actual quantity count as collected. A NULL
  // quantity is what parse_daily_sales_buckets writes for a malformed or
  // negative value from TCGPlayer, i.e. "unknown" — treating it as 0 would
  // understate the window while making it look fully covered. Mirrors SQL
  // SUM(), which skips NULLs.
  const coveredDays = new Set<string>();
  for (const row of dayRows) {
    // Freshness is measured from buckets that carry a real quantity. A row
    // whose quantity failed to parse means the day was visited but its value
    // is unknown, so letting its date advance newestDayKey would make a run
    // of unusable trailing buckets look like fresh collection and let a stale
    // partial sum publish as complete.
    if (row.quantity_sold === null) continue;
    if (newestDayKey === null || row.bucket_date > newestDayKey) {
      newestDayKey = row.bucket_date;
    }
    if (row.bucket_date >= startKey && row.bucket_date <= endKey) {
      total += row.quantity_sold;
      coveredDays.add(row.bucket_date);
    }
  }

  // (a) nothing usable collected inside the window at all.
  if (coveredDays.size === 0) return null;

  // (b) daily collection stopped before the window ended.
  const freshestAllowedKey = toLocalDateKey(
    new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate() - DAILY_DATA_STALENESS_TOLERANCE_DAYS
    )
  );
  if (newestDayKey === null || newestDayKey < freshestAllowedKey) return null;

  // (c) a hole inside the collected span — a skipped API bucket or a partial
  // upsert would otherwise pass as a complete window and understate it. The
  // span is measured between the window's own first and last collected day,
  // not across the whole window, so a product younger than the window still
  // reports its lifetime total (there is deliberately no start-coverage rule).
  const keys = [...coveredDays].sort();
  const spanDays =
    Math.round(
      (parseLocalDateKey(keys[keys.length - 1]).getTime() -
        parseLocalDateKey(keys[0]).getTime()) /
        86_400_000
    ) + 1;
  if (coveredDays.size !== spanDays) return null;

  return total;
}

/**
 * Count distinct day buckets carrying an actual quantity inside the window.
 * Rows are unique per (product, bucket_date, granularity) in the DB, so this
 * matches the SQL COUNT(*) FILTER (... AND quantity_sold IS NOT NULL) used by
 * the RPC. Counting null-quantity rows here would let an all-null window look
 * fully covered on this side while the SQL sum came back NULL.
 */
function countDayCoverage(
  sales: SalesHistoryEntry[],
  days: number,
  offsetDays: number,
  referenceDate: Date
): number {
  const endDate = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate() - offsetDays
  );
  const startKey = toLocalDateKey(
    new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate() - days + 1
    )
  );
  const endKey = toLocalDateKey(endDate);

  const covered = new Set<string>();
  for (const row of sales) {
    if (row.granularity !== "day") continue;
    if (row.quantity_sold === null) continue;
    if (row.bucket_date >= startKey && row.bucket_date <= endKey) {
      covered.add(row.bucket_date);
    }
  }
  return covered.size;
}

/**
 * Units sold in the prior-30d window (days 30-59 back). Daily rows only
 * reach ~30 days back at launch, so when they don't cover that window this
 * falls back to the backfilled Monday-anchored week rows: the four buckets
 * spanning roughly days 36-63 back, scaled from 28 to 30 days.
 *
 * Source preference mirrors migrations/0017_volume_prior_window_coverage.sql
 * exactly: the exact daily sum wins only when daily rows cover at least
 * PRIOR_WINDOW_MIN_DAY_COVERAGE days of the window, otherwise the weekly
 * estimate does. Taking the larger of the two (the old rule) inflated the
 * denominator once daily coverage grew, because the 28->30 day scaling makes
 * the weekly estimate exceed the exact sum for roughly half the catalog.
 */
export function getPriorUnitsSold30d(
  sales: SalesHistoryEntry[],
  referenceDate: Date = new Date()
): number | null {
  const daySum = getUnitsSoldWindow(sales, 30, 30, referenceDate);
  const dayCoverage = countDayCoverage(sales, 30, 30, referenceDate);

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
  const weekBuckets = new Set<string>();
  for (const row of sales) {
    if (row.granularity !== "week") continue;
    if (row.quantity_sold === null) continue;
    if (row.bucket_date >= startKey && row.bucket_date <= endKey) {
      weekTotal += row.quantity_sold;
      weekBuckets.add(row.bucket_date);
    }
  }
  // The 28-day window spans exactly four Mondays, and the sum is scaled 30/28
  // on that basis. With a bucket missing — an interrupted annual backfill, a
  // failed upsert, a null quantity — scaling anyway would understate the
  // trend denominator and inflate the trend. Require all four.
  const weekSum =
    weekBuckets.size === PRIOR_WINDOW_WEEK_BUCKETS
      ? Math.round((weekTotal * 30) / 28)
      : null;

  // Prefer the exact source over the larger one (see the CASE in 0017).
  if (daySum !== null && dayCoverage >= PRIOR_WINDOW_MIN_DAY_COVERAGE) {
    return daySum;
  }
  return weekSum ?? daySum;
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
