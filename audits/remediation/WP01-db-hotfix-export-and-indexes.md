# WP01: Database hotfix: data export and missing indexes

- **Findings covered**
  - F020 (full): `export_my_data()` is declared `STABLE` but runs an `INSERT` into `auth_events`, so every call fails and "Export my data" has never worked in production.
  - F134 (full): after `0014`, `portfolio_holdings(portfolio_id)` and `portfolio_lots(holding_id)` have no usable index in a database built from the repo, while the app's holdings read (`frontend/app/lib/portfolio.ts:279`, `.eq("portfolio_id", ...)`), `export_my_data()` and the account-deletion cascade (`migrations/0002_account_deletion.sql:14-22`, both foreign keys) filter on them. The RLS policies are not the cost: `holdings_self` and `lots_self` (`0014:65-87`) probe `portfolios` and `portfolio_holdings` by primary key, so do not cite them as the reason for these indexes. (The app does not read `portfolio_lots` today; it only inserts. Lots are filtered by `holding_id` only in `export_my_data()` and in the cascade from `portfolio_holdings`.) Full-effort verdict: real, severity low (performance only; about 1 ms per holdings read and 5 ms per account delete at 20k holdings on a rebuilt database, invisible at current volume; likely already covered in production by the legacy index). The verdict confirmed the fix, including keying the existence check on `pg_index.indkey[0]` with `indpred IS NULL` and `indisvalid`, which step 2 already does. The production index list is read by the owner before `0025` is applied (Owner actions, step 5).
- **Priority rationale**: a compliance feature (GDPR Art. 15/20 export) has failed for 100% of users since 2026-05-27 and the fix is one keyword in a new migration. F134 is low severity (performance only, no user-visible symptom at current data volume); it rides along because it is a small, independent migration in the same apply session.
- **Effort**: S (2 to 3 hours for the executor, plus about 15 minutes of owner time in Supabase).
- **Depends on**: none. Needs no frontend build, so WP00 is not required.
- **Unblocks**: WP10 (its migrations must be numbered after the two added here) and WP21 (schema baseline must include these objects).
- **Suggested branch name**: `remediation/wp01-db-hotfix-export-and-indexes`
- **Risk level**: low. The function body is copied verbatim and only its volatility and ACL change; the index migration only adds indexes to two small per-user tables and skips any that already exist.

## Why

Clicking "Export my data" on `/account` shows "Preparing..." and then the red message "Failed to export data" for every user, and no file downloads. The cause is in the database: `migrations/0011_export_my_data.sql:10` declares the function `STABLE`, and Postgres refuses the audit `INSERT` at `0011:84-85` inside a non-volatile function (`ERROR: INSERT is not allowed in a non-volatile function`). The route at `frontend/app/api/account/export/route.ts:65-68` turns that into HTTP 500. The production catalog was read on 2026-09-25: the deployed function has `provolatile = 's'`, `proacl` still includes `anon=X`, and `auth_events` holds zero `data_exported` rows, so no export has ever succeeded. Separately, any database rebuilt from `migrations/` (staging, branch, disaster restore) has no index on the two foreign keys that the holdings read (`WHERE portfolio_id = ...`), `export_my_data()` (`WHERE portfolio_id = ...` and `WHERE holding_id = ...`) and every account-deletion cascade filter on, so those become sequential scans over all users' rows. After this PR and the owner applying two migrations, the export downloads a JSON file and writes its audit row, anon can no longer call the RPC, and both foreign keys are indexed everywhere without duplicating production's legacy index.

## Before you start

Read these files fully:

