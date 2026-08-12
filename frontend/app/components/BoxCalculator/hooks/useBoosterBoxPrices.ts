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
          if (
            item.product_types?.name !== "booster_pack" ||
            item.usd_price === null ||
            !set?.id
          ) {
            continue;
          }

          prices.push({
            setId: set.id,
            setName: set.name,
            usdPrice: item.usd_price,
            variant: item.variant ?? null,
          });

          if (!setMap.has(set.id)) {
            setMap.set(set.id, {
              id: set.id,
              name: set.name,
              code: set.code,
              releaseDate: set.release_date,
            });
          }
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

  // Get the standard (non-variant) booster pack price for a set, fall back to cheapest
  const getPackPrice = useCallback(
    (setId: number): number | null => {
      const matches = boosterPackPrices.filter((p) => p.setId === setId);
      if (matches.length === 0) return null;

      const standard = matches.find((p) => !p.variant);
      if (standard) return standard.usdPrice;

      return matches.reduce((min, p) => (p.usdPrice < min ? p.usdPrice : min), matches[0].usdPrice);
    },
    [boosterPackPrices]
  );

  return { boosterPackPrices, sets, loading, getPackPrice };
}
