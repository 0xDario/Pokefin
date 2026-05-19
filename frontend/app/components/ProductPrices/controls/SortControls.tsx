import { SortBy, SortDirection, ViewMode } from "../types";

interface SortControlsProps {
  sortKey: SortBy;
  sortDirection: SortDirection;
  viewMode: ViewMode;
  onSortChange: (key: SortBy, direction: SortDirection) => void;
  onViewModeChange: (mode: ViewMode) => void;
}

const SORT_KEYS: Array<{ key: SortBy; label: string }> = [
  { key: "release_date", label: "Release Date" },
  { key: "price", label: "Price" },
];

const VIEW_MODES: Array<{ key: ViewMode; label: string }> = [
  { key: "type_grouped", label: "By Type" },
  { key: "grouped", label: "By Set" },
  { key: "flat", label: "Flat" },
];

export default function SortControls({
  sortKey,
  sortDirection,
  viewMode,
  onSortChange,
  onViewModeChange,
}: SortControlsProps) {
  const handleSortClick = (key: SortBy) => {
    if (sortKey === key) {
      onSortChange(key, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSortChange(key, "desc");
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Sort */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Sort by
        </span>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          {SORT_KEYS.map(({ key, label }) => {
            const active = sortKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSortClick(key)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:ring-offset-1 ${
                  active
                    ? "bg-[var(--pf-pokeblue)] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {label}
                {active && (
                  <span className="ml-1 inline-block">
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* View */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          View
        </span>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          {VIEW_MODES.map(({ key, label }) => {
            const active = viewMode === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onViewModeChange(key)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:ring-offset-1 ${
                  active
                    ? "bg-[var(--pf-pokeblue)] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
