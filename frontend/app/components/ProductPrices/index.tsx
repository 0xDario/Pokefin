"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ControlBar from "./controls/ControlBar";
import SortControls from "./controls/SortControls";
import ProductGrid from "./cards/ProductGrid";
import ProductCard from "./cards/ProductCard";
import GroupHeader from "./cards/GroupHeader";
import ProductTypeGroupHeader from "./cards/ProductTypeGroupHeader";
import CardRinkPromo from "../CardRinkPromo";
import ScrollToTop from "./shared/ScrollToTop";
import { useProductData } from "./hooks/useProductData";
import { useCurrencyConversion } from "./hooks/useCurrencyConversion";
import {
  filterProducts,
  getAvailableGenerations,
  getAvailableProductTypes,
  groupProductsBySet,
  groupProductsByType,
} from "./utils/filtering";
import { sortProducts } from "./utils/sorting";
import { ChartTimeframe, Currency, Product, SortBy, SortDirection, ViewMode } from "./types";

interface ProductPricesProps {
  initialProducts?: Product[];
  initialExchangeRate?: number;
}

// Filter defaults — values matching these are omitted from the URL to keep it clean
const DEFAULTS = {
  gen: "all",
  type: "all",
  q: "",
  sort: "release_date" as SortBy,
  dir: "desc" as SortDirection,
  view: "grouped" as ViewMode,
  chart: "3M" as ChartTimeframe,
  currency: "CAD" as Currency,
};

const VIEW_MODES: ViewMode[] = ["flat", "grouped", "type_grouped"];
const SORT_KEYS: SortBy[] = ["release_date", "price"];
const SORT_DIRS: SortDirection[] = ["asc", "desc"];
const CHART_TIMEFRAMES: ChartTimeframe[] = ["7D", "1M", "3M", "6M", "1Y"];
const CURRENCIES: Currency[] = ["USD", "CAD"];

function pickEnum<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Main ProductPrices container component
 * Mobile-first responsive design with modular architecture
 */
