# WP07: One formatting module: dates, timestamps, money

- **Findings covered**
  - F007 (full; cluster members F007, F009, F010, F026): date-only `release_date` values are formatted with the viewer's zone and locale (`toLocaleDateString()` with no options), so release dates show one day early west of UTC, and on `/` the server HTML and the first client render disagree (hydration error).
  - F089 (full; members F089, F102): no shared formatting helpers. Money is `$1649.99` on public pages and `$1,649.99` in the portfolio; date style varies by page and by browser locale.
  - F096 (full; members F096, F112, F115): the dashboard "Last Refreshed" stat is formatted in the server's UTC clock with no zone label; the default grouped catalog card shows a bare `--` for a stale product with no explanation.
  - F072 (full): `ProductCard` builds uncached Intl formatters (`Intl.DateTimeFormat().resolvedOptions()` plus `toLocaleString(undefined, {...})`) on every render of every card.
  - F122 (full): offset-less `recorded_at` timestamps (`timestamp without time zone`, UTC) are parsed with `new Date(raw)`, which reads them as viewer-local time, shifting return windows and sparkline day buckets by the viewer's UTC offset.
- **Priority rationale**: it removes the only hydration error on `/`, fixes a visible wrong fact (release dates one day early) on four pages, and gives WP08, WP09 and WP18 one formatting API to build on instead of each re-inventing it.
- **Effort**: M (6 to 8 hours: one new module plus about 25 mechanical call-site edits, 3 new test files, 3 updated test files).
- **Depends on**: WP00 (for `pnpm build:stub` and the CI job this PR adds a step to). Plays well with WP03 and WP05 landing first (see "Before you start"); does not require them.
- **Unblocks**: WP08, WP09, WP18 (and WP19, WP20 through them).
- **Suggested branch name**: `remediation/wp07-date-money-formatting`
- **Risk level**: medium. Display-only for most edits, but it touches about 25 files, changes visible strings on every page (date style, thousands separators, `C$` on /compare, zone label on "Last Refreshed"), and changes the return-window arithmetic that feeds the 1D/7D figures.

## Why

Set release dates are printed with the browser's own zone and locale: a set released 2026-09-26 reads "9/25/2026" for every Canadian and US visitor on `/`, `/prices`, `/market` and `/compare`, while `/product/[id]` (fixed in commit 2969cd4) says "Sep 26, 2026". On `/` the same text is rendered once on the server (Vercel, UTC, en-US) and again in the browser, so React 19 logs a hydration error and rewrites the dates and the "Updated:" line after load (visible flicker). Money is formatted by hand with `toFixed(2)` on public pages, so a $1,649.99 booster box shows as "$1649.99" next to portfolio values that do have separators, and the dashboard's "Last Refreshed" is a UTC clock time with no zone, which Toronto readers take as local (it can look like a time in the future). Return and sparkline math parses offset-less UTC timestamps as local time, so the 1D figure can measure a 2-day move and sparklines put a row on the wrong day for viewers east of UTC. After this PR every date, timestamp and money string comes from `app/lib/format.ts`, produces the same text on the server and in every browser zone and locale, and a lint rule stops new bare `toLocale*` calls.

## Before you start

Read these files fully first (line numbers are at commit a188fea; WP03/WP05 may shift a few):

- `frontend/app/components/ProductPrices/cards/GroupHeader.tsx` (43 lines; the bug is at :18-20)
- `frontend/app/components/ProductPrices/cards/ProductCard.tsx` (345 lines; :75-83 date/time, :125-226 flat branch, :228-342 grouped branch)
- `frontend/app/components/ProductPrices/hooks/useCurrencyConversion.ts` (81 lines; `formatPrice` :64-71)
- `frontend/app/components/ProductPrices/shared/ReturnMetrics.tsx` (:31-61 `getHistoricalReturn`)
- `frontend/app/components/MarketView/returns.ts` (:24-84), `frontend/app/components/MarketView/MiniSparkline.tsx` (:55-78), `frontend/app/components/MarketView/MarketView.tsx` (:113-142, :443, :494, :615-630)
- `frontend/app/components/PriceChart.tsx` (:84-136 grouping and parsing, :175-190 range fill, :375, :465-485 tooltip, :638-647 Y axis)
- `frontend/app/lib/marketPulse.ts` (:46-104, the documented rule that `recorded_at` is offset-less UTC), `frontend/app/lib/marketData.ts` (:386-393), `frontend/app/lib/serverMarketData.ts` (:205-240)
- `frontend/app/page.tsx` (:17-20 `formatUsd`, :173-192 "Last Refreshed", :298, :310, :319), `frontend/app/product/[id]/page.tsx` (:39-64, :261, :270-281, :291, :420), `frontend/app/stats/page.tsx` (:50-63, :186, :244, :259), `frontend/app/compare/page.tsx` (:201-230, :550-556, :766-783, :896-905, :1037-1057), `frontend/app/privacy/page.tsx` (:9, :15)
- `frontend/app/components/BoxCalculator/BoxCalculator.tsx` (:191, :196, :275-278, :509, :530, :713-717)
- `frontend/app/components/Portfolio/cards/HoldingCard.tsx` (:25-33, :123), `frontend/app/components/Portfolio/shared/PortfolioSummaryCard.tsx` (:16-24, :96-98), `frontend/app/components/Portfolio/shared/ProductSearchSelect.tsx` (:65, :126), `frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx` (:394)
- `frontend/app/components/charts/PortfolioChartImpl.tsx` (:41-49, :99-106, :218-220), `frontend/app/components/charts/AllocationChartImpl.tsx` (:39, :88-95)
- `frontend/eslint.config.mjs`, `.github/workflows/ci.yml`
- Tests you will update: `frontend/app/components/Portfolio/__tests__/HoldingCard.test.tsx` (:272-275), `frontend/app/components/Portfolio/__tests__/PortfolioSummaryCard.test.tsx` (:180-183), `frontend/app/components/MarketView/__tests__/returns.test.ts`

Confirm the starting state (run from `frontend/`):

```bash
# 1. Bare toLocale* calls in app code. Expect 21 hits at a188fea:
#    BoxCalculator.tsx:191,196; GroupHeader.tsx:19; ProductCard.tsx:76,79; PriceChart.tsx:124,186;
#    PortfolioSummaryCard.tsx:20; EditHoldingModal.tsx:64; AddHoldingModal.tsx:85; HoldingCard.tsx:29;
#    MarketView.tsx:115; AllocationChartImpl.tsx:91; PortfolioChartImpl.tsx:45,102; stats/page.tsx:52;
#    page.tsx:185,298; compare/page.tsx:229,554; product/[id]/page.tsx:50.
#    If WP05 landed, EditHoldingModal/AddHoldingModal are gone from this list and app/lib/validation.ts
#    (PRICE_MESSAGE, PRICE_MAX.toLocaleString("en-US")) appears instead.
grep -rnE "toLocale(Date|Time)?String\(" app --include=*.ts --include=*.tsx | grep -v __tests__

# 2. No Intl.NumberFormat anywhere. Expect 0.
grep -rn "Intl.NumberFormat" app | wc -l

# 3. Offset-less recorded_at parsed as local time. Expect 11 hits:
#    ReturnMetrics.tsx:48,51; MiniSparkline.tsx:67; returns.ts:34,45,74,75; marketData.ts:391;
#    serverMarketData.ts:211,218,237.
grep -rnE "new Date\([^)]*recorded_at" app --include=*.ts --include=*.tsx | grep -v __tests__

# 4. toFixed(0|2). Expect 29 hits. The MONEY ones this PR replaces:
#    page.tsx:19; product/[id]/page.tsx:63; stats/page.tsx:62; compare/page.tsx:203,209;
#    useCurrencyConversion.ts:70; BoxCalculator.tsx:278,716; MarketView.tsx:141; PriceChart.tsx:481,645;
#    ProductSearchSelect.tsx:65,126; ImportHoldingsModal.tsx:394.
#    The rest stay: percentages (ReturnMetrics.tsx:127, PriceChart.tsx:596,602,607, PortfolioSummaryCard.tsx:29,
#    HoldingCard.tsx:38, MarketView.tsx:134, stats/page.tsx:86, page.tsx:305, product/[id]/page.tsx:87),
#    scores (stats/page.tsx:57,102), input pre-fills (EditHoldingModal.tsx:43, AddHoldingModal.tsx:62),
#    and PortfolioChartImpl.tsx:219 (compact "k" axis).
grep -rnE "toFixed\((0|2)\)" app --include=*.ts --include=*.tsx | grep -v __tests__

# 5. The bug, reproduced in node (prints 9/26/2026 then 9/25/2026):
TZ=UTC node -e 'console.log(new Date("2026-09-26T00:00:00Z").toLocaleDateString("en-US"))'
TZ=America/Vancouver node -e 'console.log(new Date("2026-09-26T00:00:00Z").toLocaleDateString("en-US"))'

# 6. WP00 landed: this must print a script line. If it prints nothing, stop: WP00 is a hard dependency.
grep -n '"build:stub"' package.json

# 7. no-restricted-properties is not configured yet. Expect no output.
pnpm exec eslint --print-config app/page.tsx | grep -A2 '"no-restricted-properties"'
```

