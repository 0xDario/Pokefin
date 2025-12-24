import { ChartTimeframe } from "../types";

interface ChartTimeframeButtonsProps {
  selected: ChartTimeframe;
  onChange: (timeframe: ChartTimeframe) => void;
}

/**
 * Chart timeframe selector buttons - Mobile-first with larger touch targets
 */
export default function ChartTimeframeButtons({
  selected,
  onChange,
}: ChartTimeframeButtonsProps) {
  const timeframes: ChartTimeframe[] = ["7D", "30D", "90D"];

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto">
      <span className="text-sm font-semibold text-slate-800">Chart:</span>
      <div className="flex gap-2">
        {timeframes.map((timeframe) => (
          <button
            key={timeframe}
            onClick={() => onChange(timeframe)}
            className={`flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-1 rounded border text-sm font-medium transition-all active:scale-95 ${
              selected === timeframe
                ? "bg-green-600 text-white border-green-600"
                : "bg-white text-slate-700 border-slate-300 hover:bg-gray-50"
            }`}
          >
            {timeframe}
          </button>
        ))}
      </div>
    </div>
  );
}
