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
  return (
    <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-4 mb-6">
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
      </div>

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
