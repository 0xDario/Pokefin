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
  // Data fetching hooks
  const { products, priceHistory, loading } = useProductData();
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
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("1M");
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