export default function ProductPrices({
  initialProducts = [],
  initialExchangeRate,
}: ProductPricesProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initial values read from URL once on mount. We deliberately freeze these to the
  // first render so subsequent state changes don't reset themselves from the URL.
  const initialFromUrl = useMemo(() => ({
    gen: searchParams.get("gen") ?? DEFAULTS.gen,
    type: searchParams.get("type") ?? DEFAULTS.type,
    q: searchParams.get("q") ?? DEFAULTS.q,
    sort: pickEnum(searchParams.get("sort"), SORT_KEYS, DEFAULTS.sort),
    dir: pickEnum(searchParams.get("dir"), SORT_DIRS, DEFAULTS.dir),
    view: pickEnum(searchParams.get("view"), VIEW_MODES, DEFAULTS.view),
    chart: pickEnum(searchParams.get("chart"), CHART_TIMEFRAMES, DEFAULTS.chart),
    currency: pickEnum(searchParams.get("currency"), CURRENCIES, DEFAULTS.currency),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // View state (declared first so we can pass chartTimeframe to useProductData)
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>(initialFromUrl.chart);

  const {
    products,
    priceHistory,
    loading,
    historyLoading,
    loadingProductIds,
    ensureHistoryLoaded,
  } = useProductData({ initialProducts });
  const {
    selectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    setSelectedCurrency,
    formatPrice,
  } = useCurrencyConversion(initialExchangeRate, initialFromUrl.currency);

  // Filter state
  const [selectedGeneration, setSelectedGeneration] = useState(initialFromUrl.gen);
  const [selectedProductType, setSelectedProductType] = useState(initialFromUrl.type);
  const [searchTerm, setSearchTerm] = useState(initialFromUrl.q);

  // View state
  const [sortKey, setSortKey] = useState<SortBy>(initialFromUrl.sort);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialFromUrl.dir);
  const [viewMode, setViewMode] = useState<ViewMode>(initialFromUrl.view);

  // Sync filter/view state back to the URL. Only non-default values are serialized.
  const urlSyncedRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedGeneration !== DEFAULTS.gen) params.set("gen", selectedGeneration);
    if (selectedProductType !== DEFAULTS.type) params.set("type", selectedProductType);
    if (searchTerm !== DEFAULTS.q) params.set("q", searchTerm);
    if (sortKey !== DEFAULTS.sort) params.set("sort", sortKey);
    if (sortDirection !== DEFAULTS.dir) params.set("dir", sortDirection);
    if (viewMode !== DEFAULTS.view) params.set("view", viewMode);
    if (chartTimeframe !== DEFAULTS.chart) params.set("chart", chartTimeframe);
    if (selectedCurrency !== DEFAULTS.currency) params.set("currency", selectedCurrency);

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();

    // Skip the very first effect run if URL already matches initial state — avoids a
    // no-op replace on mount that some Next.js versions still log.
    if (!urlSyncedRef.current) {
      urlSyncedRef.current = true;
      if (nextQuery === currentQuery) return;
    }
    if (nextQuery === currentQuery) return;

    const url = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    router.replace(url, { scroll: false });
  }, [
    selectedGeneration,
    selectedProductType,
    searchTerm,
    sortKey,
    sortDirection,
    viewMode,
    chartTimeframe,
    selectedCurrency,
    pathname,
    router,
    searchParams,
  ]);

  // Derived data
  const availableGenerations = useMemo(
    () => getAvailableGenerations(products),
    [products]
  );
  const availableProductTypes = useMemo(
    () => getAvailableProductTypes(products),
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
  const groupedProductsByType = useMemo(() => {
    return groupProductsByType(filteredAndSortedProducts);
  }, [filteredAndSortedProducts]);

  // Event handlers
  const handleSortChange = (key: SortBy, direction: SortDirection) => {
    setSortKey(key);
    setSortDirection(direction);
  };

  return (
    <div className="p-3 md:p-6 bg-[var(--pf-bg)] min-h-screen">
      <div className="space-y-4 md:space-y-6">
        {/* Control Bar */}
        <ControlBar
          selectedGeneration={selectedGeneration}
          availableGenerations={availableGenerations}
          onGenerationChange={setSelectedGeneration}
          selectedProductType={selectedProductType}
          availableProductTypes={availableProductTypes}
          onProductTypeChange={setSelectedProductType}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          chartTimeframe={chartTimeframe}
          onChartTimeframeChange={setChartTimeframe}
          selectedCurrency={selectedCurrency}
          exchangeRate={exchangeRate}
          exchangeRateLoading={exchangeRateLoading}
          onCurrencyChange={setSelectedCurrency}
        />

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
                  history={priceHistory[product.id]}
                  historyLoading={loadingProductIds.includes(product.id)}
                  selectedCurrency={selectedCurrency}
                  exchangeRate={exchangeRate}
                  formatPrice={formatPrice}
                  onLoadChart={ensureHistoryLoaded}
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
                      history={priceHistory[product.id]}
                      historyLoading={loadingProductIds.includes(product.id)}
                      selectedCurrency={selectedCurrency}
                      exchangeRate={exchangeRate}
                      formatPrice={formatPrice}
                      onLoadChart={ensureHistoryLoaded}
                    />
                  ))}
                </ProductGrid>
              </div>
            ))}
          </div>
        )}

        {/* Product-Type Grouped View */}
        {!loading && viewMode === "type_grouped" && (
          <div className="space-y-8">
            {Array.from(groupedProductsByType.entries()).map(
              ([productType, typeProducts]) => (
                <div key={productType}>
                  <ProductTypeGroupHeader
                    productType={productType}
                    productCount={typeProducts.length}
                    setCount={new Set(typeProducts.map((product) => product.sets?.name)).size}
                  />

                  <ProductGrid>
                    {typeProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        viewMode="grouped"
                        showSetAsPrimary
                        chartTimeframe={chartTimeframe}
                        history={priceHistory[product.id]}
                        historyLoading={loadingProductIds.includes(product.id)}
                        selectedCurrency={selectedCurrency}
                        exchangeRate={exchangeRate}
                        formatPrice={formatPrice}
                        onLoadChart={ensureHistoryLoaded}
                      />
                    ))}
                  </ProductGrid>
                </div>
              )
            )}
          </div>
        )}

        {/* CardRinkTCG Promotional Banner */}
        {!loading && <CardRinkPromo variant="banner" />}
      </div>

      {/* Scroll to Top Button */}
      <ScrollToTop />
    </div>
  );
}
