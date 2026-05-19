"use client";

import { useState } from "react";
import GenerationFilter from "./GenerationFilter";
import ProductTypeFilter from "./ProductTypeFilter";
import AgeFilter from "./AgeFilter";
import SearchInput from "./SearchInput";
import ChartTimeframeButtons from "./ChartTimeframeButtons";
import CurrencySelector from "./CurrencySelector";
import { ChartTimeframe, Currency } from "../types";

interface AgeFilterOption {
  label: string;
  value: string;
}

interface ControlBarProps {
  selectedGeneration: string;
  availableGenerations: string[];
  onGenerationChange: (generation: string) => void;
  selectedProductType?: string;
  availableProductTypes?: string[];
  onProductTypeChange?: (productType: string) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  selectedAgeFilter?: string;
  ageFilterOptions?: AgeFilterOption[];
  onAgeFilterChange?: (ageFilter: string) => void;
  chartTimeframe: ChartTimeframe;
  onChartTimeframeChange: (timeframe: ChartTimeframe) => void;
  selectedCurrency: Currency;
  exchangeRate: number;
  exchangeRateLoading: boolean;
  onCurrencyChange: (currency: Currency) => void;
  showChartTimeframe?: boolean;
  showProductTypeFilter?: boolean;
}

function FunnelIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h14l-5.5 7v5l-3 1.5v-6.5L3 4Z" />
    </svg>
  );
}

function ChevronIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 7 5 5 5-5" />
    </svg>
  );
}

export default function ControlBar({
  selectedGeneration,
  availableGenerations,
  onGenerationChange,
  selectedProductType = "all",
  availableProductTypes = [],
  onProductTypeChange = () => {},
  searchTerm,
  onSearchChange,
  selectedAgeFilter,
  ageFilterOptions,
  onAgeFilterChange,
  chartTimeframe,
  onChartTimeframeChange,
  selectedCurrency,
  exchangeRate,
  exchangeRateLoading,
  onCurrencyChange,
  showChartTimeframe = true,
  showProductTypeFilter = true,
}: ControlBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Count only genuine filters (not view prefs like timeframe/currency).
  const activeFilterCount = [
    selectedGeneration !== "all",
    showProductTypeFilter && selectedProductType !== "all",
    searchTerm.trim().length > 0,
    selectedAgeFilter !== undefined && selectedAgeFilter !== "all",
  ].filter(Boolean).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
      {/* Mobile trigger bar */}
      <button
        type="button"
        onClick={() => setDrawerOpen((open) => !open)}
        aria-expanded={drawerOpen}
        className="md:hidden flex w-full items-center justify-between gap-2 text-sm font-semibold text-slate-700"
      >
        <span className="flex items-center gap-2">
          <FunnelIcon />
          Filters
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--pf-pokeball)] text-white text-xs font-bold tabular-nums">
              {activeFilterCount}
            </span>
          )}
        </span>
        <ChevronIcon
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
            drawerOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Filter panel — collapsible on mobile, always open on md+ */}
      <div
        className={`transition-all duration-200 md:max-h-none md:opacity-100 md:overflow-visible md:mt-0 ${
          drawerOpen
            ? "max-h-[1000px] opacity-100 overflow-hidden mt-3"
            : "max-h-0 opacity-0 overflow-hidden mt-0"
        }`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-x-5 md:gap-y-3">
          <GenerationFilter
            selectedGeneration={selectedGeneration}
            availableGenerations={availableGenerations}
            onChange={onGenerationChange}
          />

          {showProductTypeFilter && (
            <ProductTypeFilter
              selectedProductType={selectedProductType}
              availableProductTypes={availableProductTypes}
              onChange={onProductTypeChange}
            />
          )}

          <SearchInput value={searchTerm} onChange={onSearchChange} />

          {selectedAgeFilter !== undefined &&
            ageFilterOptions &&
            onAgeFilterChange && (
              <AgeFilter
                selectedAgeFilter={selectedAgeFilter}
                options={ageFilterOptions}
                onChange={onAgeFilterChange}
              />
            )}

          {showChartTimeframe && (
            <ChartTimeframeButtons
              selected={chartTimeframe}
              onChange={onChartTimeframeChange}
            />
          )}

          <div className="md:ml-auto">
            <CurrencySelector
              selectedCurrency={selectedCurrency}
              exchangeRate={exchangeRate}
              exchangeRateLoading={exchangeRateLoading}
              onChange={onCurrencyChange}
            />
          </div>
        </div>

        {/* Done button — mobile only */}
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="md:hidden mt-3 w-full rounded-lg bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)] text-white py-2 text-sm font-semibold transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
