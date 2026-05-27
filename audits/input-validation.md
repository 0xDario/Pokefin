# Security Audit — Input Validation

**Target:** Pokefin (`/home/user/Pokefin`)
**Branch audited:** `claude/security-vulnerability-analysis-LT3JQ` (HEAD `961e8cd`)
**Date:** 2026-05-21
**Scope:** Input validation only — SQL injection, NoSQL injection, command injection, XSS, XXE, path traversal, request validation. Audited against the current (post-hardening) state of the code.
**Stack:** Next.js 15 App Router (TypeScript) + Supabase (`@supabase/ssr`, PostgREST builder, anon key) + Python scrapers (`requests`, Selenium, BeautifulSoup).

---

## Executive Summary

The recent hardening branch closed the highest-risk input-validation gaps: the LIKE-escape helper (`escapeLike`) neutralises wildcard injection into `ilike()`, the `next=` redirect parser blocks open-redirect payloads, and the account-delete route now enforces an Origin allowlist + custom header. Migration `0003` adds DB-level `CHECK` constraints that act as a backstop for numeric/date bounds, and `0002`/`0004`/`0005` route privileged operations through narrowly-scoped `SECURITY DEFINER` RPCs that bind to `auth.uid()`.

No SQL injection, command injection, or XXE was found. No `dangerouslySetInnerHTML` or `innerHTML`/`eval` sinks exist in the frontend. The residual issues are **defense-in-depth gaps**, not directly exploitable injection: client-side numeric validation is incomplete (NaN/Infinity/upper-bound), the CSV importer silently coerces malformed fields, several mutation entry points have no schema validation before reaching Supabase, there is no request body-size limit on the one API route, and the `box_recipes` text/JSONB fields (`name`, `packs`) reach the DB with no length/shape validation on either tier.

**Overall input-validation risk score: 3.5 / 10** (Low–Medium). The architecture is sound — PostgREST parameterises every query, RLS + DB `CHECK`s enforce a server-side floor — so the gaps degrade data integrity and UX robustness rather than enabling code/query injection.

---

## Findings

### F-1. CSV importer silently coerces malformed numeric fields; no NaN/Infinity/bounds rejection

- **Severity:** Medium
- **CWE:** CWE-20 (Improper Input Validation), CWE-1284 (Improper Validation of Specified Quantity in Input)
- **Evidence:** `frontend/app/lib/import.ts:137-140` (`parseCollectrCSV`), used by `processCollectrImport` (`import.ts:384`) and `importHoldings` (`import.ts:414-442`); UI entry `frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx:34-49`.
- **Details:** Each numeric CSV cell is parsed with `parseFloat(values[n]) || 0` / `parseInt(values[10]) || 0`:
  ```ts
  averageCostPaid: parseFloat(values[9]) || 0,
  quantity: parseInt(values[10]) || 0,
  marketPrice: parseFloat(values[11]) || 0,
  priceOverride: parseFloat(values[12]) || 0,
  ```
  The `|| 0` idiom catches `NaN` (falsy) and converts it to `0`, but does **not** catch `Infinity` — `parseFloat("Infinity")` and `parseFloat("1e400")` both yield `Infinity`, which is truthy and passes straight through. `quantity` is taken verbatim with no minimum: a value of `0` or a negative number (`parseInt("-5")` → `-5`) flows into `importHoldings` → `addHolding` unchanged (`import.ts:436`). Unlike the Add/Edit modals, the import path performs **no** `qty < 1` / `price < 0` validation.
