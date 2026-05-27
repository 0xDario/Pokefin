/**
 * Shared numeric / string validation helpers.
 *
 * These bounds intentionally mirror the DB CHECK constraints in
 * migrations/0003_integrity_constraints.sql and
 * migrations/0008_box_recipes_rls_hardening.sql so the client and DB
 * agree, but the DB stays the authority.
 */

export const QUANTITY_MIN = 1;
export const QUANTITY_MAX = 100_000;
export const PRICE_MIN = 0;
export const PRICE_MAX = 1_000_000;
export const NOTES_MAX_LEN = 1_000;
export const RECIPE_NAME_MAX_LEN = 200;
export const RECIPE_PACKS_MAX = 50;

export function isFiniteInRange(
  n: unknown,
  min: number,
  max: number
): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}

export function isValidQuantity(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= QUANTITY_MIN &&
    n <= QUANTITY_MAX
  );
}

export function isValidPrice(n: unknown): n is number {
  return isFiniteInRange(n, PRICE_MIN, PRICE_MAX);
}

export function clampNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, NOTES_MAX_LEN);
}

/**
 * ISO date string YYYY-MM-DD that is not in the future.
 */
export function isValidPastDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  return d.getTime() <= todayUtc.getTime();
}

/**
 * Strip ASCII control characters (0x00-0x1F, 0x7F) which are never
 * valid in user-supplied tokens we then route on.
 */
export function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]/g, "");
}