Assumptions to check:

- WP03 may have landed and edited `app/page.tsx:205-209` (hero copy) and `Footer.tsx`. This PR does not touch that copy. Re-read `app/page.tsx` before editing; your edits are at the helpers near the top, the "Last Refreshed" block, and the Quick Stats `StatCard`s.
- WP05 may have landed. If so: `app/lib/portfolio.ts` `getPortfolioHistory` already iterates UTC days (WP05 step 10d), so do not touch it; `EditHoldingModal.tsx`/`AddHoldingModal.tsx` use `PRICE_MESSAGE` from `app/lib/validation.ts`, which contains `PRICE_MAX.toLocaleString("en-US")`; step 7 replaces that. If WP05 has not landed, apply step 7 to the two modal lines instead.
- `app/lib/format.ts` does not exist yet (`ls app/lib/format.ts` fails). If it exists, stop and reconcile: another package created it.

## Implementation steps

All paths are relative to `frontend/`. Do the steps in order: step 1 creates the module everything else imports; step 2 locks its behaviour before you start replacing call sites.

### Decisions baked into this spec (do not re-open them)

1. **Date style for the whole site: `Sep 26, 2026`** (month abbreviation, day, year; `Sep 26` where the year is noise, i.e. chart axes). It is what `/product/[id]` already prints, it is unambiguous (numeric `09/10/2026` means different days in en-US and en-GB), and it has no locale-dependent punctuation.
2. **Date-only values are formatted by string split plus a fixed English month table, not by `Intl`.** The plan asked for a fixed-locale `Intl.DateTimeFormat` with `timeZone: "UTC"`. That fixes the day and the zone, but server and browser still run different ICU/CLDR versions, and CLDR has changed English month and time punctuation between versions (en-CA "Sep" vs "Sept", en-US switching the space before AM/PM to U+202F in ICU 72). Any such difference is a hydration mismatch. A `YYYY-MM-DD` key needs no calendar math, so the split-and-table form is exact, identical on every runtime, and about 50x cheaper per call. This is a deliberate correction of the plan.
3. **Timestamps (instants) are shown in `America/Toronto` with the zone abbreviation**, e.g. `Sep 25, 2026, 12:12 AM EDT`. Reasons: the audience is Canadian and Eastern time (Ontario and Quebec) is the largest share of it; a fixed zone makes the ISR HTML, the server render and every browser print the same string, so there is no hydration mismatch and no post-mount flicker; the `EDT`/`EST` label tells a Vancouver or Halifax reader exactly what the time means. Rejected: UTC (correct but reads as a bug to consumers), and viewer-local after mount (needs a client island on the server-rendered dashboard, flashes on load, and still needs a zone label). The instant is converted with one module-level `Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hourCycle: "h23", ... })` read through `formatToParts`, and the string is assembled by hand from the numeric parts, the fixed month table, a computed AM/PM, and the `timeZoneName` part. Only numeric fields and the `EDT`/`EST` abbreviation come from ICU, and those have been stable in CLDR for decades.
4. **Money keeps the site's existing symbols: `$` for USD, `C$` for CAD**, placed before the number, with the sign before the symbol (`-C$5.00`, `+$100.00`). Digits come from a module-level `Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`. Do not use `style: "currency"`: in en-CA it prints `US$` for USD, in en-US it prints `CA$` for CAD, and with `currencyDisplay: "narrowSymbol"` both become `$`, which is ambiguous on a page with a USD/CAD toggle. `en-US` digits are identical to `en-CA` digits (`1,649.99`), and `en` is the one locale every ICU build contains.
5. **`recorded_at` and `last_updated` are UTC instants without an offset** (`timestamp without time zone`, written from `datetime.now(timezone.utc)`; see `marketPulse.ts:80-87` and `schema.sql:53,69`). `parseRecordedAt` treats a value without an offset as UTC, accepts `T` or a space as separator, accepts date-only values (UTC midnight), keeps explicit offsets (`Z`, `+00:00`, `-04:00`, `+0000`, and normalises a bare `+00` which V8 rejects), and trims fractional seconds to milliseconds (PostgREST returns microseconds).

### Step 1. Create `app/lib/format.ts` (new file)

No `"use client"` and no `"server-only"`: it is imported by server components, client components and `lib/` modules. It imports nothing.

```ts
/**
 * Every user-visible date, timestamp and money string on the site.
 *
 * The rule: output must not depend on the runtime's locale or time zone. The
 * same component renders on Vercel (en-US, UTC) and then hydrates in each
 * visitor's browser; any difference is a React hydration error, and formatting
 * a UTC date key in the viewer's zone printed release dates one day early west
 * of Greenwich (F007). So:
 *
 * - Date-only values (YYYY-MM-DD keys such as sets.release_date) are formatted
 *   by string split and a fixed month table. No Date, no Intl, no zone.
 * - Instants (recorded_at, last_updated) are shown in DISPLAY_TIME_ZONE with
 *   its abbreviation, assembled from formatToParts so ICU punctuation changes
 *   between Node and browser versions cannot leak into the text.
 * - Money uses the site's symbols ($ for USD, C$ for CAD) and en-US digit
 *   grouping.
 *
 * Every Intl object here is built once at module scope (F072). Do not build
 * formatters inside components or per call.
 */

export type CurrencyCode = "USD" | "CAD";

export const CURRENCY_SYMBOL: Readonly<Record<CurrencyCode, string>> = {
  USD: "$",
  CAD: "C$",
};

/**
 * The zone every timestamp is shown in. Fixed, not the viewer's, so that the
 * server render and every browser print the same string; the abbreviation
 * (EDT/EST) is always shown next to it.
 */
export const DISPLAY_TIME_ZONE = "America/Toronto";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// A leading YYYY-MM-DD. Accepts "2026-09-26", "2026-09-26T04:12:00" and
// "2026-09-26 04:12:00"; the date part of a recorded_at is its UTC date.
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function splitDateKey(value: string): [number, number, number] | null {
  const match = DATE_KEY_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [year, month, day];
}

/** "2026-09-26" -> "Sep 26, 2026". Fallback for empty or malformed input. */
export function formatDateOnly(
  value: string | null | undefined,
  fallback = "Unknown"
): string {
  if (!value) return fallback;
  const parts = splitDateKey(value);
  if (!parts) return fallback;
  const [year, month, day] = parts;
  return `${MONTHS_SHORT[month - 1]} ${day}, ${year}`;
}

/** "2026-09-26" -> "Sep 26". For chart axes and tooltips. */
export function formatMonthDay(
  value: string | null | undefined,
  fallback = ""
): string {
  if (!value) return fallback;
  const parts = splitDateKey(value);
  if (!parts) return fallback;
  const [, month, day] = parts;
  return `${MONTHS_SHORT[month - 1]} ${day}`;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_RE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const HOUR_ONLY_OFFSET_RE = /([+-]\d{2})$/;
const EXTRA_FRACTION_RE = /(\.\d{3})\d+/;

/**
 * Parse a recorded_at / last_updated value as the UTC instant it is.
 *
 * Those columns are `timestamp without time zone` holding UTC, so PostgREST
 * returns them with no offset ("2026-09-25T04:12:00.123456"). new Date() reads
 * an offset-less date-time as LOCAL time, shifting it by the runtime's UTC
 * offset (F122). This appends Z when there is no offset, accepts a space
 * separator and date-only values, keeps explicit offsets, and trims
 * microseconds. Returns an Invalid Date (getTime() is NaN) for garbage, like
 * new Date() does, so it is a drop-in replacement.
 */
export function parseRecordedAt(raw: string | null | undefined): Date {
  if (!raw) return new Date(Number.NaN);
  const value = raw.trim().replace(" ", "T");
  if (DATE_ONLY_RE.test(value)) return new Date(`${value}T00:00:00Z`);
  const tIndex = value.indexOf("T");
  if (tIndex === -1) return new Date(Number.NaN);
  const normalised = value.replace(EXTRA_FRACTION_RE, "$1");
  // Only look for an offset after the "T": the date part's "-26" is not one.
  const timePart = normalised.slice(tIndex + 1);
  if (OFFSET_RE.test(timePart)) {
    // V8 rejects a bare "+00"; psql-style output uses it.
    return new Date(normalised.replace(HOUR_ONLY_OFFSET_RE, "$1:00"));
  }
  return new Date(`${normalised}Z`);
}

/** The UTC calendar date (YYYY-MM-DD) of a recorded_at, or null if unparseable. */
export function recordedAtDateKey(raw: string | null | undefined): string | null {
  const date = parseRecordedAt(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

// Numeric parts only (plus the zone abbreviation). hourCycle h23 so AM/PM is
// computed here rather than taken from ICU's dayPeriod text.
const TIMESTAMP_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

export interface FormatTimestampOptions {
  /** Default true. False drops the year: "Sep 25, 12:12 AM EDT". */
  withYear?: boolean;
  /** Returned for null, "" or an unparseable value. Default "Unknown". */
  fallback?: string;
}

/**
 * An instant in DISPLAY_TIME_ZONE with its abbreviation:
 * "Sep 25, 2026, 12:12 AM EDT". Strings go through parseRecordedAt.
 */
export function formatTimestamp(
  value: string | Date | null | undefined,
  { withYear = true, fallback = "Unknown" }: FormatTimestampOptions = {}
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const date = typeof value === "string" ? parseRecordedAt(value) : value;
  if (Number.isNaN(date.getTime())) return fallback;

  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of TIMESTAMP_PARTS.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  const month = Number(parts.month);
  const day = Number(parts.day);
  // % 24 guards engines that report midnight as "24" despite h23.
  const hour24 = Number(parts.hour) % 24;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = hour24 < 12 ? "AM" : "PM";
  const monthDay = `${MONTHS_SHORT[month - 1]} ${day}`;
  const datePart = withYear ? `${monthDay}, ${parts.year}` : monthDay;
  return `${datePart}, ${hour12}:${parts.minute} ${period} ${parts.timeZoneName}`;
}

const MONEY_FORMATTERS = {
  0: new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  2: new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
} as const;

export interface FormatMoneyOptions {
  /** Default 2. Use 0 for chart axis ticks. */
  decimals?: 0 | 2;
  /** Prefix "+" on zero and positive values (gains). Negative is always "-". */
  signed?: boolean;
  /** Returned for null, undefined, NaN and Infinity. Default "--". */
  missing?: string;
}

/**
 * A value ALREADY in `currency` (this does not convert):
 * formatMoney(1649.99, "CAD") -> "C$1,649.99"; formatMoney(-100) -> "-$100.00".
 */
export function formatMoney(
  value: number | null | undefined,
  currency: CurrencyCode = "USD",
  { decimals = 2, signed = false, missing = "--" }: FormatMoneyOptions = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return missing;
  const digits = MONEY_FORMATTERS[decimals].format(Math.abs(value));
  // -0.001 must print "$0.00", not "-$0.00".
  const roundsToZero = !/[1-9]/.test(digits);
  const negative = value < 0 && !roundsToZero;
  const sign = negative ? "-" : signed ? "+" : "";
  return `${sign}${CURRENCY_SYMBOL[currency]}${digits}`;
}

const INTEGER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 1234 -> "1,234". Counts and limits in copy. */
export function formatInteger(value: number): string {
  return INTEGER_FORMAT.format(value);
}
```