- `migrations/0011_export_my_data.sql` (92 lines; the function you will re-create)
- `migrations/0006_function_execute_grants_hardening.sql:7-9` (the `FROM public, anon` revoke pattern)
- `migrations/0023_price_freshness_guard.sql:50-60` (why Supabase's bootstrap ACL leaves `anon` with EXECUTE) and `:125-134` (the precedent for re-creating an index that `0014` dropped)
- `migrations/0014_rls_perf_and_dedupe.sql:65-87` (the `holdings_self` / `lots_self` policies; note they look up `portfolios` and `portfolio_holdings` by primary key, so they do not need the new indexes) and `:106-112` (the `DROP INDEX` that removed the only plain `portfolio_id` index)
- `migrations/0003_integrity_constraints.sql:58-60` (the only remaining index mentioning `portfolio_id`; it is partial, so unusable for plain lookups)
- `migrations/20260506_market_performance_functions.sql:5-6` (original `portfolio_holdings_portfolio_id_idx`)
- `frontend/app/api/account/export/route.ts` (79 lines; the only caller of the RPC)
- `frontend/app/account/page.tsx:115-140` and `:331-339` (the button and the error text)
- `README.md:278-297` and `:434-438` (migration conventions and verifier notes)
- `audits/HARDENING_FOLLOWUPS.md:120-160` (how applied migrations are recorded)
- `verify_migration.py:1-100` (module docstring) and `:1488-1540` (`UNVERIFIABLE` and statement accounting)

Confirm the starting state (run from the repo root):

```bash
# 1. The bug is still present: STABLE on line 10, INSERT on 84-85.
sed -n '10p;84,85p' migrations/0011_export_my_data.sql
# expect: "STABLE", then the INSERT INTO public.auth_events lines

# 2. No later migration redefines export_my_data.
grep -ln "export_my_data" migrations/*.sql
# expect: only migrations/0011_export_my_data.sql

# 3. Highest migration number. The new files take the next two numbers.
ls migrations | grep -E '^[0-9]{4}_' | sort | tail -1
# expect: 0023_price_freshness_guard.sql
# If 0024 or 0025 already exist (another work package merged first), use the next
# two free numbers and substitute them everywhere this spec says 0024 / 0025.

# 4. No index on portfolio_lots(holding_id) anywhere, and the portfolio_id one was dropped.
grep -n "holding_id" migrations/*.sql | grep -i index      # expect: no output
grep -n "portfolio_holdings_portfolio_id_idx" migrations/*.sql
# expect: 20260506_...sql:5 (CREATE) and 0014_...sql:111 (DROP)

# 5. verify_migration.py has no hard-coded expectations for these objects.
grep -n "export_my_data\|portfolio_holdings\|portfolio_lots" verify_migration.py
# expect: no output

# 6. The verifier reads 0011's body hash; the new file must produce the same hash.
python3 verify_migration.py migrations/0011_export_my_data.sql 2>&1 >/dev/null | head -1
# expect: "-- function export_my_data(): body 80ef079f70454e8ae2ba9a00bbbb7781, ... volatility s, config search_path=public,auth"
```

Facts already established (do not re-litigate):

- `verify_migration.py` is a generic parser. It derives every expectation from the file passed on the command line and hard-codes nothing about `export_my_data`, `portfolio_holdings` or `portfolio_lots` (check 5). It does compare volatility (`verify_migration.py:1598`, `:1616-1618`), so it will certify the new `0024` against production after apply. **It needs no change in this package.** It treats a `DO` block as "NOT VERIFIED" (`verify_migration.py:1502`), so `0025` must be checked with the SQL query given in its header.
- The repo has no `supabase/` directory (no `config.toml`, no `supabase/migrations/`), so `supabase db push` does not apply. The convention (`README.md:282-283`, `audits/HARDENING_FOLLOWUPS.md:141-180`) is: apply via Supabase MCP `apply_migration` or the SQL editor, verify with `verify_migration.py`, then record a bullet in `HARDENING_FOLLOWUPS.md` section 7.
- Both migrations below were replayed on a scratch PostgreSQL 16 with a Supabase-shaped scaffold while this spec was written: `0011` reproduced the error; `0024` applied twice cleanly, returned the full JSON, wrote one `data_exported` row, left `proacl = {postgres=X,authenticated=X,service_role=X}`, anon got `permission denied`, and the `verify_migration.py` query returned five `OK` rows. `0025` created both indexes on a fresh database, skipped `portfolio_holdings` when a legacy `idx_portfolio_holdings_portfolio_id` existed, and was a no-op on re-run. `EXPLAIN` showed `Index Scan using portfolio_lots_holding_id_idx` and `Index Scan using portfolio_holdings_portfolio_id_idx`.

## Implementation steps

Do the steps in order. Steps 1 and 2 are independent of each other; step 5 depends on both.

### Step 1. Add `migrations/0024_export_my_data_volatile.sql`

Build the file mechanically so the function body is byte-identical to `0011` (the verifier hashes it; any hand edit risks drift). Run from the repo root:

```bash
{
cat <<'EOF'
-- Migration: make export_my_data() VOLATILE and close its anon EXECUTE grant.
--
-- 0011 declared export_my_data() STABLE, but the function ends with
--   INSERT INTO public.auth_events (user_id, event) VALUES (caller, 'data_exported');
-- and Postgres refuses any write inside a non-volatile function:
--   ERROR: INSERT is not allowed in a non-volatile function
-- So every call has failed since 0011 was applied (2026-05-27), and
-- POST /api/account/export has answered 500 "Failed to export data" to every
-- user. Production held zero 'data_exported' audit rows as of 2026-09-25.
--
-- The fix is the 0011 body verbatim with the STABLE line removed (VOLATILE is
-- the default). The audit INSERT stays: the 'data_exported' row is a
-- documented requirement (audits/HARDENING_FOLLOWUPS.md section 5).
-- The return type (jsonb) and the argument list are unchanged, so
-- CREATE OR REPLACE succeeds in place and keeps the owner and the ACL.
--
-- Grants: 0011 revoked EXECUTE from PUBLIC only. Supabase's bootstrap ACL
-- also grants anon explicitly (see the note in 0023), and production's
-- proacl reads {postgres=X,anon=X,authenticated=X,service_role=X}. anon could
-- not read anything (the function raises 28000 when auth.uid() is NULL), but
-- the grant is revoked here to match delete_my_account (0006). authenticated
-- keeps EXECUTE for the route handler; service_role keeps it for support use.
--
-- Supersedes 0011 for this function: after this file is applied,
-- verify_migration.py on 0011 reports a volatility MISMATCH, which is correct.
-- Idempotent.
--
-- Verification:
--   -- Expect provolatile = 'v', prosecdef = true, search_path pinned, and no
--   -- anon or PUBLIC entry in proacl:
--   SELECT p.provolatile, p.prosecdef, p.proconfig, p.proacl
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'export_my_data';
--
--   -- Expect anon = false, authenticated = true, service_role = true:
--   SELECT has_function_privilege('anon',          'public.export_my_data()', 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', 'public.export_my_data()', 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  'public.export_my_data()', 'EXECUTE') AS service_role;

EOF
sed -n '7,9p;11,89p' migrations/0011_export_my_data.sql
cat <<'EOF'

REVOKE EXECUTE ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.export_my_data() TO service_role;
EOF
} > migrations/0024_export_my_data_volatile.sql
```

`sed -n '7,9p;11,89p'` copies `0011` lines 7-9 (`CREATE OR REPLACE FUNCTION ... RETURNS jsonb ... LANGUAGE plpgsql`) and 11-89 (`SECURITY DEFINER` through the closing `$$;`), dropping only line 10 (`STABLE`). The resulting function header must read exactly:

```sql
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
```

Check it:

```bash
grep -c "STABLE" migrations/0024_export_my_data_volatile.sql   # expect 2 (both are comment lines in the header)
grep -n "^STABLE\|^VOLATILE" migrations/0024_export_my_data_volatile.sql   # expect no output
python3 verify_migration.py migrations/0024_export_my_data_volatile.sql > /dev/null; echo "exit=$?"
# stderr must show: body 80ef079f70454e8ae2ba9a00bbbb7781 ... volatility v, config search_path=public,auth
# plus 4 privilege lines (public revoked, anon revoked, authenticated granted, service_role granted)
# and exit=0
```

Why the explicit `GRANT ... TO service_role`: production's ACL already has it from Supabase's bootstrap ACL, but stating it makes the file self-describing and lets `verify_migration.py` assert it. Do not omit it.

### Step 2. Add `migrations/0025_portfolio_fk_indexes.sql`

Write this file exactly:

```sql
-- Migration: restore the foreign-key indexes on portfolio_holdings.portfolio_id
-- and portfolio_lots.holding_id.
--
-- 20260506_market_performance_functions.sql created
-- portfolio_holdings_portfolio_id_idx, and 0014_rls_perf_and_dedupe.sql
-- dropped it again as a duplicate of an older index that, per 0014's
-- comment, exists only in production (created outside these files).
-- portfolio_lots.holding_id was never indexed by any file here. The one
-- remaining index that mentions portfolio_id, portfolio_holdings_idem_uidx
-- (0003), is partial (WHERE client_idempotency_key IS NOT NULL), so the
-- planner cannot use it for a plain portfolio_id lookup.
--
-- The app reads holdings by portfolio_id, export_my_data() (0011/0024)
-- filters holdings by portfolio_id and lots by holding_id, and the
-- ON DELETE CASCADE chain that delete_my_account() relies on (0002) walks
-- both foreign keys.
-- Without an index each of those is a sequential scan over every user's rows.
--
-- Each index is created only when the table has no valid, non-partial btree
-- index whose FIRST key column is the foreign-key column. That repairs a
-- database rebuilt from these files (staging, branch, restore) without adding
-- a second copy next to production's legacy index, which is exactly the
-- duplicate_index lint 0014 cleaned up. Same intent as the
-- idx_price_history_product_recorded repair in 0023, but conditional, because
-- here the legacy index name is not known.
--
-- Not CONCURRENTLY: CREATE INDEX CONCURRENTLY cannot run inside a DO block or
-- a transaction. Both tables hold a few rows per user, so the SHARE lock taken
-- by a plain CREATE INDEX lasts milliseconds.
--
-- verify_migration.py cannot see inside a DO block; it reports this file as
-- "Nothing here can be verified" (exit 2). Use the query below instead.
-- Idempotent.
--
-- Verification (expect at least one row per table, valid = true):
--   SELECT t.relname AS table_name, ic.relname AS index_name,
--          pg_get_indexdef(i.indexrelid) AS definition, i.indisvalid AS valid
--     FROM pg_index i
--     JOIN pg_class t  ON t.oid  = i.indrelid
--     JOIN pg_class ic ON ic.oid = i.indexrelid
--     JOIN pg_namespace n ON n.oid = t.relnamespace
--     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
--    WHERE n.nspname = 'public'
--      AND ((t.relname = 'portfolio_holdings' AND a.attname = 'portfolio_id')
--        OR (t.relname = 'portfolio_lots'     AND a.attname = 'holding_id'))
--      AND i.indpred IS NULL
--    ORDER BY 1, 2;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT *
      FROM (VALUES
        ('portfolio_holdings', 'portfolio_id', 'portfolio_holdings_portfolio_id_idx'),
        ('portfolio_lots',     'holding_id',   'portfolio_lots_holding_id_idx')
      ) AS v(table_name, column_name, index_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_class t     ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_class ic    ON ic.oid = i.indexrelid
        JOIN pg_am am       ON am.oid = ic.relam
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
       WHERE n.nspname = 'public'
         AND t.relname = target.table_name
         AND a.attname = target.column_name
         AND am.amname = 'btree'
         AND i.indisvalid
         AND i.indpred IS NULL
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
        target.index_name, target.table_name, target.column_name
      );
      RAISE NOTICE 'created index % on public.%(%)',
        target.index_name, target.table_name, target.column_name;
    ELSE
      RAISE NOTICE 'public.%(%) already has a leading-column btree index; skipped',
        target.table_name, target.column_name;
    END IF;
  END LOOP;
END
$$;
```

Why this shape and not a bare `CREATE INDEX IF NOT EXISTS`: `IF NOT EXISTS` matches by name only. Production is believed to carry a legacy index on `portfolio_holdings(portfolio_id)` under a different name (that is why `0014:107-111` dropped the new one as a duplicate), so a bare statement would recreate the duplicate and bring back the `duplicate_index` advisor lint. The `DO` block checks by definition (leading key column, btree, valid, non-partial) instead. The index names match the repo's `<table>_<column>_idx` convention used by `20260506:5` and `0014:118`.

Check it parses as intended:

```bash
python3 verify_migration.py migrations/0025_portfolio_fk_indexes.sql; echo "exit=$?"
# expect the "Nothing here can be verified" message and exit=2. That is correct for a DO-only file.
```

### Step 3. Add the route test `frontend/app/api/account/export/__tests__/route.test.ts`

No test covers this route today (only `app/lib/__tests__/rateLimit.test.ts:51` mentions the path). A mocked RPC cannot catch the SQL bug; the test pins the route's contract so the owner-side fix is the only moving part. Write:

```ts
/** @jest-environment node */
/**
 * POST /api/account/export (GDPR Art. 15 / 20).
 *
 * The RPC itself is exercised in the database (migration 0024, finding F020);
 * this pins the route's contract around it: CSRF gate, auth gate, the
 * download headers on success, and a generic 500 on an RPC error.
 * next/server needs the node environment; it throws under jsdom.
 */
import { NextRequest } from "next/server";

// Harmless if the route does not import it; needed if the route is later
// moved onto app/lib/routeSupabase.ts, which imports "server-only".
jest.mock("server-only", () => ({}));

const getUserMock = jest.fn();
const rpcMock = jest.fn();

jest.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: jest.fn() }),
}));

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
  }),
}));

const logSupabaseErrorMock = jest.fn();
jest.mock("../../../../lib/logger", () => ({
  logSupabaseError: (...args: unknown[]) => logSupabaseErrorMock(...args),
  logCaughtError: jest.fn(),
}));

import { POST } from "../route";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/account/export", {
    method: "POST",
    headers: {
      "x-pokefin-request": "1",
      origin: "http://localhost:3000",
      ...headers,
    },
  });
}

beforeEach(() => {
  getUserMock.mockReset();
  rpcMock.mockReset();
  logSupabaseErrorMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

describe("POST /api/account/export", () => {
  it("rejects a request without the x-pokefin-request header", async () => {
    const res = await POST(makeRequest({ "x-pokefin-request": "" }));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a cross-site origin", async () => {
    const res = await POST(makeRequest({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 401 and never calls the RPC when there is no session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the RPC document as a no-store JSON attachment", async () => {
    const doc = { user_id: USER_ID, portfolios: [], box_recipes: [] };
    rpcMock.mockResolvedValue({ data: doc, error: null });

    const res = await POST(makeRequest());

    expect(rpcMock).toHaveBeenCalledWith("export_my_data");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="pokefin-data-${USER_ID}.json"`
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(await res.text())).toEqual(doc);
  });

  it("returns a generic 500 and logs when the RPC errors", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "0A000",
        message: "INSERT is not allowed in a non-volatile function",
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to export data" });
    expect(logSupabaseErrorMock).toHaveBeenCalledWith(
      "export_my_data_failed",
      expect.objectContaining({ code: "0A000" })
    );
  });
});
```

Placement notes:

- The relative logger path is `../../../../lib/logger` from `app/api/account/export/__tests__/` (up to `app/`, then `lib/logger`). The route imports it as `../../../lib/logger` from one level higher; both resolve to `frontend/app/lib/logger.ts`.
- The mock variable names end in `Mock` and are referenced lazily inside factories, which is the pattern already used by `frontend/app/lib/__tests__/serverMarketData.freshness.test.ts:12-28`.
- The file must start with the `/** @jest-environment node */` line exactly as shown (Jest reads only the first docblock). Do not merge the two comment blocks and do not move any `import` above it.
- If, when you execute this, `route.ts` has already been refactored (WP20; the plan runs WP01 first, so normally it has not) to use `createRouteSupabaseClient()` from `app/lib/routeSupabase.ts` and `rejectIfCsrfFails` from `app/lib/csrf.ts`, keep the `@supabase/ssr` and `next/headers` mocks as written (routeSupabase calls both) and adjust only the expected status codes and messages to whatever the refactored route returns. Do not change `route.ts` in this package.

### Step 4. Add the static guard `tests/test_migration_volatility.py`

This catches the class of bug behind F020 whenever `pytest` runs: a function whose effective (last-applied) definition is `STABLE` or `IMMUTABLE` but whose body writes. Write:

```python
"""
Static guard: no function may be left non-volatile while its body writes.

Postgres rejects INSERT / UPDATE / DELETE inside a STABLE or IMMUTABLE
function at call time ("INSERT is not allowed in a non-volatile function"),
never at CREATE time, so a migration can apply cleanly and still ship a
function that fails on every call. That is how export_my_data() broke in
0011 (fixed by 0024, finding F020).

Only the EFFECTIVE definition of each function is checked: the last one in
apply order. A superseded definition (0011's STABLE export_my_data) is
history, not live code.

Run with: python -m pytest tests/test_migration_volatility.py -v
"""
import os
import re
from pathlib import Path

