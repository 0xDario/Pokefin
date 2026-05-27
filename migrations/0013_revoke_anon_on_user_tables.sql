-- Migration: defense-in-depth - revoke anon table-level grants on
-- user-owned tables.
--
-- Rationale: RLS already returns zero rows to anon for these tables,
-- but anon retains table-level SELECT, which exposes their existence
-- in the GraphQL schema (advisor lint pg_graphql_anon_table_exposed).
-- Anonymous callers have no legitimate reason to read or write
-- per-user data; revoking the grants removes the schema entry too.
--
-- Reference tables (products, sets, generations, product_types,
-- exchange_rates, product_price_history) keep their anon SELECT
-- because the unauthenticated landing pages need them.
--
-- `authenticated` grants are intentionally kept: signed-in users
-- must SELECT their own per-user rows via PostgREST.

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.profiles            FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.portfolios          FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.portfolio_holdings  FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.portfolio_lots      FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.box_recipes         FROM anon;