This exact file was type-checked with the repo's TypeScript (`--strict --target ES2017 --lib dom,esnext`) and run under `TZ=UTC`, `America/Vancouver`, `Asia/Tokyo` and `America/St_Johns` with identical output; the expected strings in step 2 are copied from that run.

### Step 2. Add `app/lib/__tests__/format.test.ts` (new file)

Write it now, before replacing call sites, and run it (`pnpm exec jest app/lib/__tests__/format.test.ts`). Full code is in the Tests section. It must pass under `TZ=UTC`, `TZ=America/Vancouver` and `TZ=Asia/Tokyo`.

### Step 3. Parse offset-less timestamps as UTC (F122)

3a. `app/components/MarketView/returns.ts`. Add `import { parseRecordedAt } from "../../lib/format";` below the existing import on line 1. Replace lines 33-51 of `getReturnPercent` (from `const latestEntry = ...` through the end of the `for` loop) with:

```ts
  const latestEntry = history[history.length - 1];
  const latestEntryMs = parseRecordedAt(latestEntry.recorded_at).getTime();

  // Elapsed milliseconds, not setDate() on a local calendar: the result must
  // not depend on the runtime's zone or on a DST change inside the window.
  const targetMs = referenceDate.getTime() - days * DAY_MS;

  // If the latest point is already older than the target window,
  // there is not enough recent data to compute that return.
  if (latestEntryMs <= targetMs) return null;

  let pastEntry: PriceHistoryEntry | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    if (parseRecordedAt(history[i].recorded_at).getTime() <= targetMs) {
      pastEntry = history[i];
      break;
    }
  }
```

`DAY_MS` already exists at `returns.ts:3`. In `getCagrPercent`, replace lines 74-75 with:

```ts
  const startMs = parseRecordedAt(first.recorded_at).getTime();
  const endMs = parseRecordedAt(last.recorded_at).getTime();
```

Leave `toDailyPoints` (`recorded_at.slice(0, 10)` is already the UTC date of an offset-less UTC value).

3b. `app/components/ProductPrices/shared/ReturnMetrics.tsx`. Add `import { parseRecordedAt } from "../../../lib/format";` with the other imports and `const DAY_MS = 24 * 60 * 60 * 1000;` above `function getHistoricalReturn`. Replace lines 40-58 (from `const targetDate = new Date();` through the end of the `for` loop) with:

```ts
  const targetMs = Date.now() - days * DAY_MS;

  // The newest reading must fall inside the window, or there is no "now" to
  // measure to: without this the loop's first match is that same newest row
  // and the function returns a flat 0.00%, reading as a stable product rather
  // than an unpriced one. Mirrors the identical bail in MarketView/returns.ts.
  if (parseRecordedAt(latestEntry.recorded_at).getTime() <= targetMs) return null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (parseRecordedAt(history[i].recorded_at).getTime() <= targetMs) {
      const pastPrice = convertPrice(history[i].usd_price);
      if (pastPrice === 0) return null;
      return {
        percent: ((currentPrice - pastPrice) / pastPrice) * 100,
      };
    }
  }
```

3c. `app/components/MarketView/MiniSparkline.tsx`. Add `import { recordedAtDateKey } from "../../lib/format";`. In the `useMemo` at line 66-73 replace:

```ts
      const dateKey = new Date(entry.recorded_at).toISOString().split("T")[0];
      if (!map.has(dateKey)) {
```

with:

```ts
      // UTC day of the row. new Date(raw) read the offset-less value as local
      // time and put rows on the previous day for viewers east of UTC (F122).
      const dateKey = recordedAtDateKey(entry.recorded_at);
      if (dateKey === null) continue;
      if (!map.has(dateKey)) {
```

3d. `app/lib/marketData.ts`. Add `import { parseRecordedAt } from "./format";` to the imports. Replace lines 389-392:

```ts
    historyByProduct[Number(productId)].sort(
      (a, b) =>
        parseRecordedAt(a.recorded_at).getTime() -
        parseRecordedAt(b.recorded_at).getTime()
    );
```

3e. `app/lib/serverMarketData.ts`. Add `import { parseRecordedAt, recordedAtDateKey } from "./format";` below the other `./` imports (keep `import "server-only";` first). In `getReturnPercent` (starts line 205) replace lines 210-222 (from `const latestEntry` through the end of the `for` loop) with:

```ts
  const latestEntry = history[history.length - 1];
  const targetMs = Date.now() - days * 24 * 60 * 60 * 1000;

  if (parseRecordedAt(latestEntry.recorded_at).getTime() <= targetMs) return null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (parseRecordedAt(history[i].recorded_at).getTime() <= targetMs) {
      const pastPrice = history[i].usd_price;
      if (pastPrice === 0) return null;
      return ((latestEntry.usd_price - pastPrice) / pastPrice) * 100;
    }
  }
```

(If the file already has a `DAY_MS` constant in scope, use it instead of the literal.) In `buildDailySeries` replace line 237 and the `if` below it the same way as 3c (`recordedAtDateKey`, `if (dateKey === null) continue;`). On Vercel the runtime is UTC so this only changes behaviour for local builds in other zones, but it keeps server and client math identical; WP18 later merges these duplicates.

3f. `app/components/PriceChart.tsx`. Add `import { formatMoney, formatMonthDay, parseRecordedAt } from "../lib/format";` below the `resolvePrice` import. In `groupedDaily` (lines 91-105) replace the whole `let dateObj ... }` parse block (from `// Parse the recorded_at timestamp` through the closing `}` of the `else` branch) with:

```ts
      // recorded_at is a UTC instant, usually without an offset. The bucket
      // below is deliberately the viewer's LOCAL date (see comment above).
      const dateObj = parseRecordedAt(entry.recorded_at);
      if (Number.isNaN(dateObj.getTime())) continue;
```