import pytest

MIGRATIONS = Path(os.environ.get("POKEFIN_MIGRATIONS_DIR",
                                 Path(__file__).resolve().parent.parent / "migrations"))

# Out-of-band files that must be applied BEFORE the numbered ones
# (README.md, "The ordering constraints that matter").
EARLY_FILES = ("create_box_recipes.sql", "20260506_market_performance_functions.sql")

FUNC_HEAD = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.\"]+)\s*\(", re.I)
DOLLAR_AS = re.compile(r"\bAS\s+(\$[A-Za-z_]*\$)", re.I)
VOLATILITY = re.compile(r"\b(IMMUTABLE|STABLE|VOLATILE)\b", re.I)
WRITES = re.compile(
    r"\b(INSERT\s+INTO|UPDATE\s+[\w.\"]+\s+SET|DELETE\s+FROM)\b", re.I)
LINE_COMMENT = re.compile(r"--[^\n]*")


def apply_order():
    files = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    early = [f for f in EARLY_FILES if f in files]
    return early + [f for f in files if f not in early]


def effective_functions():
    """Map function name -> (file, volatility, body) for the last definition."""
    found = {}
    for name in apply_order():
        sql = (MIGRATIONS / name).read_text()
        for head in FUNC_HEAD.finditer(sql):
            fn = head.group(1).lower().replace('"', "")
            if "." not in fn:
                fn = "public." + fn
            as_match = DOLLAR_AS.search(sql, head.end())
            if not as_match:
                continue  # SQL-standard RETURN body; not used in this repo
            tag = as_match.group(1)
            body_start = as_match.end()
            body_end = sql.find(tag, body_start)
            assert body_end != -1, f"{name}: unterminated body for {fn}"
            # Volatility may sit before AS (header) or after the closing tag.
            header = sql[head.end():as_match.start()]
            trailer_end = sql.find(";", body_end + len(tag))
            trailer = sql[body_end + len(tag):trailer_end]
            vol = VOLATILITY.search(LINE_COMMENT.sub("", header + " " + trailer))
            volatility = vol.group(1).upper() if vol else "VOLATILE"
            body = LINE_COMMENT.sub("", sql[body_start:body_end])
            found[fn] = (name, volatility, body)
    return found


