"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchUSDToCADRate } from "../../ExchangeRateService";
import { Currency } from "../types";

/**
 * Hook to manage currency conversion and exchange rates
 *
 * @returns {Object} selectedCurrency, exchangeRate, loading, handlers, and utility functions
 */
export function useCurrencyConversion() {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("CAD");
  const [exchangeRate, setExchangeRate] = useState(1.36);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);

  // Fetch exchange rate on mount
  useEffect(() => {
    async function loadExchangeRate() {
      setExchangeRateLoading(true);
      try {
        const result = await fetchUSDToCADRate();
        setExchangeRate(result.rate);
      } catch (error) {
        console.error("[useCurrencyConversion] Failed to load exchange rate:", error);
      } finally {
        setExchangeRateLoading(false);
      }
    }
    loadExchangeRate();
  }, []);

  // Helper function to convert prices based on selected currency - memoized
  const convertPrice = useCallback((usdPrice: number | null | undefined): number => {
    if (!usdPrice) return 0;
    return selectedCurrency === "CAD" ? usdPrice * exchangeRate : usdPrice;
  }, [selectedCurrency, exchangeRate]);

  // Helper function to format price with currency symbol - memoized
  const formatPrice = useCallback((usdPrice: number | null | undefined): string => {
    if (!usdPrice) {
      const symbol = selectedCurrency === "CAD" ? "C$" : "$";
      return `${symbol}0.00`;
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
