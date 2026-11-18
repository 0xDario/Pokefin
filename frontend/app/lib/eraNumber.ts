/**
 * Era set numbers: SV1, SV3.5, SWSH12.5, ME2.5 and so on, stored in
 * sets.era_number (migration 0026). Main-series sets get a whole number in
 * release order within their era; special expansions get the number of the
 * main set they follow plus .5.
 */

// An era number as people type it: prefix, optional space or dash, optional
// leading zeros, optional ".5". Matches "sv3.5", "SV 3.5", "sv03.5", "swsh-12.5".
const ERA_QUERY_PATTERN = /^(xy|sm|swsh|sv|me)[\s-]*0*(\d{1,2})(\.5)?$/i;

/**
 * Canonical form of a typed era number ("sv03.5" -> "SV3.5"), or null when the
 * text is not shaped like one.
 */
export function normalizeEraNumber(input: string): string | null {
  const match = ERA_QUERY_PATTERN.exec(input.trim());
  if (!match) return null;
  const [, prefix, number, half] = match;
  return `${prefix.toUpperCase()}${Number(number)}${half ?? ""}`;
}

/**
 * Whether a set's era number answers the search term.
 *
 * A term shaped like an era number matches exactly, so "SV1" finds Scarlet &
 * Violet only and not SV10 or SV10.5. Anything else falls back to a substring
 * match, so a bare "swsh" or "sv" still lists the whole era.
 */
export function eraNumberMatches(
  eraNumber: string | null | undefined,
  searchTerm: string
): boolean {
  if (!eraNumber) return false;
  const normalized = normalizeEraNumber(searchTerm);
  if (normalized) return eraNumber.toUpperCase() === normalized;
  return eraNumber.toLowerCase().includes(searchTerm.trim().toLowerCase());
}
