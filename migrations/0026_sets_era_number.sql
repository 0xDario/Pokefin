-- Migration: era set number on sets (SV1, SV3.5, SWSH12.5, ME2.5, ...).
--
-- Adds sets.era_number alongside the existing 3-letter code, generation and
-- expansion_type. Nothing is replaced. Main-series sets take a whole number
-- in release order within their era; a special expansion takes the number of
-- the main set it follows plus .5. Prefixes are the official/community ones:
-- XY, SM, SWSH, SV, ME.
--
-- Values follow Bulbapedia's "List of Pokémon Trading Card Game expansions"
-- (checked 2026-11-18) for XY through Scarlet & Violet. Mega Evolution is
-- newer than that page's coverage there; ME1-ME5 and ME2.5 come from set
-- guides (thecardshopfinder.com, tcgcomp.com) and ME5.5 for 30th Celebration
-- from its "ME55" set id on tcgwatchtower.com.
--
-- Judgement calls:
--   KSS  Kalos Starter Set = XY0. A starter set released before XY1; Bulbapedia
--        lists it as XY0.
--   WHT/BLK  White Flare and Black Bolt share SV10.5. Released together; the
--        official numbering gives both the same slot. Hence no UNIQUE
--        constraint on the column.
--   CEL  Celebrations = SWSH7.5, PGO = SWSH10.5, DCR = XY5.5, GEN = XY9.5,
--        all per Bulbapedia even though some older listings leave them
--        unnumbered.
--
-- Not sortable as text (SV10 < SV2), so the frontend never sorts on it;
-- release_date stays the ordering key.
--
-- get_market_product_summaries gains a trailing set_era_number column. The
-- return type changes, so it is dropped and recreated, and (as in 0023) the
-- search_path pin and the EXECUTE grants are re-applied by hand. The body is
-- otherwise identical to 0023. Idempotent.
--
-- Verification:
--   -- Every set has a number (expect 0 rows):
--   SELECT id, code, name FROM public.sets WHERE era_number IS NULL;
--
--   -- The RPC exposes it (expect a value such as SV3.5 for 151 products):
--   SELECT DISTINCT set_code, set_era_number
--     FROM public.get_market_product_summaries() ORDER BY 1;

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS era_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sets_era_number_format'
       AND conrelid = 'public.sets'::regclass
  ) THEN
    ALTER TABLE public.sets
      ADD CONSTRAINT sets_era_number_format
      CHECK (era_number IS NULL OR era_number ~ '^[A-Z]{2,4}(0|[1-9][0-9]?)(\.5)?$');
  END IF;
END $$;

-- Keyed on the 3-letter code, which is what every other file in this repo
-- treats as the set's stable identity. Only fills NULLs, so a value someone
-- corrects by hand later is never overwritten by a re-run.
UPDATE public.sets s
   SET era_number = v.era_number
  FROM (VALUES
    -- XY
    ('KSS', 'XY0'),
    ('XY',  'XY1'),
    ('FLF', 'XY2'),
    ('FFI', 'XY3'),
    ('PHF', 'XY4'),
    ('PRC', 'XY5'),
    ('DCR', 'XY5.5'),
    ('ROS', 'XY6'),
    ('AOR', 'XY7'),
    ('BKT', 'XY8'),
    ('BKP', 'XY9'),
    ('GEN', 'XY9.5'),
    ('FCO', 'XY10'),
    ('STS', 'XY11'),
    ('EVO', 'XY12'),
    -- Sun & Moon
    ('SUM', 'SM1'),
    ('GRI', 'SM2'),
    ('BUS', 'SM3'),
    ('SLG', 'SM3.5'),
    ('CIN', 'SM4'),
    ('UPR', 'SM5'),
    ('FLI', 'SM6'),
    ('CES', 'SM7'),
    ('DRM', 'SM7.5'),
    ('LOT', 'SM8'),
    ('TEU', 'SM9'),
    ('DET', 'SM9.5'),
    ('UNB', 'SM10'),
    ('UNM', 'SM11'),
    ('HIF', 'SM11.5'),
    ('CEC', 'SM12'),
    -- Sword & Shield
    ('SSH', 'SWSH1'),
    ('RCL', 'SWSH2'),
    ('DAA', 'SWSH3'),
    ('CPA', 'SWSH3.5'),
    ('VIV', 'SWSH4'),
    ('SHF', 'SWSH4.5'),
    ('BST', 'SWSH5'),
    ('CRE', 'SWSH6'),
    ('EVS', 'SWSH7'),
    ('CEL', 'SWSH7.5'),
    ('FST', 'SWSH8'),
    ('BRS', 'SWSH9'),
    ('ASR', 'SWSH10'),
    ('PGO', 'SWSH10.5'),
    ('LOR', 'SWSH11'),
    ('SIT', 'SWSH12'),
    ('CRZ', 'SWSH12.5'),
    -- Scarlet & Violet
    ('SVI', 'SV1'),
    ('PAL', 'SV2'),
    ('OBF', 'SV3'),
    ('MEW', 'SV3.5'),
    ('PAR', 'SV4'),
    ('PAF', 'SV4.5'),
    ('TEF', 'SV5'),
    ('TWM', 'SV6'),
    ('SFA', 'SV6.5'),
    ('SCR', 'SV7'),
    ('SSP', 'SV8'),
    ('PRE', 'SV8.5'),
    ('JTG', 'SV9'),
    ('DRI', 'SV10'),
    ('WHT', 'SV10.5'),
    ('BLK', 'SV10.5'),
    -- Mega Evolution
    ('MEG', 'ME1'),
    ('PFL', 'ME2'),
    ('ASC', 'ME2.5'),
    ('POR', 'ME3'),
    ('CRI', 'ME4'),
    ('PBL', 'ME5'),
    ('30C', 'ME5.5')
  ) AS v(code, era_number)
 WHERE s.code = v.code
   AND s.era_number IS NULL;