def test_migrations_directory_found():
    assert MIGRATIONS.is_dir(), MIGRATIONS
    assert any(MIGRATIONS.glob("*.sql"))


def test_export_my_data_is_volatile():
    fns = effective_functions()
    assert "public.export_my_data" in fns
    name, volatility, _ = fns["public.export_my_data"]
    assert volatility == "VOLATILE", (
        f"export_my_data is {volatility} in {name}; it INSERTs an audit row "
        "and must be VOLATILE")


@pytest.mark.parametrize("fn", sorted(effective_functions()))
def test_writing_functions_are_volatile(fn):
    name, volatility, body = effective_functions()[fn]
    if volatility == "VOLATILE":
        return
    write = WRITES.search(body)
    assert write is None, (
        f"{fn} (last defined in {name}) is {volatility} but its body runs "
        f"'{write.group(0)}'. Postgres rejects that at call time.")
```

This was run against the current `migrations/` plus the two new files: 11 passed (2 plain tests plus 9 parametrized functions: `delete_my_account`, `export_my_data`, `get_market_product_metrics`, `get_market_product_summaries`, `get_market_product_volume_metrics`, `get_set_analytics`, `get_shared_recipe`, `handle_new_user`, `log_auth_event_users`). With `0024` removed it fails `test_export_my_data_is_volatile` and `test_writing_functions_are_volatile[public.export_my_data]` (2 failed, 9 passed), which is the intended regression signal. It imports nothing from the scraper, so it needs no `secretsFile` stub. It needs only `pytest`; if `python3 -m pytest --version` fails, run `python3 -m pip install pytest` first (pytest is not in `requirements.txt`).

Know the limit: `.github/workflows/ci.yml` runs no Python tests at all today (its `python` job only runs `pip-audit`), so this guard runs only when someone runs `pytest` locally. Do not add a CI job in this package (CI edits belong to WP00 and WP17); list it under "Out of scope, noticed" in the PR body instead (see Commit and PR).

### Step 5. Update docs: `README.md` and `audits/HARDENING_FOLLOWUPS.md`

5a. `README.md`, in the bullet list under "They are applied **incrementally to the live project**" (current lines 287-297), insert this bullet after the "Two functions the migrations operate on..." bullet (ends at line 294) and before "Not every file is re-runnable" (line 295):

```markdown
- Production is believed to carry a legacy `portfolio_holdings (portfolio_id)`
  index created outside these files (`0014` dropped the repo's
  `portfolio_holdings_portfolio_id_idx` as its duplicate). `0025` therefore
  creates `portfolio_holdings_portfolio_id_idx` and
  `portfolio_lots_holding_id_idx` only where no equivalent btree index
  exists, so on production it may create one, both, or neither.