- **Why it matters:** The importer bypasses the manual-entry validation in `AddHoldingModal`. A crafted CSV row with `quantity = 0`, a negative quantity, or an `Infinity`/over-range price corrupts portfolio analytics (`calculatePortfolioSummary`, `import.ts` consumers in `portfolio.ts:271-299`) and produces nonsensical NAV/gain-loss numbers.
- **Exploitability + minimal safe PoC:** Self-inflicted (the importer only writes to the caller's own portfolio under RLS), so impact is data-integrity, not privilege escalation. The DB `CHECK`s added in `migrations/0003` (`portfolio_holdings_quantity_sane CHECK (quantity BETWEEN 1 AND 100000)`, `portfolio_holdings_price_sane CHECK (purchase_price_usd BETWEEN 0 AND 1000000)`) **do** reject the out-of-range rows — but only by returning an opaque insert error per row; `addHolding` swallows it (`portfolio.ts:209` logs code and returns `null`) and the importer reports a generic `"Failed to add holding to portfolio"` (`import.ts:453`). PoC CSV row:
  ```
  Sealed Product,Pokemon,Destined Rivals,Destined Rivals Booster Box,,,Normal,Ungraded,Near Mint,Infinity,0,538.64,0,false,2025-06-08,
  ```
  → `averageCostPaid = Infinity`, `quantity = 0`.
- **Remediation (minimal drop-in):** Validate and clamp inside `parseCollectrCSV` so bad rows are caught before the DB round-trip:
  ```ts
  function finiteNum(raw: string, min: number, max: number): number {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return min;
    return Math.min(Math.max(n, min), max);
  }
  function intInRange(raw: string, min: number, max: number): number {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return min;
    return Math.min(Math.max(n, min), max);
  }
  // ...
  averageCostPaid: finiteNum(values[9], 0, 1_000_000),
  quantity: intInRange(values[10], 1, 100_000),
  marketPrice: finiteNum(values[11], 0, 1_000_000),
  priceOverride: finiteNum(values[12], 0, 1_000_000),
  ```
  Also have `importHoldings` skip rows where `quantity < 1` and surface a per-row reason instead of a generic error.
- **Defense-in-depth:** Cap CSV size before parsing (see F-5); reject CSVs with > N data rows; in `addHolding` distinguish `CHECK`-violation error codes (`23514`) from `23505` and bubble a typed reason up to the importer UI.

---

### F-2. Manual holding forms miss upper-bound and Infinity checks

- **Severity:** Low
- **CWE:** CWE-20, CWE-1284
- **Evidence:** `frontend/app/components/Portfolio/cards/AddHoldingModal.tsx:57-67`; `frontend/app/components/Portfolio/cards/EditHoldingModal.tsx:46-56`.
- **Details:** Both modals validate the lower bound and `NaN`:
  ```ts
  const qty = parseInt(quantity);
  if (isNaN(qty) || qty < 1) { setError("Quantity must be at least 1"); return; }
  const price = parseFloat(purchasePrice);
  if (isNaN(price) || price < 0) { setError("Please enter a valid purchase price"); return; }
  ```
  Missing: no upper bound (DB allows up to `100000` / `1000000`), and `isNaN` does not catch `Infinity` — `parseFloat("1e999")` → `Infinity`, which is not `NaN`, is `>= 0`, and passes. The `<input type="number">` controls help in browsers but client validation must not rely on the widget (the value is also typed/pasteable, and the function is directly callable).
- **Why it matters:** Minor — the `migrations/0003` `CHECK` constraints reject out-of-range and non-finite values at the DB, so the worst case is a generic `"Failed to add holding"` toast rather than a precise message. Purely a UX/robustness gap.
- **Exploitability:** Self-scoped; no cross-tenant impact. `Infinity` would be rejected by Postgres (`double precision` accepts `Infinity`, but `CHECK (... BETWEEN 0 AND 1000000)` is false for `Infinity`).
- **Remediation (minimal drop-in):** Use `Number.isFinite` and mirror the DB bounds:
  ```ts
  if (!Number.isFinite(qty) || qty < 1 || qty > 100_000) {
    setError("Quantity must be between 1 and 100,000"); return;
  }
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
    setError("Purchase price must be between 0 and 1,000,000"); return;
  }
  ```
- **Defense-in-depth:** DB `CHECK` constraints already present — keep them; they are the authoritative floor.

---

### F-3. `box_recipes` text/JSONB inputs reach the DB with no validation on either tier

- **Severity:** Medium
- **CWE:** CWE-20, CWE-1284
- **Evidence:** `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:73-152` (`saveRecipe`); `frontend/app/components/BoxCalculator/BoxCalculator.tsx:167-190` (`handleSave`), `:253` (`recipeName` input), `:469`/`:490` (`promoValue`/`retailPrice`); schema `migrations/create_box_recipes.sql`.
- **Details:** `saveRecipe` inserts/updates `box_recipes` with `name` (free text), `packs` (JSONB array built by `toDbPacks`, `useBoxRecipes.ts:16-18`), `retail_price`, `promo_value`. No tier validates:
  - `name` length — `recipeName` is an unbounded `<input type="text">` (`BoxCalculator.tsx:253`); the `box_recipes.name` column is `text` with no length `CHECK`. A multi-megabyte name is accepted.
  - `packs` shape/size — `toDbPacks` maps whatever is in component state; `set_id`/`quantity` are never bounded. The `0003` numeric `CHECK`s apply to `portfolio_holdings`/`portfolio_lots`, **not** `box_recipes`. `create_box_recipes.sql` only constrains `retail_price >= 0` and `promo_value >= 0`.
  - `promoValue`/`retailPrice` — the inputs clamp the lower bound client-side (`Math.max(0, parseFloat(...) || 0)`, `BoxCalculator.tsx:469`,`490`), so `NaN` → `0` and negatives → `0`, but `Infinity` is not caught and there is no upper bound. `Infinity` would be rejected by `CHECK (retail_price >= 0)` only if Postgres treats `Infinity >= 0` as false — it does not (`'Infinity'::float8 >= 0` is true), so an `Infinity` price **persists**.
- **Why it matters:** Recipes are user-owned and (when `is_public`) readable by anyone via the `get_shared_recipe` RPC (`migrations/0005`). Oversized `name`/`packs` is a low-cost storage-abuse / payload-bloat vector on a free-tier Supabase project; an `Infinity` price silently corrupts the shared NAV calculation for every viewer of that share link.
- **Exploitability:** Authenticated user writes their own row; a public share link then serves the malformed data to anonymous viewers. No cross-account write.
- **Remediation (minimal drop-in):** Validate in `saveRecipe` before the insert/update:
  ```ts
  const name = (recipe.name ?? "").trim().slice(0, 120);
  if (!name) return null;
  const retail = Number.isFinite(recipe.retailPrice)
    ? Math.min(Math.max(recipe.retailPrice, 0), 1_000_000) : 0;
  const promo = Number.isFinite(recipe.promoValue)
    ? Math.min(Math.max(recipe.promoValue, 0), 1_000_000) : 0;
  if (recipe.packs.length > 200) return null;
  const packs = recipe.packs
    .filter(p => Number.isInteger(p.setId) && Number.isInteger(p.quantity)
                 && p.quantity >= 1 && p.quantity <= 100_000);
  ```
- **Defense-in-depth:** Add DB-level `CHECK`s to `box_recipes` mirroring `0003`:
  ```sql
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
    ADD CONSTRAINT box_recipes_retail_finite CHECK (retail_price >= 0 AND retail_price < 1e7),
    ADD CONSTRAINT box_recipes_promo_finite  CHECK (promo_value  >= 0 AND promo_value  < 1e7),
    ADD CONSTRAINT box_recipes_packs_array CHECK (jsonb_typeof(packs) = 'array');
  ```

---

### F-4. Shared-recipe JSONB consumed without shape validation (untrusted-input deserialization)

- **Severity:** Low
- **CWE:** CWE-20, CWE-502 (Deserialization of Untrusted Data — JSON shape only, not code-exec)
- **Evidence:** `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:177-207` (`loadSharedRecipe`), `:20-30` (`fromDbPacks`); consumed in `BoxCalculator.tsx:109-125` (`loadRecipeIntoState`).
- **Details:** `loadSharedRecipe` takes a caller-supplied `shareCode` from the `?recipe=` URL param (`BoxCalculator.tsx:110`) and returns rows from another user's `box_recipes` row via the `get_shared_recipe` RPC. The returned `row.packs` is passed straight to `fromDbPacks(row.packs || [], ...)` and `row.name`/`row.retail_price`/`row.promo_value` are loaded into component state with no type/shape checks. `fromDbPacks` does `dbPacks.map(...)` — if `packs` is a JSON object or string rather than an array, `.map` throws and the calculator crashes (caught by `app/error.tsx`, but a needless crash).
- **Why it matters:** The author of a public recipe controls `packs`/`name` and could store a malformed shape. There is no XSS sink (React escapes `setName`/`recipeName` in JSX — `BoxCalculator.tsx:254,403`), so the impact is a render crash / corrupted calculation, not script execution.
- **Exploitability:** Requires the victim to open a malicious share link. No script execution because all interpolation goes through React's JSX text escaping; no `dangerouslySetInnerHTML` anywhere (confirmed by grep).
- **Remediation (minimal drop-in):** Guard `fromDbPacks` and the loader:
  ```ts
  function fromDbPacks(dbPacks: unknown, setNameMap: Map<number, string>): PackEntry[] {
    if (!Array.isArray(dbPacks)) return [];
    return dbPacks
      .filter((p): p is { set_id: number; quantity: number } =>
        !!p && typeof p === "object"
        && Number.isInteger((p as any).set_id)
        && Number.isInteger((p as any).quantity))
      .map((p) => ({
        id: crypto.randomUUID(),
        setId: p.set_id,
        setName: setNameMap.get(p.set_id) || `Set #${p.set_id}`,
        quantity: Math.min(Math.max(p.quantity, 1), 100_000),
      }));
  }
  ```
- **Defense-in-depth:** Enforce the `jsonb_typeof(packs) = 'array'` `CHECK` from F-3 so a non-array shape can never be stored.

---

### F-5. `DELETE /api/account/delete` has no request body / size handling; no other content validation

- **Severity:** Low
- **CWE:** CWE-20, CWE-770 (Allocation of Resources Without Limits)
- **Evidence:** `frontend/app/api/account/delete/route.ts:21-71`.
- **Details:** The route is the only `route.ts` API handler. It correctly gates on the `x-pokefin-request: 1` custom header (CSRF defense) and an Origin allowlist (`isAllowedOrigin`, lines 11-19), and authenticates via `supabase.auth.getUser()`. It never reads `request.body`, so there is no parsing/coercion bug — but Next.js route handlers have no built-in body-size cap, and a `DELETE` with a large body is accepted and buffered by the platform before the handler runs. There is no rate limiting on this destructive endpoint either (out of strict scope, noted).
- **Why it matters:** Minor. The endpoint takes no parameters, so there is no parameter pollution or type-confusion surface; the only residual concern is unbounded request buffering. The destructive action itself is safe — `delete_my_account()` (`migrations/0002`) is `SECURITY DEFINER` with `WHERE id = auth.uid()`, so a caller can only ever delete their own account.
- **Exploitability:** "Unable to verify" precisely — depends on the hosting platform's default body limit (Vercel caps at ~4.5 MB for serverless functions). No injection.
- **Remediation (minimal drop-in):** Reject any body explicitly and add a size guard:
  ```ts
  const len = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > 0) {
    return NextResponse.json({ error: "Body not allowed" }, { status: 400 });
  }
  ```
- **Defense-in-depth:** Add rate limiting (e.g. Supabase edge / upstream WAF) to the `/api/account/*` matcher; the middleware already protects the path for auth (`middleware.ts:53`).

---

### F-6. `next=` redirect parser is sound but does not normalise control characters

- **Severity:** Low (informational — current code is effectively safe)
- **CWE:** CWE-601 (URL Redirection to Untrusted Site)
- **Evidence:** `frontend/app/auth/callback/route.ts:4-19` (`safeNextPath`), used at `:24` and `:30`.
- **Details:** `safeNextPath` is the hardened parser. It rejects anything not starting with `/`, rejects `//` and `/\` (protocol-relative / backslash), and additionally `decodeURIComponent`-decodes once and re-checks for `//`/`/\` to catch `/%2f...`. This blocks the standard open-redirect payloads (`//evil.com`, `/\evil.com`, `/%2f%2fevil.com`). The value is then passed to `new URL(next, request.url)` (line 30), which resolves it relative to the same origin — a path that survives the checks still cannot escape the origin. One residual nuance: a `next` containing a raw newline/`\r` or other control char is not stripped; `new URL` will throw or normalise rather than redirect off-origin, so this is not exploitable, just untidy.
- **Why it matters:** Effectively none today — listed for completeness because the audit brief calls out the redirect parser specifically. The combination of prefix checks + single decode + same-origin `new URL` resolution closes the open-redirect class.
- **Remediation (optional hardening):** Strip control chars and cap length before returning:
  ```ts
  if (/[\x00-\x1f\x7f]/.test(raw)) return "/";
  if (raw.length > 512) return "/";
  ```
  Note `decodeURIComponent` is called once — a double-encoded payload (`%252f`) decodes to `%2f` (literal text), which `new URL` treats as a path segment, not a slash, so single-decode is sufficient here.
- **Defense-in-depth:** `next.config.ts` already sets `form-action 'self'` and `base-uri 'self'` in the CSP, which constrain navigation/base targets independently.

---

### F-7. Signup username regex anchoring relies on a single client check; verified DB backstop present

- **Severity:** Low (informational — adequately defended)
- **CWE:** CWE-20
- **Evidence:** `frontend/app/auth/signup/page.tsx:48-66` (`handleSubmit`); server path `AuthContext.tsx:117-129` (`signUp` → `options.data.username`); trigger `migrations/0004_handle_new_user_trigger.sql`; constraint `migrations/0003_integrity_constraints.sql` (`profiles_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,32}$')`).
- **Details:** The signup form validates `username.length < 3` and `/^[a-zA-Z0-9_]+$/.test(username)` (correctly anchored, no `ReDoS` risk — the class is linear). It does **not** enforce an upper length bound client-side. The username travels in `supabase.auth.signUp({ options: { data: { username } } })` as user metadata and is written to `profiles` server-side by the `handle_new_user()` `SECURITY DEFINER` trigger via `NEW.raw_user_meta_data->>'username'`. Critically, `migrations/0003` adds `profiles_username_format CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,32}$')`, which **is** the authoritative server-side validation: an over-length or malformed username makes the trigger's `INSERT` fail. Email is validated only by `<input type="email">` + Supabase Auth's own email validation (adequate).
- **Why it matters:** Low. The client check is bypassable (the form is `"use client"`), but the DB `CHECK` rejects anything outside `[A-Za-z0-9_]{3,32}` — a bypass attempt fails the trigger insert. The username is never used in raw SQL and is escaped by React on render, so there is no injection/XSS path.
- **Remediation (minimal drop-in):** Mirror the DB bound in the form for a better error message:
  ```ts
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    setError("Username must be 3–32 characters: letters, numbers, underscores"); return;
  }
  ```
- **Defense-in-depth:** Already strong — DB `CHECK` + `SECURITY DEFINER` trigger remove the client-controlled `profiles.insert` mass-assignment surface (closed `M-10` per migration comments). Confirmed `AuthContext.tsx` no longer inserts into `profiles` directly.

---

## Items Checked — No Finding

### SQL Injection — PASS
- **PostgREST builder:** Every Supabase call uses the typed query builder (`.from().select().eq().ilike().in().order().insert().update().delete()`). Values are sent as parameters, not concatenated into SQL. Verified across `portfolio.ts`, `import.ts`, `useBoxRecipes.ts`, `serverMarketData.ts`, `clientMarketData.ts`, `AuthContext.tsx`.
- **`.ilike()` LIKE-pattern handling:** `searchProducts` (`portfolio.ts:453-472`) and `searchProductsBySet` (`portfolio.ts:477-507`) wrap user query text with `escapeLike` (`portfolio.ts:446-448`, `input.replace(/[%_\\]/g, "\\$&")`) before the `` `%${...}%` `` template. This neutralises `%`/`_`/`\` wildcard injection — a single-char query can no longer match everything. `searchProducts` also enforces `query.length < 2 → []`. This is the only LIKE/ILIKE usage; no `.like()`.
- **`.or()` / `.filter()` raw strings (frontend):** No `.or()` or raw `.filter()` PostgREST calls in the frontend. The `.filter(...)` hits found by grep are all JavaScript `Array.prototype.filter` (component data shaping), not PostgREST filters — confirmed by inspection.
- **`.or_()` raw string (Python):** `main.py:518` builds `or_filter` with f-string interpolation: `last_updated.lt.{price_interval_ago.isoformat()}` etc. The interpolated values are server-generated `datetime` ISO strings (`backfill_historical_prices.py:261` similar) — **not user input** — so this is not injectable today. Noted as a latent pattern: if a user-controlled value were ever interpolated here it would be a PostgREST-filter-injection bug. Recommend switching to chained `.or_` with discrete operators or asserting the inputs are `datetime` before formatting.
- **`SECURITY DEFINER` functions (migrations):** `delete_my_account()` (`0002`), `handle_new_user()` (`0004`), `get_shared_recipe(text)` (`0005`) are all parameterised — no dynamic SQL, no `EXECUTE`, no string concatenation. `delete_my_account` and `handle_new_user` bind to `auth.uid()`/`NEW.id`; `get_shared_recipe` uses its `p_share_code` parameter as a bound value in a `WHERE` clause. All three set an explicit `search_path` (mitigates function-hijack via schema shadowing) and `REVOKE ... FROM public` then `GRANT EXECUTE` to least-privileged roles. The analytics functions in `20260506_market_performance_functions.sql` (`get_market_product_metrics`, `get_market_product_summaries`, `get_set_analytics`) are `LANGUAGE sql STABLE`, take **no parameters**, and contain no dynamic SQL — not an injection surface. (Note: those three are *not* declared `SECURITY DEFINER` and have no explicit `search_path`; out of scope for input validation, flag for the SQL/DB-config audit.)

### NoSQL Injection — NOT APPLICABLE
The only datastore is Postgres (Supabase). No MongoDB/Redis/document store. Confirmed: no `mongodb`, `mongoose`, `ioredis` in `frontend/package.json`; no document-DB driver in `requirements.txt`. The `packs` JSONB column is relational JSONB, not a NoSQL query surface — values are bound parameters, never query operators.

### Command Injection — PASS
- No `subprocess`, `os.system`, `os.popen`, `shell=True`, `eval`, `exec`, or `__import__` in any Python file (`main.py`, `backfill_historical_prices.py`, `compare_prices.py`, `generate_skus.py`, `update_shopify_skus.py`) — verified by grep.
- **Selenium / webdriver invocation:** `main.py:212` — `webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)`. The driver path comes from `ChromeDriverManager()` (a managed download), not from external input. Chrome `Options` flags (`main.py` ~`184-215`) and `user_data_dir` (`main.py:208`, `os.path.join(tempfile.gettempdir(), f"chrome_scraper_{time}_{pid}")`) are constructed from process-local values (`time.time()`, `os.getpid()`) — no external data reaches a shell or an argv. `driver.execute_script(...)` (`main.py:215`) runs a **static** JS string in the browser context, not on the host — not command injection.
- No frontend `child_process` / `exec` (Next.js app has no server-side shell-out).

### XSS Prevention — PASS
- **No dangerous sinks:** `grep` for `dangerouslySetInnerHTML`, `innerHTML`, `eval(` across `frontend/app/**` returns nothing. All dynamic values render as JSX text children (e.g. `BoxCalculator.tsx:403` `{pack.setName}`, `:254` `{recipeName}`, signup `signup/page.tsx:93` `{email}`, import modal `ImportHoldingsModal.tsx:353` `{result.csvRow.set}`), which React HTML-escapes by default.
- **`<img src>` from data:** `EditHoldingModal.tsx:122-126` and `ImportHoldingsModal.tsx:329` render `<img src={product.image_url}>` from DB data. `image_url` is populated by the scraper from a Supabase Storage public URL or a TCGPlayer URL. A `src` attribute cannot execute script; the CSP `img-src` directive (`next.config.ts:7`) restricts image origins to `tcgplayer.com` / `*.supabase.co` / `data:` / `blob:`, so even a poisoned `image_url` cannot exfiltrate via an arbitrary image host beyond those. No `javascript:` URI sink (those only matter for `href`/navigation; not present for user data).
- **Content-Type:** The one API route returns `NextResponse.json(...)` (`route.ts`), which sets `application/json` — no HTML-typed reflected response. No route returns user input with a `text/html` content type.
- **CSP (`next.config.ts:3-16`):** Present and reasonably strict — `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests`. **Weakness (defense-in-depth, not a finding here):** `script-src` includes `'unsafe-inline'`, which removes CSP's ability to block injected inline `<script>` — acceptable only because no injection sink exists, but it means CSP is not a backstop if one is later introduced. Recommend nonce/hash-based `script-src` (flag for the API/infra audit; Next.js supports nonces).

### XXE — PASS
- **BeautifulSoup parser choice:** `main.py:458-459` — `BeautifulSoup(response.text, "html.parser")`. `html.parser` is Python's pure-Python HTML parser; it does **not** process XML DTDs, external entities, or parameter entities. This is the XXE-safe choice. (`backfill_historical_prices.py` does not parse HTML/XML; `compare_prices.py`/`generate_skus.py`/`update_shopify_skus.py` parse CSV only.)
- **No `lxml` / `etree`:** No `lxml`, `xml.etree`, `XMLParser`, `etree.fromstring`, or `xml.dom` usage anywhere — `requirements.txt` has no `lxml`. No XML is parsed at all in the app; the Bank-of-Canada page is parsed as HTML.
- **Frontend:** No `DOMParser`/XML parsing of untrusted input.

### Path Traversal — PASS
- **Image filename construction (`main.py:236-247`):** `filename = f"products/{product_id}.{file_extension}"`. `product_id` is an integer primary key from the `products` table (not external text). `file_extension` is derived from a scraped URL (`image_url.split('.')[-1].split('?')[0].lower()`) but is then **allowlisted** — `if file_extension not in ['jpg','jpeg','png','webp']: file_extension = 'jpg'` (`main.py:244-245`) — so it cannot contain `/`, `..`, or NUL. The result is uploaded to Supabase Storage (`storage.from_("product-images").upload(filename, ...)`), an object store with its own key namespacing, not a host filesystem path.
- **File reads/writes in Python:** `generate_skus.py:279` (`open(filename, "w", ...)`), `compare_prices.py:159/554`, `update_shopify_skus.py:116/134/295`, `backfill_historical_prices.py:157/159/180` — all open paths that are **hardcoded constants or CLI-arg-supplied operator input**, not request/scrape-derived data. No path is built from scraped HTML or web request input. The Next.js app performs no filesystem reads from user input.
- **Dynamic route param `[id]`:** `frontend/app/product/[id]/page.tsx:99,123` coerces `id` with `Number(id)` and `notFound()`s on `!Number.isFinite(productId)` (`:124`) — the value reaches Supabase as a typed number via `.eq()`, never as a path segment. `getReleaseMs` (`page.tsx:27`) regex-validates date strings before parsing. Safe.

### Request Validation — PARTIAL (see F-1, F-2, F-3, F-5)
- **`route.ts` handlers:** Only `api/account/delete/route.ts`. It validates auth (`getUser`), CSRF header, and Origin — strong. It takes no body parameters, so there is no field-validation surface, but also no explicit body rejection (F-5).
- **`auth/callback/route.ts`:** Validates `code` presence (`:34`) and `next` via `safeNextPath` (F-6); `type` is compared against the literal `"recovery"` (`:28`). Adequate.
- **Auth forms:** login/forgot-password rely on `<input type="email">` + Supabase Auth validation (acceptable); signup adds username checks (F-7); reset-password validates `password === confirmPassword` and `length >= 8` (`reset-password/page.tsx:84-92`) — matches signup. No password upper-length or complexity bound (low risk; Supabase Auth caps password length internally).
- **Holding modals:** lower-bound + `NaN` validated; upper-bound + `Infinity` missing (F-2).
- **CSV import:** weak coercion (F-1).
- **Box calculator inputs:** `promoValue`/`retailPrice` clamp `>= 0` but not `Infinity`/upper-bound; `recipeName`/`packs` unvalidated (F-3).
- **Parameter pollution:** Next.js `URLSearchParams.get()` returns the first value for a repeated key — deterministic, no last-wins ambiguity. PostgREST builder methods take discrete args, not query strings, so duplicate-param pollution does not reach the DB.

---

## Top Prioritized Fixes

1. **F-1 — Harden CSV numeric parsing** (`import.ts:137-140`). Reject/clamp `NaN`, `Infinity`, negative quantity, and out-of-range price *before* the DB round-trip; skip and report bad rows per-row instead of a generic error. Highest priority: it is the one path that bypasses the manual-entry validation.
2. **F-3 — Validate `box_recipes` writes** (`useBoxRecipes.ts saveRecipe`) and add matching DB `CHECK` constraints. The recipe `name`/`packs`/`promo`/`retail` fields currently reach Postgres unvalidated on both tiers; an `Infinity` price persists and corrupts shared-link calculations.
3. **F-4 — Guard `fromDbPacks` against non-array `packs`** (`useBoxRecipes.ts:20-30`). Prevents a malicious public recipe from crashing the calculator for viewers.
4. **F-2 — Add `Number.isFinite` + upper bounds to Add/Edit holding modals** (`AddHoldingModal.tsx:57-67`, `EditHoldingModal.tsx:46-56`). Quick win; aligns client validation with the `0003` DB `CHECK`s.
5. **F-5 — Reject request bodies on `DELETE /api/account/delete`** and add rate limiting to `/api/account/*`. Defensive; small change.

---

## Checklist Diff (7 items)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | SQL Injection | **PASS** | PostgREST parameterised; `escapeLike` neutralises `ilike` wildcards; all `SECURITY DEFINER` RPCs parameterised with fixed `search_path`. `main.py:518` `.or_()` interpolates only server-generated timestamps (latent — not user input). |
| 2 | NoSQL Injection | **N/A** | Postgres only; no document store / NoSQL driver in either dependency manifest. |
| 3 | Command Injection | **PASS** | No `subprocess`/`os.system`/`shell=True`/`eval`; Selenium driver path & flags from process-local values; `execute_script` runs a static string in-browser. |
| 4 | XSS Prevention | **PASS** | No `dangerouslySetInnerHTML`/`innerHTML`/`eval`; React text-escaping; CSP present (note: `script-src 'unsafe-inline'` weakens CSP as a backstop — defense-in-depth recommendation, not a finding). |
| 5 | XXE | **PASS** | BeautifulSoup uses `html.parser` (no DTD/entity processing); no `lxml`/`etree`; no XML parsed anywhere. |
| 6 | Path Traversal | **PASS** | Image filename uses integer `product_id` + allowlisted extension; all Python file I/O on hardcoded/CLI paths, none from scraped/request data; route `[id]` coerced to a finite number. |
| 7 | Request Validation | **FAIL (partial)** | CSV import coercion weak (F-1); holding modals miss `Infinity`/upper-bound (F-2); `box_recipes` text/JSONB unvalidated on both tiers (F-3); shared-recipe JSONB shape unchecked (F-4); no body-size guard on the API route (F-5). DB `CHECK`s in `0003` provide a partial server-side floor for `portfolio_holdings`/`portfolio_lots` only. |

---

## Endpoint / Input-Surface Validation Matrix

| Input surface | Location | Untrusted input | Validation present | Gap | Status |
|---|---|---|---|---|---|
| `DELETE /api/account/delete` | `api/account/delete/route.ts:21` | headers, (no body) | `x-pokefin-request` header, Origin allowlist, `getUser()` auth; RPC bound to `auth.uid()` | No explicit body rejection / size cap; no rate limit (F-5) | Pass (minor) |
| `GET /auth/callback` | `auth/callback/route.ts:21` | `code`, `next`, `type` query params | `safeNextPath` (prefix + single-decode checks); `type === "recovery"` literal; `code` presence check; same-origin `new URL` | No control-char strip / length cap on `next` (F-6 — not exploitable) | Pass |
| Signup form | `auth/signup/page.tsx:44` | email, username, password, confirm | `username` regex `^[A-Za-z0-9_]+$` + `len>=3`; password `len>=8`; match check; Turnstile captcha; DB `CHECK profiles_username_format` backstop | No username upper-length client-side (DB rejects) (F-7) | Pass |
| Login form | `auth/login/page.tsx:35` | email, password | `<input type=email>`, Supabase Auth validation, Turnstile | none material | Pass |
| Forgot-password form | `auth/forgot-password/page.tsx:26` | email | `<input type=email>`, Supabase Auth | none material | Pass |
| Reset-password form | `auth/reset-password/page.tsx:80` | password, confirm; URL hash `access_token`/`type` | password `len>=8` + match; `type==="recovery"` check before `setSession` | No password upper bound (Supabase caps internally) | Pass |
| Add Holding modal | `cards/AddHoldingModal.tsx:48` | quantity, price, date, notes, product | `qty`: `isNaN`+`<1`; `price`: `isNaN`+`<0`; date required + `max=today`; product required | No `Infinity` catch, no upper bound (F-2); DB `CHECK` backstop | Fail (partial) |
| Edit Holding modal | `cards/EditHoldingModal.tsx:40` | quantity, price, date, notes | same as Add; ownership via `updateHolding(id,userId,...)` | No `Infinity` catch, no upper bound (F-2) | Fail (partial) |
| CSV import (file/paste) | `cards/ImportHoldingsModal.tsx:34,43` → `lib/import.ts:115` | full CSV content | row col-count `>=16`; `category`/`portfolioName` literal filter; `parseFloat/parseInt \|\| 0` | `Infinity` passes; `quantity` 0/negative passes; no size cap; bypasses modal validation (F-1) | Fail |
| `searchProducts` | `lib/portfolio.ts:453` | search query string | `len<2 → []`; `escapeLike`; `.ilike` parameterised; `.limit(20)` | none | Pass |
| `searchProductsBySet` | `lib/portfolio.ts:477` | set-name string | `escapeLike`; `.ilike` parameterised; `.limit(50)` | none | Pass |
| Box calculator — pack qty | `BoxCalculator.tsx:373` | quantity number | `Math.max(1, parseInt \|\| 1)`; `min/max` on `<input>` | (within recipe — see F-3) | Pass (input) |
| Box calculator — promo/retail | `BoxCalculator.tsx:469,490` | promo, retail numbers | `Math.max(0, parseFloat \|\| 0)` | `Infinity` not caught; no upper bound (F-3) | Fail (partial) |
| Box calculator — recipe name | `BoxCalculator.tsx:253` | free-text name | none | unbounded length; no DB `CHECK` (F-3) | Fail |
| `saveRecipe` (box_recipes write) | `hooks/useBoxRecipes.ts:73` | name, packs, retail, promo | RLS + `.eq(user_id)`; `CHECK retail/promo >= 0` | no name/packs/Infinity validation either tier (F-3) | Fail |
| `loadSharedRecipe` (box_recipes read) | `hooks/useBoxRecipes.ts:177` | `?recipe=` share code → others' JSONB | `get_shared_recipe` RPC param-bound, `is_public` gate, `LIMIT 1` | returned `packs` shape unchecked → `fromDbPacks` crash (F-4) | Fail (partial) |
| `addHolding` | `lib/portfolio.ts:188` | NewHolding object | idempotency key; DB `CHECK`s on insert | trusts caller-supplied numbers (callers F-1/F-2 validate partially) | Pass (DB-backed) |
| `updateHolding` / `deleteHolding` | `lib/portfolio.ts:220,245` | holdingId, updates | `userOwnsHolding` pre-check + RLS + `.eq(id)` | trusts `updates` shape (numbers from modal F-2) | Pass |
| Product detail route `[id]` | `product/[id]/page.tsx:99,123` | dynamic route segment | `Number(id)` + `Number.isFinite` → `notFound()` | none | Pass |
| Python scraper — TCGPlayer HTML/JSON | `main.py:329,458` | scraped HTML/JSON, image URLs | `BeautifulSoup("html.parser")`; image ext allowlist; price `float()` in try/except; API JSON via `_select_api_result` | image URL fetched server-side (SSRF — out of scope, flag for infra audit) | Pass (input-validation scope) |
| Python — exchange rate scrape | `main.py:447` | scraped rate cell text | `float(cell_text)`; `0003` DB `CHECK exchange_rates_usd_to_cad_sane (>0.5 AND <5.0)` | a NaN/garbage cell would raise (caught) | Pass |

---

## Notes / Unable to Verify

- **F-5 body-size limit:** The effective request-body cap depends on the deployment platform's default (e.g. Vercel ~4.5 MB). The repo does not pin a hosting platform config, so the precise limit is **Unable to verify** from static analysis.
- **Runtime CSP enforcement:** `next.config.ts` declares the CSP header; whether a reverse proxy or `vercel.json` overrides it at the edge is **Unable to verify** statically.
- **`main.py:518` `.or_()` interpolation:** Confirmed non-injectable *today* because only `datetime.isoformat()` values are interpolated. If the codebase later interpolates user-controlled text there, it becomes a PostgREST-filter-injection bug — flagged as a latent pattern, not a current finding.
- The analytics SQL functions in `20260506_market_performance_functions.sql` are not `SECURITY DEFINER` and lack an explicit `search_path` — noted in passing; this is a DB-configuration concern outside the input-validation scope and belongs to the SQL/infra audit.