DROP FUNCTION IF EXISTS public.get_market_product_summaries();

CREATE FUNCTION public.get_market_product_summaries()
RETURNS TABLE (
  id bigint,
  usd_price double precision,
  url text,
  last_updated timestamp without time zone,
  variant text,
  image_url text,
  sku text,
  set_id bigint,
  set_name text,
  set_code text,
  set_release_date date,
  set_expansion_type character varying,
  generation_id bigint,
  generation_name text,
  product_type_id bigint,
  product_type_name text,
  product_type_label text,
  return_1d double precision,
  return_7d double precision,
  return_30d double precision,
  return_90d double precision,
  return_180d double precision,
  return_365d double precision,
  price_recorded_at timestamp without time zone,
  set_era_number text
)
LANGUAGE sql
STABLE
AS $$
-- Body unchanged from 0023 apart from the trailing set_era_number column;
-- see that migration for the freshness gate's reasoning.
WITH latest_price AS (
  SELECT DISTINCT ON (h.product_id)
    h.product_id,
    h.recorded_at,
    h.usd_price
  FROM public.product_price_history h
  JOIN public.products ap ON ap.id = h.product_id AND ap.active = true
  ORDER BY h.product_id, h.recorded_at DESC
)
SELECT
  p.id,
  -- 14 = PRICE_STALENESS_TOLERANCE_DAYS in frontend/app/lib/marketPulse.ts.
  CASE WHEN lp.recorded_at >= current_date - 14
        AND p.usd_price IS NOT DISTINCT FROM lp.usd_price
       THEN p.usd_price END AS usd_price,
  p.url,
  p.last_updated,
  p.variant,
  p.image_url,
  p.sku,
  s.id AS set_id,
  s.name AS set_name,
  s.code AS set_code,
  s.release_date AS set_release_date,
  s.expansion_type AS set_expansion_type,
  g.id AS generation_id,
  g.name AS generation_name,
  pt.id AS product_type_id,
  pt.name AS product_type_name,
  pt.label AS product_type_label,
  CASE WHEN lp.recorded_at >= current_date - 14
        AND p.usd_price IS NOT DISTINCT FROM lp.usd_price
       THEN metrics.return_1d END AS return_1d,
  CASE WHEN lp.recorded_at >= current_date - 14
        AND p.usd_price IS NOT DISTINCT FROM lp.usd_price
       THEN metrics.return_7d END AS return_7d,
  CASE WHEN lp.recorded_at >= current_date - 14
        AND p.usd_price IS NOT DISTINCT FROM lp.usd_price
       THEN metrics.return_30d END AS return_30d,
  CASE WHEN lp.recorded_at >= current_date - 14
        AND p.usd_price IS NOT DISTINCT FROM lp.usd_price
       THEN metrics.return_90d END AS return_90d,
  CASE WHEN lp.recorded_at >= current_date - 14
        AND p.usd_price IS NOT DISTINCT FROM lp.usd_price
       THEN metrics.return_180d END AS return_180d,
  CASE WHEN lp.recorded_at >= current_date - 14
        AND p.usd_price IS NOT DISTINCT FROM lp.usd_price
       THEN metrics.return_365d END AS return_365d,
  lp.recorded_at AS price_recorded_at,
  s.era_number AS set_era_number
FROM public.products p
LEFT JOIN public.sets s ON s.id = p.set_id
LEFT JOIN public.generations g ON g.id = s.generation_id
LEFT JOIN public.product_types pt ON pt.id = p.product_type_id
LEFT JOIN public.get_market_product_metrics() metrics ON metrics.product_id = p.id
LEFT JOIN latest_price lp ON lp.product_id = p.id
WHERE p.active = true
ORDER BY p.last_updated DESC, p.id ASC;
$$;

ALTER FUNCTION public.get_market_product_summaries()
  SET search_path = public;

-- Restores the ACL the dropped function carried (PUBLIC plus explicit anon,
-- authenticated, service_role; read from pg_proc.proacl on 2026-11-18).
GRANT EXECUTE ON FUNCTION public.get_market_product_summaries()
  TO PUBLIC, anon, authenticated, service_role;
