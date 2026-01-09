"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../context/AuthContext";
import {
  getOrCreatePortfolio,
  getHoldings,
  calculatePortfolioSummary,
  getPortfolioHistory,
} from "../../../lib/portfolio";
import type {
  Portfolio,
  HoldingWithProduct,
  PortfolioSummary,
  PortfolioHistoryPoint,
  PortfolioTimeframe,
} from "../types";

interface UsePortfolioDataReturn {
  portfolio: Portfolio | null;
  holdings: HoldingWithProduct[];
  summary: PortfolioSummary;
  history: PortfolioHistoryPoint[];
  loading: boolean;
  error: string | null;
  timeframe: PortfolioTimeframe;
  setTimeframe: (timeframe: PortfolioTimeframe) => void;
  refresh: () => Promise<void>;
}

const TIMEFRAME_DAYS: Record<PortfolioTimeframe, number> = {
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "ALL": 365,
};

export function usePortfolioData(): UsePortfolioDataReturn {
  const { user } = useAuth();

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [holdings, setHoldings] = useState<HoldingWithProduct[]>([]);
  const [history, setHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<PortfolioTimeframe>("1M");

  const fetchData = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get or create portfolio
      const portfolioData = await getOrCreatePortfolio(user.id);
      if (!portfolioData) {
        setError("Failed to load portfolio");
        setLoading(false);
        return;
      }

      setPortfolio(portfolioData);

      // Get holdings
      const holdingsData = await getHoldings(portfolioData.id);
      setHoldings(holdingsData);

      // Get history based on timeframe
      const days = TIMEFRAME_DAYS[timeframe];
      const historyData = await getPortfolioHistory(portfolioData.id, days);
      setHistory(historyData);
    } catch (err) {
      console.error("Error fetching portfolio data:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [user?.id, timeframe]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate summary from holdings
  const summary = calculatePortfolioSummary(holdings);

  return {
    portfolio,
    holdings,
    summary,
    history,
    loading,
    error,
    timeframe,
    setTimeframe,
    refresh: fetchData,
  };
}
