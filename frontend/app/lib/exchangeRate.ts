"use client";

import { DEFAULT_EXCHANGE_RATE, ExchangeRateSnapshot } from "./marketData";
import { supabase } from "./supabase";
import { logCaughtError } from "./logger";

let exchangeRateCache: ExchangeRateSnapshot | null = null;
let exchangeRatePromise: Promise<ExchangeRateSnapshot> | null = null;

export async function fetchLatestExchangeRateClient(): Promise<ExchangeRateSnapshot> {
  if (exchangeRateCache) {
    return exchangeRateCache;
  }

  if (exchangeRatePromise) {
    return exchangeRatePromise;
  }

  exchangeRatePromise = (async () => {
    try {
      const { data, error } = await supabase
        .from("exchange_rates")
        .select("usd_to_cad, recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        throw error ?? new Error("No exchange rate data found.");
      }

      exchangeRateCache = {
        rate: data.usd_to_cad,
        date: data.recorded_at ?? null,
      };
      return exchangeRateCache;
    } catch (error) {
      logCaughtError("client_exchange_rate_failed", error);
      exchangeRateCache = {
        rate: DEFAULT_EXCHANGE_RATE,
        date: null,
      };
      return exchangeRateCache;
    } finally {
      exchangeRatePromise = null;
    }
  })();

  return exchangeRatePromise;
}
