import { Currency } from "../types";

interface CurrencySelectorProps {
  selectedCurrency: Currency;
  exchangeRate: number;
  exchangeRateLoading: boolean;
  onChange: (currency: Currency) => void;
}

export default function CurrencySelector({
  selectedCurrency,
  exchangeRate,
  exchangeRateLoading,
  onChange,
}: CurrencySelectorProps) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Currency
      </label>
      <div className="inline-flex w-full sm:w-auto items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          {(["USD", "CAD"] as const).map((currency) => {
            const active = selectedCurrency === currency;
            return (
              <button
                key={currency}
                type="button"
                onClick={() => onChange(currency)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:ring-offset-1 ${
                  active
                    ? "bg-[var(--pf-pokeblue)] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {currency === "USD" ? "🇺🇸 USD" : "🇨🇦 CAD"}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] font-medium text-slate-500 tabular-nums whitespace-nowrap">
          {exchangeRateLoading ? "rate…" : `1 USD = ${exchangeRate.toFixed(4)} CAD`}
        </span>
      </div>
    </div>
  );
}
