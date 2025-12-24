import { Currency } from "../types";

interface CurrencySelectorProps {
  selectedCurrency: Currency;
  exchangeRate: number;
  exchangeRateLoading: boolean;
  onChange: (currency: Currency) => void;
}

/**
 * Currency selector with exchange rate display - Mobile-first layout
 */
export default function CurrencySelector({
  selectedCurrency,
  exchangeRate,
  exchangeRateLoading,
  onChange,
}: CurrencySelectorProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center w-full sm:w-auto bg-white p-3 rounded-lg border border-slate-200">
      {/* Exchange Rate Display */}
      <div className="flex items-center justify-between sm:justify-start gap-2">
        <span className="text-sm font-medium text-slate-700">
          Exchange Rate:
        </span>
        {exchangeRateLoading ? (
          <span className="text-sm text-blue-600">Loading...</span>
        ) : (
          <span className="text-sm font-bold text-blue-600">
            {exchangeRate.toFixed(4)}
          </span>
        )}
      </div>

      {/* Currency Selector Dropdown */}
      <select
        value={selectedCurrency}
        onChange={(e) => onChange(e.target.value as Currency)}
        className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-1 rounded border text-sm font-medium bg-white text-slate-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="USD">🇺🇸 USD</option>
        <option value="CAD">🇨🇦 CAD</option>
      </select>
    </div>
  );
}
