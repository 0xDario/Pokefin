"use client";

import { useState, useMemo } from "react";
import { calculateHoldingPerformance } from "../../../lib/portfolio";
import HoldingCard from "./HoldingCard";
import type { HoldingWithProduct, HoldingSortBy, HoldingSortDirection } from "../types";

interface HoldingsTableProps {
  holdings: HoldingWithProduct[];
  currency?: "USD" | "CAD";
  exchangeRate?: number;
  onEdit: (holding: HoldingWithProduct) => void;
  onDelete: (holdingId: number) => void;
}

export default function HoldingsTable({
  holdings,
  currency = "USD",
  exchangeRate = 1.36,
  onEdit,
  onDelete,
}: HoldingsTableProps) {
  const [sortBy, setSortBy] = useState<HoldingSortBy>("purchase_date");
  const [sortDirection, setSortDirection] = useState<HoldingSortDirection>("desc");

  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      const perfA = calculateHoldingPerformance(a);
      const perfB = calculateHoldingPerformance(b);

      let comparison = 0;

      switch (sortBy) {
        case "name":
          const nameA = a.products?.sets?.name || "";
          const nameB = b.products?.sets?.name || "";
          comparison = nameA.localeCompare(nameB);
          break;
        case "value":
          comparison = perfA.current_value - perfB.current_value;
          break;
        case "gain_loss":
          comparison = perfA.gain_loss - perfB.gain_loss;
          break;
        case "gain_loss_percent":
          comparison = perfA.gain_loss_percent - perfB.gain_loss_percent;
          break;
        case "purchase_date":
          comparison = a.purchase_date.localeCompare(b.purchase_date);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [holdings, sortBy, sortDirection]);

  const handleSort = (newSortBy: HoldingSortBy) => {
    if (sortBy === newSortBy) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(newSortBy);
      setSortDirection("desc");
    }
  };

  const SortButton = ({ field, label }: { field: HoldingSortBy; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={`text-xs font-medium px-2 py-1 rounded ${
        sortBy === field
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
      }`}
    >
      {label}
      {sortBy === field && (
        <span className="ml-1">
          {sortDirection === "asc" ? "↑" : "↓"}
        </span>
      )}
    </button>
  );

  if (holdings.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
        <svg
          className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
          />
        </svg>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No holdings yet
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          Add your first holding to start tracking your portfolio.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Holdings ({holdings.length})
          </h2>
          <div className="flex flex-wrap gap-1">
            <SortButton field="purchase_date" label="Date" />
            <SortButton field="name" label="Name" />
            <SortButton field="value" label="Value" />
            <SortButton field="gain_loss" label="G/L" />
            <SortButton field="gain_loss_percent" label="G/L %" />
          </div>
        </div>
      </div>

      {/* Holdings List */}
      <div className="p-4 grid gap-4 md:grid-cols-2">
        {sortedHoldings.map((holding) => (
          <HoldingCard
            key={holding.id}
            holding={holding}
            currency={currency}
            exchangeRate={exchangeRate}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
