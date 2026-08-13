"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchMarketProductsClient } from "../../../lib/clientMarketData";
import { logCaughtError } from "../../../lib/logger";
import { BoosterPackPrice, SetOption } from "../types";

export function useBoosterPackPrices() {
  const [boosterPackPrices, setBoosterPackPrices] = useState<BoosterPackPrice[]>([]);
  const [sets, setSets] = useState<SetOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Use the guarded summaries instead of products.usd_price directly.
        // A pack whose upstream history stops updating must not keep
        // contributing an old price to a box NAV calculation.
        const products = await fetchMarketProductsClient();
        const prices: BoosterPackPrice[] = [];
        const setMap = new Map<number, SetOption>();

        for (const item of products) {
          const set = item.sets;
          if (item.product_types?.name !== "booster_pack" || !set?.id) {
            continue;
          }

          // The set stays selectable even with no current price — the picker
          // and the pack rows both already render a "No price" state, and
          // dropping it here would make it vanish with no explanation. Only
          // the price itself is withheld, by leaving it out of `prices`.
          if (!setMap.has(set.id)) {
            setMap.set(set.id, {
              id: set.id,
              name: set.name,
              code: set.code,
              releaseDate: set.release_date,
            });
          }

          // Unpriced packs are listed with a null price rather than dropped.
          // Dropping them made getPackPrice unable to see that a set's
          // standard pack exists at all, so it fell through to the
          // cheapest-variant branch and priced an ordinary-pack recipe off a
          // different SKU.
          prices.push({
            setId: set.id,
            setName: set.name,
            usdPrice: item.usd_price,
            variant: item.variant ?? null,
          });
        }

        setBoosterPackPrices(prices);
        // Sort sets by release date descending (newest first)
        setSets(
          Array.from(setMap.values()).sort(
            (a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
          )
        );
      } catch (error) {
        logCaughtError("booster_pack_prices_failed", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // The standard (non-variant) booster pack price for a set, falling back to
  // the cheapest variant only when the set genuinely has no standard pack.
  // A standard pack that exists but has no current price returns null: a
  // recipe names only the set, so substituting a variant's price would value
  // ordinary packs off a different SKU without saying so.
  const getPackPrice = useCallback(
    (setId: number): number | null => {
      const matches = boosterPackPrices.filter((p) => p.setId === setId);
      if (matches.length === 0) return null;

      const standard = matches.find((p) => !p.variant);
      if (standard) return standard.usdPrice;

      const priced = matches.filter(
        (p): p is typeof p & { usdPrice: number } => p.usdPrice !== null
      );
      if (priced.length === 0) return null;

      return priced.reduce(
        (min, p) => (p.usdPrice < min ? p.usdPrice : min),
        priced[0].usdPrice
      );
    },
    [boosterPackPrices]
  );

  return { boosterPackPrices, sets, loading, getPackPrice };
}
