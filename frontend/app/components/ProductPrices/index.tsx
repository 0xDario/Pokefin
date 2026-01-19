"use client";

import { useState, useMemo } from "react";
import ControlBar from "./controls/ControlBar";
import SortControls from "./controls/SortControls";
import ProductGrid from "./cards/ProductGrid";
import ProductCard from "./cards/ProductCard";
import GroupHeader from "./cards/GroupHeader";
import CardRinkPromo from "../CardRinkPromo";
import ScrollToTop from "./shared/ScrollToTop";
import { useProductData } from "./hooks/useProductData";
import { useCurrencyConversion } from "./hooks/useCurrencyConversion";
import { filterProducts, getAvailableGenerations, groupProductsBySet } from "./utils/filtering";
import { sortProducts } from "./utils/sorting";
import { ChartTimeframe, SortBy, SortDirection, ViewMode } from "./types";

/**
 * Main ProductPrices container component
 * Mobile-first responsive design with modular architecture
 */
export default function ProductPrices() {
  // View state (declared first so we can pass chartTimeframe to useProductData)
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("1M");

  // Data fetching hooks - pass chartTimeframe for dynamic data loading
  const { products, priceHistory, loading, historyLoading } = useProductData(chartTimeframe);
  const {
    selectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    setSelectedCurrency,
    formatPrice,
  } = useCurrencyConversion();

  // Filter state
  const [selectedGeneration, setSelectedGeneration] = useState("all");
  const [selectedProductType] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  // View state
  const [sortKey, setSortKey] = useState<SortBy>("release_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");

  // Derived data
  const availableGenerations = useMemo(
    () => getAvailableGenerations(products),
    [products]
  );

  const filteredAndSortedProducts = useMemo(() => {
    const filtered = filterProducts(products, {
      selectedGeneration,
      selectedProductType,
      searchTerm,
    });
    return sortProducts(filtered, sortKey, sortDirection);
  }, [products, selectedGeneration, selectedProductType, searchTerm, sortKey, sortDirection]);

  const groupedProducts = useMemo(() => {
    return groupProductsBySet(filteredAndSortedProducts);
  }, [filteredAndSortedProducts]);

  // Event handlers
  const handleSortChange = (key: SortBy, direction: SortDirection) => {
    setSortKey(key);
    setSortDirection(direction);
  };

  return (
    <div className="p-3 md:p-6 bg-slate-100 min-h-screen">
      <div className="space-y-4 md:space-y-6">
        {/* Control Bar */}
        <ControlBar
          selectedGeneration={selectedGeneration}
          availableGenerations={availableGenerations}
          onGenerationChange={setSelectedGeneration}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          chartTimeframe={chartTimeframe}
          onChartTimeframeChange={setChartTimeframe}
          selectedCurrency={selectedCurrency}
          exchangeRate={exchangeRate}
          exchangeRateLoading={exchangeRateLoading}
          onCurrencyChange={setSelectedCurrency}
        />

        {/* CardRinkTCG Promotional Banner */}
        <CardRinkPromo variant="banner" />

        {/* Sort Controls */}
        <SortControls
          sortKey={sortKey}
          sortDirection={sortDirection}
          viewMode={viewMode}
          onSortChange={handleSortChange}
          onViewModeChange={setViewMode}
        />

        {/* Results Count */}
        <div className="text-sm text-slate-600">
          Found {filteredAndSortedProducts.length} products
        </div>

        {/* Loading State */}
        {loading && <div className="text-slate-600">Loading products...</div>}

        {/* History Loading Indicator */}
        {historyLoading && !loading && (
          <div className="fixed top-4 right-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading price history...
          </div>
        )}

        {/* Flat View */}
        {!loading && viewMode === "flat" && (
          <ProductGrid>
            {filteredAndSortedProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                viewMode="flat"
                chartTimeframe={chartTimeframe}
                priceHistory={priceHistory}
                selectedCurrency={selectedCurrency}
                exchangeRate={exchangeRate}
                formatPrice={formatPrice}
              />
            ))}
          </ProductGrid>
        )}

        {/* Grouped View */}
        {!loading && viewMode === "grouped" && (
          <div className="space-y-8">
            {Array.from(groupedProducts.entries()).map(([setName, setProducts]) => (
              <div key={setName}>
                <GroupHeader
                  setName={setName}
                  setCode={setProducts[0]?.sets?.code || "N/A"}
                  generation={setProducts[0]?.sets?.generations?.name || "Unknown"}
                  expansionType={setProducts[0]?.sets?.expansion_type}
                  releaseDate={setProducts[0]?.sets?.release_date || ""}
                />

                <ProductGrid>
                  {setProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      viewMode="grouped"
                      chartTimeframe={chartTimeframe}
                      priceHistory={priceHistory}
                      selectedCurrency={selectedCurrency}
                      exchangeRate={exchangeRate}
                      formatPrice={formatPrice}
                    />
                  ))}
                </ProductGrid>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scroll to Top Button */}
      <ScrollToTop />
    </div>
  );
}