```

Write the bullet exactly as above. Do not add a claim about the `product_price_history` index names: `0023` creates `idx_price_history_product_recorded` itself, and which name production carries is not established.

5b. `README.md`, at the end of the paragraph that begins "Expectations come from the file you pass" (current lines 434-438, ending "both correct."), append on the following lines:

```markdown
Likewise `0011` reports a volatility `MISMATCH` for `export_my_data` once
`0024` is applied, and `0025` prints no query at all because its indexes are
created inside a `DO` block; check it with the query in that file's header.
```

5c. `audits/HARDENING_FOLLOWUPS.md` section 5 (line 120 onward): after the bullet ending "(Art. 15/20)." at line 127, add:

```markdown
- Correction (2026-09-25 review, F020): the export RPC failed on every call
  until migration `0024`, because `0011` declared it `STABLE` while it
  inserts the `data_exported` audit row. No export succeeded before `0024`.
```

5d. `audits/HARDENING_FOLLOWUPS.md` section 7: insert this bullet immediately before `- **Migration 0022 applied** (2026-08-10, via Supabase MCP).` (line 145), so it sits above the newer-first run of migration bullets:

```markdown
- **Migrations 0024 and 0025: pending apply** (WP01, review findings F020
  and F134). 0024 re-creates `export_my_data()` without `STABLE` (the
  `data_exported` audit INSERT made every call fail) and revokes EXECUTE
  from PUBLIC and anon. 0025 creates `portfolio_holdings_portfolio_id_idx`
  and `portfolio_lots_holding_id_idx` only where no equivalent btree index
  exists. Owner: after applying, replace "pending apply" with
  "applied (YYYY-MM-DD, via Supabase MCP)" or "(..., via SQL editor)", and
  note which index names 0025 created or skipped (compare pg_indexes
  before and after the apply).