Keep the local `yyyy/mm/dd` bucketing lines that follow unchanged. Steps 6 and 8 make the remaining PriceChart edits.

Do NOT touch `app/lib/portfolio.ts` date loops (WP05 owns them), `marketPulse.ts` `toRecordedDateKey`/`toComparableRecordedAt` (string-based and correct), `clientMarketData.ts:144` (string comparison of same-source values), or the sort comparators in `ProductPrices/utils/sorting.ts:102-103` and `BoxCalculator/hooks/useBoosterBoxPrices.ts:59` (they parse both sides identically, so order is correct).

### Step 4. Date-only values (F007, F026, F089)

4a. `app/components/ProductPrices/cards/GroupHeader.tsx`. Add `import { formatDateOnly } from "../../../lib/format";` and replace lines 18-20 with:

```ts
  // Fixed format, no zone: release_date is a calendar date, and this renders
  // on the server for "/" (RecentlyReleased) and again in the browser.
  const formattedDate = formatDateOnly(releaseDate);
```

4b. `app/components/ProductPrices/cards/ProductCard.tsx`. Imports: add `import { formatDateOnly, formatTimestamp } from "../../../lib/format";` and `import { hasCurrentPrice } from "../../../lib/priceGuard";`. Replace lines 75-83 (`releaseDate` and `lastUpdated`) with only:

```ts
  const releaseDate = formatDateOnly(product.sets?.release_date);
```

Then, inside the flat branch, right after `if (viewMode === "flat") {` (line 125) and before its `return (`, add:

```ts
    // Only the flat card shows it, so only the flat card pays for it (F072).
    // Fixed zone with its label: identical on the server and in every browser.
    const lastUpdated = formatTimestamp(product.last_updated);
```

The JSX uses (`Release: {releaseDate}` at :158, `Updated: {lastUpdated}` at :222, `{releaseDate}` at :260) stay as they are.

Stale-price explanation (F096): add this component above `const ProductCard = memo(...)` (after `VolumeChip`):

```tsx
// A withheld price renders as a bare "--", which reads as a rendering fault.
// Say why and when it was last priced, as /product/[id] does.
function StalePriceNote({ product }: { product: Product }) {
  if (hasCurrentPrice(product)) return null;
  return (
    <p className="mt-1 text-[11px] text-slate-500">
      {product.price_recorded_at
        ? `No current price, last recorded ${formatDateOnly(product.price_recorded_at)}`
        : "No current price yet"}
    </p>
  );
}
```

Render `<StalePriceNote product={product} />` in two places: in the flat branch directly after the `<div className="flex items-center justify-between mb-1">...</div>` that contains `{formatPrice(product.usd_price)}` (around line 162-170), and in the grouped branch directly after the `<div className="flex items-center gap-3 sm:justify-end">...</div>` that contains the MiniSparkline and the price (lines 277-288), before `<ReturnMetrics`. Stale status is known at first render (it comes from the server payload), so this does not shift layout after load.

4c. `app/components/MarketView/MarketView.tsx`. Add `import { formatDateOnly, formatMoney } from "../../lib/format";`. Delete `formatReleaseDate` (lines 113-116) and change line 484 to `{formatDateOnly(product.sets?.release_date)}`. Keep `getReleaseMs` (:190).

4d. `app/compare/page.tsx`. Add `import { formatDateOnly, formatMoney, type CurrencyCode } from "../lib/format";`. Delete `formatReleaseDate` (lines 226-230); change line 1037 to `{formatDateOnly(row.releaseDate)}`. Keep `getReleaseUtcMs` (used at :412). Change line 554 to `Updated: {formatDateOnly(exchangeRateDate)}` (exchange_rates.recorded_at is a Bank of Canada date stored as midnight; its date part is the rate date).

4e. `app/stats/page.tsx`. Add `import { formatDateOnly, formatMoney } from "../lib/format";`. Delete `formatReleaseDate` (lines 50-53); change lines 186 and 244 to `{formatDateOnly(set.releaseDate)}`.

