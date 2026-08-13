"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchLatestExchangeRateClient } from "../../../lib/exchangeRate";
import { Currency } from "../types";
import { logCaughtError } from "../../../lib/logger";

/**
 * Hook to manage currency conversion and exchange rates
 *
 * @returns {Object} selectedCurrency, exchangeRate, loading, handlers, and utility functions
 */
export function useCurrencyConversion(initialExchangeRate?: number, initialCurrency: Currency = "CAD") {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(initialCurrency);
  const [exchangeRate, setExchangeRate] = useState(initialExchangeRate ?? 1.36);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(!initialExchangeRate);

  // Fetch exchange rate on mount
  useEffect(() => {
    if (initialExchangeRate) {
      setExchangeRate(initialExchangeRate);
      setExchangeRateLoading(false);
      return;
    }

    let cancelled = false;

    async function loadExchangeRate() {
      setExchangeRateLoading(true);
      try {
        const result = await fetchLatestExchangeRateClient();
        if (!cancelled) {
          setExchangeRate(result.rate);
        }
      } catch (error) {
        logCaughtError("exchange_rate_load_failed", error);
      } finally {
        if (!cancelled) {
          setExchangeRateLoading(false);
        }
      }
    }
    loadExchangeRate();

    return () => {
      cancelled = true;
    };
  }, [initialExchangeRate]);

  // Helper function to convert prices based on selected currency - memoized
  const convertPrice = useCallback((usdPrice: number | null | undefined): number => {
    if (!usdPrice) return 0;
    return selectedCurrency === "CAD" ? usdPrice * exchangeRate : usdPrice;
  }, [selectedCurrency, exchangeRate]);

  // Helper function to format price with currency symbol - memoized.
  // A missing price renders as "--", never as a currency amount: null here
  // means the price is unknown — nothing was ever scraped, or the newest one
  // is past PRICE_STALENESS_TOLERANCE_DAYS and the guard in marketPulse.ts
  // withheld it — and "$0.00" reads as a real, and very wrong, market price.
  // Matches formatUsd on the dashboard and /product/[id]. A literal 0 still
  // formats as 0.00; the scraper rejects non-positive prices, so it does not
  // occur for products, and calculator subtotals do legitimately reach 0.
  const formatPrice = useCallback((usdPrice: number | null | undefined): string => {
    if (usdPrice === null || usdPrice === undefined || Number.isNaN(usdPrice)) {
      return "--";
    }
    const price = selectedCurrency === "CAD" ? usdPrice * exchangeRate : usdPrice;
    const symbol = selectedCurrency === "CAD" ? "C$" : "$";
    return `${symbol}${price.toFixed(2)}`;
  }, [selectedCurrency, exchangeRate]);

  return {
    selectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    setSelectedCurrency,
    convertPrice,
    formatPrice,
  };
}