```

Do not write "applied" yourself: you have no production access.

## Pitfalls: do not do this

- **Do not drop the `INSERT` into `auth_events` to make `STABLE` legal.** The `data_exported` row is a documented requirement (`audits/HARDENING_FOLLOWUPS.md:128-131`); the verifier's correction on F020 says so explicitly. VOLATILE is the correct volatility for a function that writes.
- **Do not edit `migrations/0011_export_my_data.sql`.** It is recorded as applied in production. Migrations are append-only here; a later file supersedes an earlier one (`README.md:434-438`).
- **Do not `DROP FUNCTION` and re-create.** That discards the ACL and the `search_path` pin (`0023:50-60` documents this exact trap). `CREATE OR REPLACE` works because the return type (`jsonb`) is unchanged.
- **Do not hand-retype or reformat the function body.** Build it with the `sed` command in step 1 so `verify_migration.py` reports the same body hash (`80ef079f70454e8ae2ba9a00bbbb7781`) as `0011`. Do not add `pg_temp` to `search_path` or otherwise "improve" the function; that is out of scope and changes the verified config.
- **Do not revoke from `authenticated` or `service_role`.** The route calls the RPC as `authenticated`; `service_role` is kept per the verifier correction.
- **Do not revoke only from `anon` or only from `PUBLIC`.** EXECUTE held through PUBLIC keeps anon working, and anon's explicit bootstrap grant survives a PUBLIC-only revoke (which is what `0011:91` did). Revoke from both in one statement.
- **Do not use a bare `CREATE INDEX IF NOT EXISTS portfolio_holdings_portfolio_id_idx ...`.** `IF NOT EXISTS` checks the name only; production's legacy index has a different name, so this would reintroduce the duplicate that `0014` removed. Use the `DO` block from step 2.
- **Do not replace the `pg_index` check in step 2 with a text match on `pg_indexes.indexdef`** (for example "indexdef ends in `(portfolio_id)`"). A text match misses a composite index such as `(portfolio_id, created_at)` that would also serve the lookup, and matches non-btree or partial indexes. Keep the check on `indkey[0]`, `am.amname = 'btree'`, `indisvalid` and `indpred IS NULL` exactly as written.
- **Do not use `CREATE INDEX CONCURRENTLY`.** It cannot run inside a `DO` block or a transaction (MCP `apply_migration` and the SQL editor both wrap in one). The tables are small; the plain build is milliseconds.
- **Do not edit `verify_migration.py`** to "support" `DO` blocks or to special-case these objects. It hard-codes nothing about them and its refusal to certify `DO` blocks is deliberate (`verify_migration.py:1488-1505`).
- **Do not put both changes in one file.** Keeping `0024` free of `DO` blocks lets `verify_migration.py` certify it fully (exit 0); combining them drops the exit code to 3 and hides the function check behind a "NOT VERIFIED" line.
- **Do not suggest `supabase db push`.** The repo has no `supabase/` project directory. Use MCP `apply_migration` or the SQL editor.
- **Do not change `frontend/app/api/account/export/route.ts`.** The route is correct; the bug is in SQL. CSRF dedupe belongs to WP20 (F051) and error hygiene to WP02.
- **Do not change `frontend/app/account/page.tsx`.** The export handler and its error text (`:115-140`, `:331-339`) already behave correctly once the RPC works. WP02's spec says WP01 "edits the export handler and export error text"; that is not the case, and WP02 already tells its executor to keep whatever text is there. WP02 (`role="alert"`), WP04 and WP15 own this file's later edits.
- **Do not end an owner SQL snippet with `ROLLBACK` or `RESET`** if its result must be read: the Supabase SQL editor shows only the last statement's output. The owner snippets in this spec are written to end on the statement that matters; keep them that way.
- **Do not claim the jest test proves the fix.** It mocks the RPC. The proof is the owner's SQL check and a real download in production.
- **Do not apply either migration to production yourself** or mark them applied in `HARDENING_FOLLOWUPS.md`.

## Tests

1. **Add** `frontend/app/api/account/export/__tests__/route.test.ts` (code in step 3). Cases:
   - 403 when `x-pokefin-request` is not `1`; RPC not called.
   - 403 when `Origin` is not allowlisted; RPC not called.
   - 401 when `getUser` returns no user; RPC not called.
   - 200 with the RPC document as the body, `Content-Type` containing `application/json`, `Content-Disposition: attachment; filename="pokefin-data-<user id>.json"`, `Cache-Control: no-store`, and `rpc` called with `"export_my_data"`.
   - 500 with body `{ "error": "Failed to export data" }` when the RPC returns an error, and `logSupabaseError` called with `"export_my_data_failed"`.
2. **Add** `tests/test_migration_volatility.py` (code in step 4). Cases:
   - the migrations directory is found and non-empty;
   - the effective `public.export_my_data` definition is `VOLATILE`;
   - parametrized over every function: no effective `STABLE`/`IMMUTABLE` definition contains `INSERT INTO`, `UPDATE ... SET` or `DELETE FROM`.
3. **SQL behaviour** is proven by the owner checks below (no database in CI). Optional for the executor if a local Postgres is available: replay `0011`, then `0024`, against a scaffold with roles `anon`, `authenticated`, `service_role`, an `auth.uid()` that reads `current_setting('request.jwt.claim.sub', true)`, and the five per-user tables plus `auth_events`; `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '<uuid>', false); SELECT public.export_my_data();` must return JSON and add one `data_exported` row.

## Verification

From the repo root:

```bash
python3 verify_migration.py migrations/0024_export_my_data_volatile.sql > /dev/null; echo "exit=$?"
# expect exit=0; stderr lists volatility v, body 80ef079f70454e8ae2ba9a00bbbb7781,
# and 4 privilege lines. (The owner regenerates the SQL itself in Owner actions step 3.)

python3 verify_migration.py migrations/0025_portfolio_fk_indexes.sql; echo "exit=$?"
# expect exit=2 ("Nothing here can be verified"). Correct for a DO-only file.

python3 -m pytest tests/test_migration_volatility.py -v
# expect all passed (11 at the time of writing; the count grows with new functions)
# (if pytest is missing: python3 -m pip install pytest)