4f. `app/product/[id]/page.tsx`. Add `import { formatDateOnly, formatMoney } from "../../lib/format";`. Delete `formatDate` (lines 47-59, including its comment; the comment's point now lives in `format.ts`). Replace its three uses (`formatDate(product.price_recorded_at)` at :271-273 and `formatDate(product.sets?.release_date)` at :281) with `formatDateOnly(...)`. Keep `getReleaseMs` (used at :172). The printed string does not change ("Sep 26, 2026").

4g. `app/privacy/page.tsx`. Add `import { formatDateOnly } from "../lib/format";` and change line 15 to `Last updated: {formatDateOnly(LAST_UPDATED)}` (was the raw ISO key). Leave the rest of the page to WP15.

### Step 5. "Last Refreshed" on the dashboard (F096)

`app/page.tsx`. Add `import { formatInteger, formatMoney, formatTimestamp } from "./lib/format";`. Keep the `latestUpdateRaw` reduce (lines 173-176). Replace lines 177-192 (from `let latestUpdateLabel = "Unknown";` through the closing `}` of `if (latestUpdateRaw)`) with:

```ts
  // products.last_updated is a UTC instant without an offset. Shown in Eastern
  // time with its abbreviation, so the ISR HTML says what zone it is in instead
  // of printing the build machine's UTC clock unlabeled (F096).
  const latestUpdateLabel = formatTimestamp(latestUpdateRaw, { withYear: false });
```

`formatTimestamp("")` returns "Unknown", which matches today's fallback. Line 319 is unchanged. The stat now reads e.g. `Sep 25, 12:12 AM EDT`.

### Step 6. Money (F089)

6a. `app/components/ProductPrices/hooks/useCurrencyConversion.ts`. Add `import { formatMoney } from "../../../lib/format";`. Replace lines 68-70 inside `formatPrice` with:

```ts
    const price = selectedCurrency === "CAD" ? usdPrice * exchangeRate : usdPrice;
    return formatMoney(price, selectedCurrency);
```

In the comment above it (lines 56-63) change "Matches formatUsd on the dashboard and /product/[id]." to "Formatting lives in lib/format.ts (formatMoney)." Keep the `"--"` early return and the `useCallback` deps.

6b. `app/page.tsx`. Delete `formatUsd` (lines 17-20). Replace `formatUsd(product.usd_price)` (line 64) with `formatMoney(product.usd_price, "USD")` and `formatUsd(mostExpensive?.usd_price)` (line 310) with `formatMoney(mostExpensive?.usd_price, "USD")`. Line 298: `value={formatInteger(products.length)}`.

6c. `app/product/[id]/page.tsx`. Delete `formatUsd` (lines 61-64). Replace its uses at :261, :291 and :420 with `formatMoney(<same argument>, "USD")`.

6d. `app/stats/page.tsx`. Delete `formatCurrency` (lines 60-63). Line 259 becomes `{formatMoney(set.pricePerDay, "USD")}` (`get_set_analytics` computes it from `usd_price`). Leave `formatScore` (a score, not money).

6e. `app/compare/page.tsx`. Every Shopify price, cost and derived figure on this page is CAD (`diff = shopifyItem.shopifyPrice - marketCad`, line 396); only `marketPriceUsd` is USD. Replace `formatCurrency` and `formatSignedCurrency` (lines 201-210) with:

```ts
// Page convention: missing values render as an em dash.
const MISSING = "\u2014"; // em dash

// Shopify prices, costs and every derived figure here are CAD; only
// marketPriceUsd is USD and passes "USD" explicitly.
function formatCurrency(value: number | null, currency: CurrencyCode = "CAD"): string {
  return formatMoney(value, currency, { missing: MISSING });
}

function formatSignedCurrency(value: number | null): string {
  return formatMoney(value, "CAD", { signed: true, missing: MISSING });
}
```

and change the two USD call sites, `formatCurrency(row.marketPriceUsd)` at lines 773 and 1041, to `formatCurrency(row.marketPriceUsd, "USD")`. Leave `formatPercent` and the exchange-rate `toFixed(4)` at :550. Visible effect: CAD columns now read `C$1,299.99` (they printed a bare `$` although the page says "All prices are CAD").

6f. `app/components/MarketView/MarketView.tsx`. Delete `formatRatio` (lines 139-142) and `const currencySymbol = ...` (line 443). Line 494 becomes `{formatMoney(pricePerDay, selectedCurrency)}` (`pricePerDay` is already converted, line 308-314). Remove `currencySymbol,` from the `useMemo` dependency array (line 626); `selectedCurrency` is already in it.

6g. `app/components/BoxCalculator/BoxCalculator.tsx`. Add `import { CURRENCY_SYMBOL, formatInteger, formatMoney } from "../../lib/format";`. Replace lines 275-278 with:

```ts
  const currencySymbol = CURRENCY_SYMBOL[selectedCurrency];

  // Format a value that is already in the display currency (no conversion needed)
  const fmtPrice = (value: number) => formatMoney(value, selectedCurrency);
```

(`currencySymbol` stays for the input prefixes at :509 and :530.) Replace lines 714-716 (`{navResult.premiumDiscount > 0 ? "+" : "-"}`, `{currencySymbol}`, `{Math.abs(navResult.premiumDiscount).toFixed(2)} (`) with:

```tsx
                      {navResult.premiumDiscount > 0 ? "+" : "-"}
                      {formatMoney(Math.abs(navResult.premiumDiscount), selectedCurrency)} (
```

keeping line 717 (the percent) as is. Lines 191 and 196: `${PRICE_MAX.toLocaleString()}` becomes `${formatInteger(PRICE_MAX)}` (WP15 later replaces these `alert()`s; this only removes the bare call).

6h. `app/components/Portfolio/cards/HoldingCard.tsx`. Add `import { formatMoney } from "../../../lib/format";`. Replace `formatCurrency` (lines 25-33) with:

```ts
  const formatCurrency = (value: number | null, signed = false) =>
    formatMoney(
      value === null ? null : currency === "CAD" ? value * exchangeRate : value,
      currency,
      { signed }
    );
```

and line 123 `{isPositive ? "+" : ""}{formatCurrency(performance.gain_loss)}` with `{formatCurrency(performance.gain_loss, true)}`. `isPositive` stays (it drives the colour class). Negative values change from `$-100.00` to `-$100.00`.

6i. `app/components/Portfolio/shared/PortfolioSummaryCard.tsx`. Same `formatCurrency` replacement for lines 16-24 (import path `../../../lib/format`), and replace lines 97-98 (`{isPositive ? "+" : ""}` and `{formatCurrency(summary.total_gain_loss)}`) with `{formatCurrency(summary.total_gain_loss, true)}`.

6j. `app/components/Portfolio/shared/ProductSearchSelect.tsx`. Add `import { formatMoney } from "../../../lib/format";`. Line 65: `Current: {formatMoney(selectedProduct.usd_price, "USD", { missing: "N/A" })}`. Line 126: `{formatMoney(product.usd_price, "USD", { missing: "N/A" })}`. This also fixes today's "$N/A" (the literal `$` sat outside the expression).

6k. `app/components/Portfolio/cards/ImportHoldingsModal.tsx`. Add the same import. Line 394: `Qty: {result.csvRow.quantity} @ {formatMoney(result.csvRow.averageCostPaid, "USD")} each` (holdings store `purchase_price_usd`). If WP05 moved this line, find it with `grep -n "averageCostPaid.toFixed" app/components/Portfolio/cards/ImportHoldingsModal.tsx`.

6l. `app/components/PriceChart.tsx`. Line 481 becomes `<span className="text-blue-400">{formatMoney(priceEntry.value, currency)}</span>`. Line 645 becomes `tickFormatter={(value) => formatMoney(value, currency, { decimals: 0 })}`. Delete `const currencySymbol = ...` and its comment (lines 374-375) once nothing references it (`grep -n currencySymbol app/components/PriceChart.tsx` must print nothing).

6m. `app/components/charts/PortfolioChartImpl.tsx`. Add `import { CURRENCY_SYMBOL, formatMoney, formatMonthDay } from "../../lib/format";`. Line 41: `const currencySymbol = CURRENCY_SYMBOL[currency];` (still used by the compact `k` axis at :219, which stays). Replace lines 100-105 (the `{currencySymbol}` line and the `payload[0].value.toLocaleString(...)` expression) with `{formatMoney(payload[0].value, currency)}`.

6n. `app/components/charts/AllocationChartImpl.tsx`. Add `import { formatMoney } from "../../lib/format";`. Replace lines 90-94 (`{currencySymbol}` and `{data.value.toLocaleString(...)}`) with `{formatMoney(data.value, currency)}`. If `currencySymbol` (line 39) is then unused, delete it.

Do not touch: input pre-fills `EditHoldingModal.tsx:43` and `AddHoldingModal.tsx:62` (`toFixed(2)` into an `<input>` value must stay parseable, no commas); percentages (`toFixed(1|2)%`); `CurrencySelector.tsx:43` and `compare/page.tsx:550` exchange rates (`toFixed(4)`); `PriceChart.tsx:54-55` tick keys; `ImportHoldingsModal.tsx:52` file size.

### Step 7. Integers in copy

If WP05 landed: in `app/lib/validation.ts` replace `PRICE_MAX.toLocaleString("en-US")` in `PRICE_MESSAGE` with `formatInteger(PRICE_MAX)` and add `import { formatInteger } from "./format";`. If WP05 has not landed: replace `${PRICE_MAX.toLocaleString()}` in `EditHoldingModal.tsx:64` and `AddHoldingModal.tsx:85` with `${formatInteger(PRICE_MAX)}` (import from `../../../lib/format`).

### Step 8. Chart date labels

8a. `app/components/PriceChart.tsx`. Line 124-127: replace the `new Date(year, month - 1, day).toLocaleDateString(undefined, {...})` expression and the `const [year, month, day] = ...` line above it with `const displayDate = formatMonthDay(dateStr);`. Line 186: `const displayDate = formatMonthDay(key);`. Both keys are already the viewer-local `YYYY-MM-DD` built by the component, so the label day does not change; only the locale-dependent text does ("Sep 26" everywhere). `releaseDateInfo` (:545-547) compares `d.timestamp`, not `d.date`, so it is unaffected.

8b. `app/components/charts/PortfolioChartImpl.tsx`. Lines 45-49: `date: formatMonthDay(point.date),` (point.date is a UTC `YYYY-MM-DD` key; the old code read it back with `timeZone: "UTC"`).

### Step 9. Lint guard against regressions

`eslint.config.mjs`: add this object at the end of the exported array (after the `no-explicit-any` object). It uses `no-restricted-properties`, not `no-restricted-syntax`, so it cannot collide with the `no-restricted-syntax` blocks WP05/WP06 add (flat config replaces, not merges, a rule configured twice for the same file).

```js
  {
    // WP07: user-visible dates, times and numbers go through app/lib/format.ts.
    // Bare toLocale* uses the runtime's locale and zone, which differ between
    // the server (en-US, UTC) and each browser: release dates printed a day
    // early and "/" failed hydration (F007, F089).
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/**/__tests__/**", "app/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "toLocaleDateString", message: "Use formatDateOnly or formatMonthDay from app/lib/format.ts." },
        { property: "toLocaleTimeString", message: "Use formatTimestamp from app/lib/format.ts." },
        { property: "toLocaleString", message: "Use formatMoney, formatInteger or formatTimestamp from app/lib/format.ts." },
      ],
    },
  },
```

### Step 10. CI: run the zone-sensitive tests in two more zones

`.github/workflows/ci.yml`, job `frontend`: directly after the `- run: pnpm test --ci` step, add:

```yaml
      # Formatting and return math must not depend on the runtime zone.
      # Vercel runs in UTC; these zones are west (UTC-7/-8) and east (UTC+9).
      - name: Timezone-sensitive tests (Vancouver, Tokyo)
        run: |
          TZ=America/Vancouver pnpm exec jest --ci app/lib/__tests__/format.test.ts app/components/MarketView/__tests__/returns.test.ts app/components/ProductPrices/__tests__/GroupHeader.test.tsx app/components/ProductPrices/__tests__/ProductCard.format.test.tsx
          TZ=Asia/Tokyo pnpm exec jest --ci app/lib/__tests__/format.test.ts app/components/MarketView/__tests__/returns.test.ts app/components/ProductPrices/__tests__/GroupHeader.test.tsx app/components/ProductPrices/__tests__/ProductCard.format.test.tsx
```

GitHub runs `run:` with `bash -e`, so the first failing zone fails the step. If WP00 already added a `build:stub` step after tests, put this step between tests and the build.

### Step 11. Update existing tests

- `app/components/Portfolio/__tests__/HoldingCard.test.tsx:272-274`: comment becomes `// Negative values print the sign before the symbol.` and the assertion `screen.getByText("-$100.00")`.
- `app/components/Portfolio/__tests__/PortfolioSummaryCard.test.tsx:180-183`: same, `screen.getByText("-$300.00")`.
- All other money assertions in these two files (`$125.50`, `C$136.00`, `$1,500.50`, `$1,234,567.89`, `+$100.00`, `+$0.00`, `$0.01`) must pass unchanged.
- `app/components/MarketView/__tests__/returns.test.ts`: add the cases in the Tests section; keep every existing case.

### Step 12. Final sweep

Run the grep checks in Verification. Every hit left must be one of the "do not touch" items listed at the end of step 6.

## Pitfalls: do not do this

- **Do not fix only the zone.** `toLocaleDateString(undefined, { timeZone: "UTC" })` still prints "Sep 26, 2026" on the server and "26 Sept 2026" (en-GB) or "2026-09-26" (en-CA numeric) in the browser. The F007 verifier measured this; locale must be fixed too. This spec avoids Intl entirely for date-only values.
- **Do not format date-only values through `Intl.DateTimeFormat` even with a fixed locale.** Server (Node) and browser ship different ICU/CLDR versions and English abbreviations and spacing have changed between them. String split plus a fixed table cannot drift.
- **Do not use `Intl.DateTimeFormat(...).format()` for timestamps.** Its literal text (the space before AM/PM became U+202F in ICU 72; en-CA prints "a.m.") differs by ICU version. Use `formatToParts` and assemble, as `formatTimestamp` does.
- **Do not format timestamps in the viewer's zone** (`Intl.DateTimeFormat().resolvedOptions().timeZone`, or no `timeZone`). The server renders `/` in UTC and the browser in its own zone; that is the hydration error. The F072 verifier also measured `resolvedOptions()` alone at about 46 us per card.
- **Do not reach for `suppressHydrationWarning` or a `useSyncExternalStore`/`useEffect` "format after mount" pattern.** With fixed locale and zone there is nothing to suppress; after-mount formatting adds a flash of different text (the F007 and F096 verifiers list it only as an alternative to a fixed zone).
- **Do not use `style: "currency"`.** en-CA prints `US$` for USD, en-US prints `CA$` for CAD, and `currencyDisplay: "narrowSymbol"` makes both `$`, ambiguous next to the USD/CAD toggle. Keep `$` / `C$`.
- **Do not append "Z" blindly.** `"2026-09-25" + "Z"` and `"...+00:00" + "Z"` are wrong, and `"...+00"` is rejected by V8. Always go through `parseRecordedAt`.
- **Do not replace `recorded_at.slice(0, 10)` in `returns.ts` `toDailyPoints` or the string-based helpers in `marketPulse.ts`.** They are already zone-independent.
- **Do not change PriceChart's local-date bucketing** (lines 86-89 comment and the `slicedData` local calendar). It is deliberate and coupled to the freshness clamp at :188-203. Only its parse and its label text change here.
- **Do not touch `app/lib/portfolio.ts` `getPortfolioHistory`.** WP05 rewrote its day loop to UTC and WP10 replaces it with an RPC.
- **Do not precompute labels in `useProductData` and do not change ProductCard's props** to pass currency primitives. F072 verifier: it couples the data hook to presentation, and `selectedCurrency`/`exchangeRate` are already props that must re-render the card.
- **Do not turn input pre-fills into formatted money** (`EditHoldingModal.tsx:43`, `AddHoldingModal.tsx:62`): `"1,649.99"` in a number input fails to parse.
- **Do not set `process.env.TZ` inside a test file to switch zones.** Jest gives each test file a copy of `process.env` (jest-util `createProcessEnv`), so the assignment never reaches V8's clock. Switch zones on the command line (`TZ=... pnpm exec jest ...`), as step 10 does.
- **Do not claim a full-tree client re-render in the PR description.** React 19 patches mismatched text and logs one recoverable error (F089 verifier). The user-visible effect is the console error plus the date text flipping after load.
- **Do not change `/prices` hydration behaviour here.** `/prices` renders client-side today because of `useSearchParams` (F007 verifier); WP08 changes that and relies on this PR having made the text deterministic.

## Tests

### New: `app/lib/__tests__/format.test.ts`

Default jsdom environment is fine (no `next/server`).

```ts
import {
  CURRENCY_SYMBOL,
  DISPLAY_TIME_ZONE,
  formatDateOnly,
  formatInteger,
  formatMoney,
  formatMonthDay,
  formatTimestamp,
  parseRecordedAt,
  recordedAtDateKey,
} from "../format";

// Every expected string below is a constant. CI runs this file under UTC,
// America/Vancouver and Asia/Tokyo (see .github/workflows/ci.yml), so a pass
// in all three proves the output does not depend on the runtime zone.

describe("test harness", () => {
  it("runs in the zone the command asked for", () => {
    const tz = process.env.TZ;
    if (!tz) return;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
  });
});

describe("formatDateOnly", () => {
  it.each([
    ["2026-09-26", "Sep 26, 2026"],
    ["2026-01-05", "Jan 5, 2026"],
    ["2026-09-26T04:12:00", "Sep 26, 2026"],
    ["2026-09-26 04:12:00", "Sep 26, 2026"],
    ["2026-12-31T23:59:59Z", "Dec 31, 2026"],
  ])("%s -> %s", (input, expected) => {
    expect(formatDateOnly(input)).toBe(expected);
  });

  it("does not shift the day west of UTC (F007 regression)", () => {
    // The old code printed 9/25/2026 for this under America/Vancouver.
    expect(formatDateOnly("2026-09-26")).toContain("26");
  });

  it.each([null, undefined, "", "garbage", "2026-13-01", "2026-00-10", "26/09/2026"])(
    "falls back for %p",
    (input) => {
      expect(formatDateOnly(input as string | null | undefined)).toBe("Unknown");
      expect(formatDateOnly(input as string | null | undefined, "--")).toBe("--");
    }
  );
});

describe("formatMonthDay", () => {
  it("drops the year", () => {
    expect(formatMonthDay("2026-01-05")).toBe("Jan 5");
    expect(formatMonthDay("bad")).toBe("");
  });
});

describe("parseRecordedAt", () => {
  const expectedMs = Date.UTC(2026, 8, 25, 4, 12, 0);

  it.each([
    "2026-09-25T04:12:00",
    "2026-09-25 04:12:00",
    "2026-09-25T04:12:00Z",
    "2026-09-25T04:12:00+00:00",
    "2026-09-25T04:12:00+00",
    "2026-09-25T04:12:00+0000",
    "2026-09-25T00:12:00-04:00",
    "2026-09-25T04:12:00.000000",
  ])("reads %s as 04:12 UTC", (raw) => {
    expect(parseRecordedAt(raw).getTime()).toBe(expectedMs);
  });

  it("keeps milliseconds and drops the rest of a microsecond fraction", () => {
    expect(parseRecordedAt("2026-09-25T04:12:00.123456").toISOString()).toBe(
      "2026-09-25T04:12:00.123Z"
    );
  });

  it("reads a date-only value as UTC midnight", () => {
    expect(parseRecordedAt("2026-09-25").toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });

  it.each([null, undefined, "", "garbage", "25/09/2026 04:12"])(
    "returns an Invalid Date for %p",
    (raw) => {
      expect(Number.isNaN(parseRecordedAt(raw as string | null | undefined).getTime())).toBe(true);
    }
  );

  it("recordedAtDateKey is the UTC day, even late in the UTC evening", () => {
    // Tokyo and Vancouver readers used to get 2026-09-26 / 2026-09-25 here
    // depending on their zone; the UTC day is 2026-09-25.
    expect(recordedAtDateKey("2026-09-25T23:30:00")).toBe("2026-09-25");
    expect(recordedAtDateKey("2026-09-25T00:30:00")).toBe("2026-09-25");
    expect(recordedAtDateKey("nope")).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("shows Eastern time with its abbreviation", () => {
    expect(DISPLAY_TIME_ZONE).toBe("America/Toronto");
    expect(formatTimestamp("2026-09-25 04:12:00")).toBe("Sep 25, 2026, 12:12 AM EDT");
    expect(formatTimestamp("2026-01-15T05:00:00")).toBe("Jan 15, 2026, 12:00 AM EST");
    expect(formatTimestamp("2026-07-01T16:30:00Z")).toBe("Jul 1, 2026, 12:30 PM EDT");
    expect(formatTimestamp(new Date(Date.UTC(2026, 6, 1, 3, 5)))).toBe(
      "Jun 30, 2026, 11:05 PM EDT"
    );
  });

  it("handles the DST changes", () => {
    // 2026-03-08 07:00Z is 03:00 EDT (clocks jumped 02:00 -> 03:00).
    expect(formatTimestamp("2026-03-08T07:00:00Z")).toBe("Mar 8, 2026, 3:00 AM EDT");
    // 2026-11-01 06:30Z is 01:30 EST (second pass through 01:xx).
    expect(formatTimestamp("2026-11-01T06:30:00Z")).toBe("Nov 1, 2026, 1:30 AM EST");
  });

  it("can drop the year", () => {
    expect(formatTimestamp("2026-09-25T04:12:00.123456", { withYear: false })).toBe(
      "Sep 25, 12:12 AM EDT"
    );
  });

  it("falls back for missing or bad input", () => {
    expect(formatTimestamp(null)).toBe("Unknown");
    expect(formatTimestamp("")).toBe("Unknown");
    expect(formatTimestamp("nope", { fallback: "--" })).toBe("--");
    expect(formatTimestamp(new Date(Number.NaN))).toBe("Unknown");
  });

  it("contains only ASCII (no U+202F from ICU)", () => {
    expect(formatTimestamp("2026-09-25T16:12:00Z")).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe("formatMoney", () => {
  it.each<[number, "USD" | "CAD", string]>([
    [1649.99, "USD", "$1,649.99"],
    [1649.99, "CAD", "C$1,649.99"],
    [1234567.891, "USD", "$1,234,567.89"],
    [0, "USD", "$0.00"],
    [0.005, "USD", "$0.01"],
    [-100, "USD", "-$100.00"],
    [-5, "CAD", "-C$5.00"],
    [-0.001, "USD", "$0.00"],
  ])("%p %s -> %s", (value, currency, expected) => {
    expect(formatMoney(value, currency)).toBe(expected);
  });

  it("signed prefixes + on zero and gains", () => {
    expect(formatMoney(100, "USD", { signed: true })).toBe("+$100.00");
    expect(formatMoney(0, "USD", { signed: true })).toBe("+$0.00");
    expect(formatMoney(-5, "CAD", { signed: true })).toBe("-C$5.00");
  });

  it("supports whole-number axis ticks", () => {
    expect(formatMoney(1649.6, "USD", { decimals: 0 })).toBe("$1,650");
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns the missing marker for %p",
    (value) => {
      expect(formatMoney(value as number | null | undefined)).toBe("--");
      expect(formatMoney(value as number | null | undefined, "USD", { missing: "N/A" })).toBe("N/A");
    }
  );

  it("uses the site symbols", () => {
    expect(CURRENCY_SYMBOL).toEqual({ USD: "$", CAD: "C$" });
  });
});

describe("formatInteger", () => {
  it("groups thousands", () => {
    expect(formatInteger(1234)).toBe("1,234");
    expect(formatInteger(999)).toBe("999");
  });
});
```

### New: `app/components/ProductPrices/__tests__/GroupHeader.test.tsx`

Renders the component that failed hydration on `/`; the TZ matrix in CI proves the text is zone-independent.

```tsx
import { render, screen } from "@testing-library/react";
import GroupHeader from "../cards/GroupHeader";

describe("GroupHeader release date", () => {
  it("prints the calendar date it was given, in every zone", () => {
    render(
      <GroupHeader setName="Test Set" setCode="TST" generation="Gen" releaseDate="2026-09-26" />
    );
    expect(screen.getByText("Sep 26, 2026")).toBeInTheDocument();
  });

  it("says Unknown for an empty date", () => {
    render(<GroupHeader setName="Test Set" setCode="TST" generation="Gen" releaseDate="" />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
```

### New: `app/components/ProductPrices/__tests__/ProductCard.format.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import ProductCard from "../cards/ProductCard";
import { formatMoney } from "../../../lib/format";
import type { Product } from "../types";

// Heavy children are irrelevant to formatting and pull in next/dynamic and Recharts.
jest.mock("../../MarketView/MiniSparkline", () => ({ __esModule: true, default: () => null }));
jest.mock("../shared/LazyPriceChart", () => ({ __esModule: true, default: () => null }));
jest.mock("../shared/ProductImage", () => ({ __esModule: true, default: () => null }));

beforeAll(() => {
  // jsdom has no IntersectionObserver; the card observes itself on mount.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NoopObserver;
});

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    usd_price: 1649.99,
    url: "https://example.com/p/1",
    price_recorded_at: "2026-09-25T04:12:00",
    last_updated: "2026-09-25T04:12:00.123456",
    sets: { name: "Test Set", code: "TST", release_date: "2026-09-26" },
    product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    returns: null,
    ...overrides,
  };
}

