"use client";

import { useEffect, useState } from "react";
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
        console.log(
          `[useCurrencyConversion] Exchange rate loaded: ${result.rate} (date: ${result.date})`
        );
      } catch (error) {
        console.error("[useCurrencyConversion] Failed to load exchange rate:", error);
      } finally {
        setExchangeRateLoading(false);
      }
    }
    loadExchangeRate();
  }, []);

  // Helper function to convert prices based on selected currency
  const convertPrice = (usdPrice: number | null | undefined): number => {
    if (!usdPrice) return 0;
    return selectedCurrency === "CAD" ? usdPrice * exchangeRate : usdPrice;
  };

  // Helper function to format price with currency symbol
  const formatPrice = (usdPrice: number | null | undefined): string => {
    const price = convertPrice(usdPrice);
    const symbol = selectedCurrency === "CAD" ? "C$" : "$";
    return `${symbol}${price.toFixed(2)}`;
  };

  return {
    selectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    setSelectedCurrency,
    convertPrice,
    formatPrice,
  };
}
