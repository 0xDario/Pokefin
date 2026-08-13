import { isPriceFresh } from "./marketPulse";

/**
 * The one place that decides whether a product has a current price.
 *
 * Before this module the rule lived at roughly fifteen call sites, and the
 * recurring defect was never the rule itself — it was one site applying a
 * check the evidence did not support, or a sibling site not applying it at
 * all. Two guards would then disagree about the same product on the same day.
 *
 * So a caller does not choose a check. It states WHAT EVIDENCE IT HAS, and
 * this module decides. That makes the specific mistake that kept happening —
 * comparing a value against a timestamp read at a different moment —
 * impossible to express.
 */

/**
 * What a caller knows about when a product's price was last recorded.
 *
 * `none`        No freshness signal exists. A pre-0023 RPC returns no
 *               price_recorded_at at all; blanking the whole catalog because
 *               the database is behind on migrations is a worse failure than
 *               the staleness being guarded, so the price passes through.
 *
 * `unavailable` A freshness lookup was attempted and failed. Not the same as
 *               `none`: no verdict was reached, so nothing is published.
 *
 * `timestamp`   The date the price was last recorded, read SEPARATELY from the
 *               price itself — a live history query beside a cached summary,
 *               say. Only the date can be checked. Comparing values across
 *               that gap would fail on every ordinary scraper update, because
 *               the two sides are simply from different moments.
 *
 * `snapshot`    The date AND the value, read together. This is the only
 *               evidence that supports comparing them, and comparing them is
 *               what catches a products-table update that failed after its
 *               history row was already written — leaving a fresh timestamp
 *               attached to an old value.
 */
export type PriceEvidence =
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "timestamp"; recordedAt: string | null | undefined }
  | {
      kind: "snapshot";
      recordedAt: string | null | undefined;
      recordedPrice: number | null | undefined;
    };

export type PriceVerdict = {
  /** The price to publish, or null when there is no current price. */
  usdPrice: number | null;
  /**
   * When the price was last recorded. Deliberately survives a withheld price
   * so a caller can still say when the product was last priced.
   */
  priceRecordedAt: string | null;
  /**
   * Whether anything derived from the current price may be published. Read it
   * through derivedFromPrice rather than by hand, so the answer cannot be
   * applied to one derived value and forgotten on its neighbour.
   */
  hasCurrentPrice: boolean;
};

function verdict(
  usdPrice: number | null,
  priceRecordedAt: string | null
): PriceVerdict {
  return { usdPrice, priceRecordedAt, hasCurrentPrice: usdPrice !== null };
}

/**
 * Resolve a product's current price from a cached/stored value plus whatever
 * freshness evidence the caller actually has.
 *
 * `referenceDate` exists for charting a past day and for tests; it defaults to
 * now, which is what every live caller wants.
 */
export function resolvePrice(
  storedPrice: number | null | undefined,
  evidence: PriceEvidence,
  referenceDate?: Date
): PriceVerdict {
  const price =
    typeof storedPrice === "number" && !Number.isNaN(storedPrice)
      ? storedPrice
      : null;

  if (evidence.kind === "unavailable") return verdict(null, null);
  if (evidence.kind === "none") return verdict(price, null);

  const recordedAt = evidence.recordedAt ?? null;

  // Only a same-read pair can be compared. See the `timestamp` note above.
  if (evidence.kind === "snapshot") {
    const recordedPrice = evidence.recordedPrice ?? null;
    // Object.is, not ===, so a null on either side cannot pass as a match.
    // Mirrors IS NOT DISTINCT FROM in migration 0023.
    if (!Object.is(price, recordedPrice)) return verdict(null, recordedAt);
  }

  if (price === null) return verdict(null, recordedAt);
  return verdict(
    isPriceFresh(recordedAt, referenceDate) ? price : null,
    recordedAt
  );
}

/**
 * Publish a value derived from the current price, or withhold it.
 *
 * Every return, price/day, CAGR, NAV and portfolio total is anchored on the
 * current price, so withholding the price while publishing something computed
 * from it replaces one wrong number with several. The thunk is not evaluated
 * when the price is withheld, so an expensive derivation costs nothing in the
 * case where its result would be thrown away.
 *
 * NOT for values computed from the recorded series alone — volatility,
 * drawdown, trend. Those stay true descriptions of the history however old its
 * last point is, and 0023 deliberately leaves them ungated.
 */
export function derivedFromPrice<T>(
  source: PriceVerdict | { usd_price: number | null | undefined },
  compute: () => T
): T | null {
  return hasCurrentPrice(source) ? compute() : null;
}

/**
 * Whether a product carries a current price. Accepts either a verdict or an
 * already-guarded product, so consumers downstream of a producer do not have
 * to know which they are holding.
 */
export function hasCurrentPrice(
  source: PriceVerdict | { usd_price: number | null | undefined }
): boolean {
  if ("hasCurrentPrice" in source) return source.hasCurrentPrice;
  return source.usd_price !== null && source.usd_price !== undefined;
}
