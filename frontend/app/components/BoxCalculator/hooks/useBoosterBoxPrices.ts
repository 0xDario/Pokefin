"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { BoosterPackPrice, SetOption } from "../types";

export function useBoosterPackPrices() {
  const [boosterPackPrices, setBoosterPackPrices] = useState<BoosterPackPrice[]>([]);
  const [sets, setSets] = useState<SetOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      // Fetch all booster pack products with their set info
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select(
          `id, usd_price, variant,
           sets!inner ( id, name, code, release_date ),
           product_types!inner ( name )`
        )
        .eq("product_types.name", "booster_pack")
        .order("usd_price", { ascending: false });

      if (productsError) {
        console.error("[useBoosterPackPrices] Error:", productsError);
        setLoading(false);
        return;
      }

      if (products) {
        const prices: BoosterPackPrice[] = [];
        const setMap = new Map<number, SetOption>();

        for (const item of products as any[]) {
          const set = Array.isArray(item.sets) ? item.sets[0] : item.sets;
          if (!set) continue;

          prices.push({
            setId: set.id,
            setName: set.name,
            usdPrice: item.usd_price,
            variant: item.variant,
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
      }

      setLoading(false);
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
