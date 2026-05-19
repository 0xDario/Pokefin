import { ChartTimeframe } from "../types";

interface ChartTimeframeButtonsProps {
  selected: ChartTimeframe;
  onChange: (timeframe: ChartTimeframe) => void;
}

const TIMEFRAMES: ChartTimeframe[] = ["7D", "1M", "3M", "6M", "1Y"];

export default function ChartTimeframeButtons({
  selected,
  onChange,
}: ChartTimeframeButtonsProps) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Chart
      </label>
      <div
        role="radiogroup"
        aria-label="Chart timeframe"
        className="inline-flex w-full sm:w-auto rounded-lg border border-slate-300 bg-white p-0.5"
      >
        {TIMEFRAMES.map((timeframe) => {
          const active = selected === timeframe;
          return (
            <button
              key={timeframe}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(timeframe)}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-md text-xs font-semibold tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:ring-offset-1 ${
                active
                  ? "bg-[var(--pf-pokeblue)] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              {timeframe}
            </button>
          );
        })}
      </div>
    </div>
  );
}
