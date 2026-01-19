-- Prevent non-positive prices in historical data (allow NULL for unknown).
DO $$
BEGIN
  ALTER TABLE product_price_history
    ADD CONSTRAINT product_price_history_usd_price_positive
    CHECK (usd_price IS NULL OR usd_price > 0);
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint already exists; no-op.
    NULL;
END $$;
