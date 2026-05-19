"use client";

import type { PortfolioSummary } from "../types";

interface PortfolioSummaryCardProps {
  summary: PortfolioSummary;
  currency?: "USD" | "CAD";
  exchangeRate?: number;
}

export default function PortfolioSummaryCard({
  summary,
  currency = "USD",
  exchangeRate = 1.36,
}: PortfolioSummaryCardProps) {
  const formatCurrency = (value: number) => {
    const convertedValue = currency === "CAD" ? value * exchangeRate : value;
    const symbol = currency === "CAD" ? "C$" : "$";
    return `${symbol}${convertedValue.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  const isPositive = summary.total_gain_loss >= 0;

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 md:p-6 h-full">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">
        Portfolio Summary
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Value */}
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            Total Value
          </p>
          <p className="text-xl font-bold text-slate-900">
            {formatCurrency(summary.total_current_value)}
          </p>
        </div>

        {/* Cost Basis */}
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            Cost Basis
          </p>
          <p className="text-xl font-bold text-slate-900">
            {formatCurrency(summary.total_cost_basis)}
          </p>
        </div>

        {/* Gain/Loss */}
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            Unrealized G/L
          </p>
          <p
            className={`text-xl font-bold ${
              isPositive
                ? "text-emerald-600"
                : "text-rose-600"
            }`}
          >
            {isPositive ? "+" : ""}
            {formatCurrency(summary.total_gain_loss)}
          </p>
        </div>

        {/* ROI */}
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            ROI
          </p>
          <p
            className={`text-xl font-bold ${
              isPositive
                ? "text-emerald-600"
                : "text-rose-600"
            }`}
          >
            {formatPercent(summary.total_gain_loss_percent)}
          </p>
        </div>
      </div>

      {/* Additional stats */}
      <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
        <span>
          {summary.holdings_count} holding{summary.holdings_count !== 1 ? "s" : ""}
        </span>
        <span>
          {summary.unique_products_count} unique product{summary.unique_products_count !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