const baseProps = {
  chartTimeframe: "3M" as const,
  selectedCurrency: "USD" as const,
  exchangeRate: 1.36,
  formatPrice: (price: number | null | undefined) => formatMoney(price, "USD"),
  onLoadChart: jest.fn(),
};

describe("ProductCard formatting", () => {
  it("flat: release date, Eastern timestamp with zone, grouped money", () => {
    render(<ProductCard {...baseProps} product={makeProduct()} viewMode="flat" />);
    expect(screen.getByText("Release: Sep 26, 2026")).toBeInTheDocument();
    expect(screen.getByText("Updated: Sep 25, 2026, 12:12 AM EDT")).toBeInTheDocument();
    expect(screen.getByText("$1,649.99")).toBeInTheDocument();
  });

  it("grouped with set as primary: release date in the meta line", () => {
    render(
      <ProductCard {...baseProps} product={makeProduct()} viewMode="grouped" showSetAsPrimary />
    );
    expect(screen.getByText(/Sep 26, 2026/)).toBeInTheDocument();
  });

  it("grouped: explains a withheld price (F096)", () => {
    render(
      <ProductCard
        {...baseProps}
        product={makeProduct({ usd_price: null, price_recorded_at: "2026-08-01T04:00:00" })}
        viewMode="grouped"
      />
    );
    // ReturnMetrics may also print "--", so do not use getByText here.
    expect(screen.getAllByText("--").length).toBeGreaterThan(0);
    expect(screen.getByText("No current price, last recorded Aug 1, 2026")).toBeInTheDocument();
  });

  it("grouped: never-priced product", () => {
    render(
      <ProductCard
        {...baseProps}
        product={makeProduct({ usd_price: null, price_recorded_at: null })}
        viewMode="grouped"
      />
    );
    expect(screen.getByText("No current price yet")).toBeInTheDocument();
  });
});
```

If `ProductCard`'s props differ after WP03 (for example `historyLoading` was renamed), adjust `baseProps` to satisfy the type; do not change the assertions.

### Update: `app/components/MarketView/__tests__/returns.test.ts`

Add `getCagrPercent` to the import and append:

```ts
describe("offset-less recorded_at is UTC (F122)", () => {
  it("gives the same return for Z and offset-less spellings", () => {
    const ref = new Date("2026-02-10T12:00:00Z");
    const rows = [
      ["2026-02-01T00:00:00", 100],
      ["2026-02-03T00:00:00", 110],
      ["2026-02-08T00:00:00", 130],
      ["2026-02-10T00:00:00", 140],
    ] as const;
    const withZ = makeHistory(rows.map(([r, p]) => ({ recordedAt: `${r}Z`, usdPrice: p })));
    const bare = makeHistory(rows.map(([r, p]) => ({ recordedAt: r, usdPrice: p })));
    const spaced = makeHistory(rows.map(([r, p]) => ({ recordedAt: r.replace("T", " "), usdPrice: p })));
    const expected = getReturnPercent(withZ, 7, identityConvert, ref);
    expect(expected).toBeCloseTo(27.2727, 3);
    expect(getReturnPercent(bare, 7, identityConvert, ref)).toBeCloseTo(expected!, 10);
    expect(getReturnPercent(spaced, 7, identityConvert, ref)).toBeCloseTo(expected!, 10);
  });

  it("picks the UTC row at the window edge in every zone", () => {
    // Target = 2026-02-10T02:00Z - 7 days = 2026-02-03T02:00Z. The 02-03 01:00
    // UTC row is inside the edge and must be the past point: (132-110)/110.
    // Read as local time in America/Vancouver it became 09:00Z, fell outside,
    // and the 02-01 row was used instead (32%).
    const history = makeHistory([
      { recordedAt: "2026-02-01T01:00:00", usdPrice: 100 },
      { recordedAt: "2026-02-03T01:00:00", usdPrice: 110 },
      { recordedAt: "2026-02-10T01:00:00", usdPrice: 132 },
    ]);
    expect(
      getReturnPercent(history, 7, identityConvert, new Date("2026-02-10T02:00:00Z"))
    ).toBeCloseTo(20, 10);
  });

  it("CAGR is the same for Z and offset-less spellings", () => {
    const a = makeHistory([
      { recordedAt: "2025-02-10T04:00:00Z", usdPrice: 100 },
      { recordedAt: "2026-02-10T04:00:00Z", usdPrice: 121 },
    ]);
    const b = makeHistory([
      { recordedAt: "2025-02-10 04:00:00", usdPrice: 100 },
      { recordedAt: "2026-02-10T04:00:00", usdPrice: 121 },
    ]);
    expect(getCagrPercent(b, identityConvert)).toBeCloseTo(getCagrPercent(a, identityConvert)!, 10);
  });
});
```

### Update: `HoldingCard.test.tsx`, `PortfolioSummaryCard.test.tsx`

As in step 11: `$-100.00` becomes `-$100.00`, `$-300.00` becomes `-$300.00`.

## Verification

Run from `frontend/`:

```bash
pnpm exec tsc --noEmit                                   # expect: no output, exit 0

