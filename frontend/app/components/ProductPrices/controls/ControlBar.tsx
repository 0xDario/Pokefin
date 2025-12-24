import GenerationFilter from "./GenerationFilter";
import SearchInput from "./SearchInput";
import ChartTimeframeButtons from "./ChartTimeframeButtons";
import CurrencySelector from "./CurrencySelector";
import { ChartTimeframe, Currency } from "../types";

interface ControlBarProps {
  // Generation filter
  selectedGeneration: string;
  availableGenerations: string[];
  onGenerationChange: (generation: string) => void;

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
}

/**
 * Main control bar container - Mobile-first layout with vertical stacking
 */
export default function ControlBar({
  selectedGeneration,
  availableGenerations,
  onGenerationChange,
  searchTerm,
  onSearchChange,
  chartTimeframe,
  onChartTimeframeChange,
  selectedCurrency,
  exchangeRate,
  exchangeRateLoading,
  onCurrencyChange,
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

        <SearchInput value={searchTerm} onChange={onSearchChange} />

        <ChartTimeframeButtons
          selected={chartTimeframe}
          onChange={onChartTimeframeChange}
        />
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