mkdir -p /tmp/wp01_guard && cp migrations/*.sql /tmp/wp01_guard/ && rm /tmp/wp01_guard/0024_export_my_data_volatile.sql
POKEFIN_MIGRATIONS_DIR=/tmp/wp01_guard python3 -m pytest tests/test_migration_volatility.py -q; echo "exit=$?"
# expect "2 failed, 9 passed" and exit=1: proves the guard catches 0011 without 0024.
rm -rf /tmp/wp01_guard

grep -n $'\xe2\x80\x94' migrations/0024_export_my_data_volatile.sql migrations/0025_portfolio_fk_indexes.sql \
  tests/test_migration_volatility.py frontend/app/api/account/export/__tests__/route.test.ts
# expect no output (house style: no em dashes)

git diff --stat "$(git merge-base HEAD origin/master)" -- migrations/0011_export_my_data.sql verify_migration.py \
  frontend/app/api/account/export/route.ts frontend/app/account/page.tsx
# expect no output (compares the working tree with the point this branch left master)
```

From `frontend/`:

```bash
pnpm exec tsc --noEmit
# expect no errors

pnpm exec eslint app/api/account/export/__tests__/route.test.ts
# expect no errors in the new file

pnpm test --ci app/api/account/export
# expect 1 suite, 5 tests passed

pnpm test --ci
# expect the full suite still green (no other file changed)
```

If WP00 has landed, also run `pnpm build:stub` from `frontend/` and expect a successful build (this package changes no runtime code, so it must not regress).

Manual checks happen in production after the owner applies the migrations (see Owner actions).

## Owner actions

Do these after the WP01 PR is merged to master, so the files you apply are the ones `verify_migration.py` checks. Neither migration depends on a frontend deploy, and no frontend deploy depends on them; apply them the same day as the merge.

Run every SQL snippet below in the Supabase SQL editor of the production project with **no text selected** (the editor runs only the selection when there is one). The editor shows the result of the last statement only, so each snippet below ends with the statement whose output you need.

1. **Confirm the bug before applying (optional, 1 minute).** Replace `YOUR_ACCOUNT_EMAIL` with the email of your own Pokefin account and run:

   ```sql
   WITH claims AS MATERIALIZED (
     SELECT set_config(
       'request.jwt.claims',
       json_build_object(
         'sub',  (SELECT id FROM auth.users WHERE email = 'YOUR_ACCOUNT_EMAIL'),
         'role', 'authenticated'
       )::text,
       true) AS c
   )
   SELECT public.export_my_data() ->> 'user_id' AS exported_user FROM claims;
   ```

   Before the fix: `ERROR: INSERT is not allowed in a non-volatile function` (nothing is written). If you instead get `not authenticated` (SQLSTATE 28000), the email matched no row in `auth.users`; fix the email. The claims are set only for this one statement (`set_config(..., true)`), so nothing leaks into later queries.

2. **Apply `0024`.** Preferred: Supabase MCP `apply_migration` with name `0024_export_my_data_volatile` and the full file contents. Alternative: SQL editor, paste the whole file, no text selected, Run. Expect success with no output.

3. **Verify `0024`.** Run `python3 verify_migration.py migrations/0024_export_my_data_volatile.sql` locally, paste the printed SQL into the SQL editor, Run. Expect 5 rows, all `OK`: 1 function row and 4 privilege rows (public, anon, authenticated, service_role). Then run the query from step 1 again: expect one row whose `exported_user` is your user id. Note that this call succeeds for real, so it writes one `data_exported` row to `auth_events` (a genuine audit entry of your test export; leave it).

4. **Prove it end to end.** First run:

   ```sql
   SELECT count(*) AS data_exported_rows
     FROM public.auth_events
    WHERE event = 'data_exported';
   ```

   and note the number. Sign in at `https://pokefin.ca/account` and click "Export my data". Expect a file `pokefin-data-<timestamp>.json` to download containing `exported_at`, `user_id`, `profile`, `portfolios` and `box_recipes`. Run the count query again: expect it to be exactly 1 higher. (Signed-in pages are broken in other ways until WP04 lands. If `/account` does not render for you, steps 1 and 3 are the proof, and this step can wait until after WP04.)

5. **Read the current indexes, then apply `0025`.** First run:

   ```sql
   SELECT tablename, indexname, indexdef
     FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('portfolio_holdings', 'portfolio_lots')
    ORDER BY 1, 2;
   ```

   Save the output (it names any legacy index 0025 will skip). Then apply `0025` the same way as step 2 (MCP name `0025_portfolio_fk_indexes`). If the tool shows `NOTICE` lines, each says "created index ..." or "... already has a leading-column btree index; skipped". If it does not show notices (MCP and the editor may hide them), step 6 tells you what happened.

6. **Verify `0025`.** Run the verification query from the `0025` file header (remove the leading `--` from each line). Expect at least one row for `portfolio_holdings` and one for `portfolio_lots`, all with `valid = true`. Compare with the list saved in step 5: any `index_name` that was not there before is one 0025 created. If a row named `portfolio_holdings_portfolio_id_idx` or `portfolio_lots_holding_id_idx` shows `valid = false` (a leftover from an interrupted build; 0025 ignores invalid indexes but `IF NOT EXISTS` then skips the name), run `DROP INDEX public.<that name>;` and apply `0025` again. Then open Supabase Dashboard > Advisors > Performance, click Refresh, and confirm: no `duplicate_index` warning for `portfolio_holdings` or `portfolio_lots`, and no `unindexed_foreign_keys` warning naming `portfolio_holdings_portfolio_id_fkey` or `portfolio_lots_holding_id_fkey`. An `unindexed_foreign_keys` warning for `portfolio_holdings_product_id_fkey` is a different foreign key, out of scope here; leave it. An `unused_index` INFO on a newly created index is expected until the index has been used; do not drop it.

7. **Record it.** In `audits/HARDENING_FOLLOWUPS.md` section 7, change the bullet "**Migrations 0024 and 0025: pending apply**" to "**Migrations 0024 and 0025 applied** (YYYY-MM-DD, via Supabase MCP)" (or "via SQL editor") and add the index names 0025 created or skipped (from step 6). For each table 0025 skipped, add the legacy index name from step 5 to the README bullet added in step 5a (for example "production's legacy index is `idx_portfolio_holdings_portfolio_id`"). Commit both doc edits directly to master in one commit, `docs: record migrations 0024 and 0025 as applied`.

8. **Check alerting (ops note from the verifier).** `logSupabaseError('export_my_data_failed')` fired on every export attempt for four months unnoticed. Check whether Sentry or Vercel log alerts exist for it; if not, track it under WP17 (F108, observability).

## Acceptance criteria

- [ ] `migrations/0024_export_my_data_volatile.sql` exists, contains no `STABLE`/`IMMUTABLE`/`VOLATILE` keyword outside comments, and `verify_migration.py` on it exits 0 reporting body hash `80ef079f70454e8ae2ba9a00bbbb7781`, volatility `v`, config `search_path=public,auth`, PUBLIC and anon revoked, authenticated and service_role granted.
- [ ] `migrations/0025_portfolio_fk_indexes.sql` exists, contains only comments and one `DO` block, and uses no `CONCURRENTLY`.
- [ ] `migrations/0011_export_my_data.sql`, `verify_migration.py`, `frontend/app/api/account/export/route.ts` and `frontend/app/account/page.tsx` are unchanged (the `git diff --stat "$(git merge-base HEAD origin/master)" -- ...` command in Verification prints nothing).
- [ ] `frontend/app/api/account/export/__tests__/route.test.ts` exists and its 5 tests pass.
- [ ] `tests/test_migration_volatility.py` passes, and fails (2 failed) when pointed via `POKEFIN_MIGRATIONS_DIR` at a copy of `migrations/` without `0024`.
- [ ] `README.md` and `audits/HARDENING_FOLLOWUPS.md` carry the four edits from step 5, with 0024/0025 marked "pending apply".
- [ ] `pnpm exec tsc --noEmit` and `pnpm test --ci` pass in `frontend/`.
- [ ] (Owner) `verify_migration.py` query for 0024 returns 5 `OK` rows in production.
- [ ] (Owner) `has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE')` is false in production.
- [ ] (Owner) "Export my data" downloads a JSON file and a `data_exported` row appears in `auth_events`.
- [ ] (Owner) The 0025 verification query returns a valid leading-column index for both tables, and the Performance Advisor shows no `duplicate_index` for them.

## Rollback

- **Code**: revert the PR commit. Nothing at runtime depends on the new test files or docs.
- **0024**: do not roll back. Restoring `STABLE` (for example by re-running `0011`) re-breaks the export for every user, and nothing in the repo calls the RPC as anon. If the ACL change ever turns out to block a legitimate caller, add a new numbered migration that grants EXECUTE to that specific role; never edit `0024` and never re-run `0011`.
- **0025**: the indexes are additive and safe to keep. To remove only what 0025 created, drop by name, and only the names Owner actions step 6 identified as created (absent from the step 5 list):

  ```sql
  DROP INDEX IF EXISTS public.portfolio_holdings_portfolio_id_idx;
  DROP INDEX IF EXISTS public.portfolio_lots_holding_id_idx;
  ```

  Never drop the legacy production index 0025 skipped.

## Commit and PR

Commit message:

```
fix(db): make export_my_data VOLATILE; restore portfolio FK indexes

export_my_data() was declared STABLE in 0011 but inserts a data_exported
row into auth_events, so Postgres rejected every call and "Export my data"
has returned 500 since May. 0024 re-creates it verbatim without STABLE and
revokes EXECUTE from PUBLIC and anon (anon kept its bootstrap grant).

0025 recreates the portfolio_holdings(portfolio_id) and
portfolio_lots(holding_id) indexes that 0014 dropped or never had, only
where no equivalent btree index exists, so production's legacy index is
not duplicated.

Adds a route test for /api/account/export and a static pytest guard that
fails when a STABLE or IMMUTABLE function body writes.

Findings: F020, F134
```

PR title: `fix(db): data export RPC volatility (F020) and portfolio FK indexes (F134)`

PR body summary:

- What: migrations `0024_export_my_data_volatile.sql` and `0025_portfolio_fk_indexes.sql`; `frontend/app/api/account/export/__tests__/route.test.ts`; `tests/test_migration_volatility.py`; notes in `README.md` and `audits/HARDENING_FOLLOWUPS.md`.
- Why: "Export my data" fails for every user (F020); FK indexes missing on rebuilt databases (F134).
- Verification output: paste the results of every command in the Verification section.
- **Owner actions required before this is done**: apply 0024 and 0025 in Supabase (MCP `apply_migration` preferred), run the `verify_migration.py` query for 0024 (5 rows OK), run the 0025 header query, test the export button, then flip the HARDENING_FOLLOWUPS bullet to "applied". Full steps in `audits/remediation/WP01-db-hotfix-export-and-indexes.md`, section "Owner actions".
- Out of scope, noticed: (1) CI runs no Python tests (`.github/workflows/ci.yml` `python` job runs only `pip-audit`), so `tests/test_migration_volatility.py` and the rest of `tests/` run only locally; a CI pytest step belongs with WP17's CI gate or WP21's migration-replay job. (2) The verifier's alerting note for `export_my_data_failed` (WP17, F108).