# Lint the files you changed. Expect zero no-restricted-properties errors.
# Lint is not blocking until WP17; other pre-existing errors in these files
# may remain, but the count must not grow (compare with `git stash` run).
pnpm exec eslint app/lib/format.ts app/lib/marketData.ts app/lib/serverMarketData.ts \
  app/components/ProductPrices app/components/MarketView app/components/PriceChart.tsx \
  app/components/charts app/components/BoxCalculator/BoxCalculator.tsx app/components/Portfolio \
  app/page.tsx app/product app/stats/page.tsx app/compare/page.tsx app/privacy/page.tsx \
  app/lib/validation.ts eslint.config.mjs
pnpm exec eslint app | grep -c no-restricted-properties  # expect 0

pnpm test --ci                                           # expect: all suites pass

# Zone matrix (same as CI step 10). Expect all pass in both runs.
for z in America/Vancouver Asia/Tokyo; do
  TZ=$z pnpm exec jest --ci app/lib/__tests__/format.test.ts \
    app/components/MarketView/__tests__/returns.test.ts \
    app/components/ProductPrices/__tests__/GroupHeader.test.tsx \
    app/components/ProductPrices/__tests__/ProductCard.format.test.tsx || break
done

# Optional regression proof for F122: with your new returns.test.ts in place, restore only the old
# returns.ts and confirm the "window edge" case FAILS under Vancouver (expected 20, receives 32), then restore:
#   git stash push app/components/MarketView/returns.ts
#   TZ=America/Vancouver pnpm exec jest app/components/MarketView/__tests__/returns.test.ts -t "window edge"
#   git stash pop

