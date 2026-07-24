/**
 * Comparators for the Market View table.
 *
 * Kept in a plain module (no JSX, no Recharts) so the null-handling rules can
 * be unit tested without rendering the table.
 */

export type SortDirection = "asc" | "desc";

/** A cell value the table can sort on. `null` means "no data" (rendered "--"). */
export type SortValue = number | string | null;

/**
 * `null` and `NaN` both render as "--", so both must sort as "missing".
 */
export function isMissingSortValue(value: SortValue): boolean {
  return value === null || (typeof value === "number" && Number.isNaN(value));
}

/**
 * Compares two present (non-missing) values. Strings compare with
 * `localeCompare`, numbers numerically. Always ascending — direction is
 * applied by `compareSortValues`.
 */
function comparePresentValues(valueA: number | string, valueB: number | string): number {
  if (typeof valueA === "string" || typeof valueB === "string") {
    return String(valueA).localeCompare(String(valueB));
  }
  return valueA - valueB;
}

/**
 * Direction-aware comparator that always sinks missing values to the bottom.
 *
 * The missing-vs-present decision is resolved BEFORE the ascending/descending
 * flip is applied. Resolving it afterwards (the old behaviour) inverted the
 * sink for descending sorts, so every descending column led with a block of
 * "--" rows — which is what "Vol (30d)", "Vol Δ" and "1Y" all did.
 */
export function compareSortValues(
  valueA: SortValue,
  valueB: SortValue,
  direction: SortDirection
): number {
  const missingA = isMissingSortValue(valueA);
  const missingB = isMissingSortValue(valueB);

  if (missingA && missingB) return 0;
  if (missingA) return 1;
  if (missingB) return -1;

  const base = comparePresentValues(
    valueA as number | string,
    valueB as number | string
  );
  return direction === "asc" ? base : -base;
}

/**
 * Default direction for a freshly clicked column header. Columns where a
 * *smaller* number is the "better"/more interesting value open ascending.
 */
export function getDefaultSortDirection(key: string): SortDirection {
  if (key === "product" || key === "set") return "asc";
  if (key === "days_since_release") return "asc";
  if (key === "max_drawdown" || key === "volatility_30d") return "asc";
  return "desc";
}
