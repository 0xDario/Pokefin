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