# Greps. Each must print nothing:
grep -rnE "toLocale(Date|Time)?String\(" app --include=*.ts --include=*.tsx | grep -v __tests__
grep -rnE "new Date\([^)]*recorded_at" app --include=*.ts --include=*.tsx | grep -v __tests__
grep -rn "resolvedOptions" app --include=*.ts --include=*.tsx | grep -v __tests__
grep -rnE '\$\$\{|"\$" *\+|`\$\$' app --include=*.ts --include=*.tsx | grep -v __tests__
# Remaining .toFixed( hits must all be percentages, exchange rates (toFixed(4)), tick keys
# (PriceChart.tsx:54-55), the file-size message, the two input pre-fills, or PortfolioChartImpl's
# compact "k" axis:
grep -rn "toFixed(" app --include=*.ts --include=*.tsx | grep -v __tests__

pnpm build:stub                                          # expect: build succeeds (WP00 harness)
```

Manual checks (need real data: either the PR's Vercel preview deployment, or `pnpm dev` with a `.env.local` holding the public `NEXT_PUBLIC_SUPABASE_URL` and anon key; the stub build has no products, so `/` renders no Recently Released section):

1. Chrome DevTools, "More tools > Sensors > Location", set Timezone to `America/Vancouver`. Hard-reload `/`. Console: no "Hydration failed" / "didn't match the client" error. Recently Released group headers read "Released Sep 26, 2026" style, cards read "Release: ..." and "Updated: Sep 25, 2026, 12:12 AM EDT" style (EDT or EST, never PDT, never UTC).
2. Same on `Asia/Tokyo`. Same strings, no hydration error.
3. Pick a set; compare its release date on `/prices` (group header), `/market` (Show all columns, Release column), `/stats`, `/compare` (after uploading a Shopify CSV), and `/product/[id]`. All identical, all "Mon D, YYYY".
4. `/` Quick Stats "Last Refreshed" ends in `EDT` or `EST` and equals the newest scrape time converted to Eastern (scrapes run around 04:00 UTC, i.e. around midnight EDT).
5. `/prices` in CAD: a product over $999 USD (for example a vintage booster box) shows `C$1,xxx.xx` with a comma. Toggle to USD: `$1,xxx.xx`. A product whose price is withheld shows `--` and, under it, "No current price, last recorded <date>".
6. `/compare`: CAD columns show `C$`, the "Market USD" column shows `$`, missing cells still show the em dash.
7. `/portfolio` (signed in, only works after WP05): a losing holding shows `-$12.34`, a gain `+$12.34`; chart tooltip and allocation tooltip show thousands separators; the chart X axis reads "Sep 26".
8. `/product/[id]`: the full chart tooltip shows `$1,649.99` style, Y-axis ticks `$1,650`, X-axis labels "Sep 26".

## Owner actions

None. (Optional: open the PR's Vercel preview and run manual checks 1 to 3 if the executor cannot.)

## Acceptance criteria

- [ ] `app/lib/format.ts` exists and exports `formatDateOnly`, `formatMonthDay`, `formatTimestamp`, `formatMoney`, `formatInteger`, `parseRecordedAt`, `recordedAtDateKey`, `CURRENCY_SYMBOL`, `DISPLAY_TIME_ZONE`, `CurrencyCode`; every `Intl` object in it is created at module scope.
- [ ] `grep -rnE "toLocale(Date|Time)?String\(" app --include=*.ts --include=*.tsx | grep -v __tests__` prints nothing.
- [ ] `grep -rnE "new Date\([^)]*recorded_at" app --include=*.ts --include=*.tsx | grep -v __tests__` prints nothing.
- [ ] `grep -rn resolvedOptions app --include=*.tsx --include=*.ts | grep -v __tests__` prints nothing.
- [ ] ESLint reports `no-restricted-properties` for any new `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString` in `app/` (check: add one temporarily, see the error, remove it).
- [ ] `pnpm exec tsc --noEmit` passes; `pnpm test --ci` passes; the four zone-sensitive files pass under `TZ=America/Vancouver` and `TZ=Asia/Tokyo`; the new CI step exists and is green.
- [ ] `pnpm build:stub` succeeds.
- [ ] Release dates on `/`, `/prices`, `/market`, `/stats`, `/compare` and `/product/[id]` print the same "Mon D, YYYY" string for the same set, in any browser zone.
- [ ] Loading `/` with the browser zone set to America/Vancouver logs no hydration error.
- [ ] "Last Refreshed" and the flat card "Updated:" line end in `EDT` or `EST`.
- [ ] Money above 999 shows a thousands separator on every page; negative money reads `-$x` / `-C$x`; `/compare` CAD columns use `C$`.
- [ ] A grouped catalog card with a withheld price shows "No current price, last recorded <date>" (or "No current price yet").
- [ ] `ProductCard` no longer computes the `Updated:` label outside the flat branch.

## Rollback

No migrations, no env vars, no data changes. Revert the merge commit (`git revert -m 1 <merge-sha>`) and redeploy. Partial rollback is also safe: `format.ts` has no side effects, so reverting individual call-site files restores their old output without breaking the others. If only the CI zone step misbehaves, delete that step; it gates nothing else.

## Commit and PR

Commit message:

```
fix(format): one module for dates, timestamps and money

Add app/lib/format.ts and route every user-visible date, timestamp and
money string through it. Date-only values are formatted by string split
(no zone, no locale), instants are shown in America/Toronto with their
EDT/EST label, and money uses $ / C$ with thousands separators.

- Release dates no longer print a day early west of UTC, and "/" no
  longer fails hydration (F007, F009, F010, F026).
- Consistent money and date style across pages (F089, F102).
- "Last Refreshed" shows its zone; stale catalog cards say why the price
  is missing (F096, F112, F115).
- ProductCard stops building Intl formatters per render (F072).
- recorded_at without an offset is parsed as UTC in return, CAGR and
  sparkline math (F122).
- ESLint bans bare toLocale* in app/; CI reruns the zone-sensitive tests
  under America/Vancouver and Asia/Tokyo.
```

PR title: `fix(format): shared date/timestamp/money formatting; fix off-by-one release dates and hydration on /`

PR body summary: what was wrong (release dates a day early for North American visitors, hydration error on `/`, `$1649.99` vs `$1,649.99`, unlabeled UTC "Last Refreshed", local-time parsing of UTC timestamps in return math); the three decisions (date-only by string split, fixed America/Toronto with label, `$`/`C$` symbols with en-US digits) and why; visible changes reviewers should expect (date style "Sep 26, 2026" everywhere, `C$` on /compare, `-$100.00` instead of `$-100.00`, "EDT/EST" on timestamps, stale-price note on grouped cards); how it was tested (unit tests, zone matrix, stub build, manual DevTools timezone check); follow-ups: WP08/WP09 build on this module, WP18 merges the duplicated return helpers in `serverMarketData.ts`/`ReturnMetrics.tsx`/`returns.ts`, WP20 may unify `CurrencyCode` with `ProductPrices/types` `Currency`.
