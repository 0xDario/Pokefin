import GenerationFilter from "./GenerationFilter";
import ProductTypeFilter from "./ProductTypeFilter";
import SearchInput from "./SearchInput";
import ChartTimeframeButtons from "./ChartTimeframeButtons";
import CurrencySelector from "./CurrencySelector";
import { ChartTimeframe, Currency } from "../types";

interface ControlBarProps {
  // Generation filter
  selectedGeneration: string;
  availableGenerations: string[];
  onGenerationChange: (generation: string) => void;

  // Product type filter
  selectedProductType?: string;
  availableProductTypes?: string[];
  onProductTypeChange?: (productType: string) => void;

  // Search
  searchTerm: string;
  onSearchChange: (term: string) => void;

  // Chart timeframe
  chartTimeframe: ChartTimeframe;
  onChartTimeframeChange: (timeframe: ChartTimeframe) => void;

  // Currency
  selectedCurrency: Currency;
  exchangeRate: number;
  exchangeRateLoading: boolean;
  onCurrencyChange: (currency: Currency) => void;

  showChartTimeframe?: boolean;
  showProductTypeFilter?: boolean;
}

/**
 * Main control bar container - Mobile-first layout with vertical stacking
 */
export default function ControlBar({
  selectedGeneration,
  availableGenerations,
  onGenerationChange,
  selectedProductType = "all",
  availableProductTypes = [],
  onProductTypeChange = () => {},
  searchTerm,
  onSearchChange,
  chartTimeframe,
  onChartTimeframeChange,
  selectedCurrency,
  exchangeRate,
  exchangeRateLoading,
  onCurrencyChange,
  showChartTimeframe = true,
  showProductTypeFilter = true,
}: ControlBarProps) {
  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-4 mb-6">
      {/* Primary Controls - Left Side */}
      <div className="flex flex-col gap-3 md:flex-row md:flex-1 md:gap-4">
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

        {showChartTimeframe && (
          <ChartTimeframeButtons
            selected={chartTimeframe}
            onChange={onChartTimeframeChange}
          />
        )}
      </div>

      {/* Secondary Controls - Right Side */}
      <div className="flex flex-col gap-3 md:flex-row md:gap-4 md:ml-auto">
        <CurrencySelector
          selectedCurrency={selectedCurrency}
          exchangeRate={exchangeRate}
          exchangeRateLoading={exchangeRateLoading}
          onChange={onCurrencyChange}
        />
      </div>
    </div>
  );
}
