import { SortBy, SortDirection, ViewMode } from "../types";

interface SortControlsProps {
  sortKey: SortBy;
  sortDirection: SortDirection;
  viewMode: ViewMode;
  onSortChange: (key: SortBy, direction: SortDirection) => void;
  onViewModeChange: (mode: ViewMode) => void;
}

/**
 * Sort and view mode controls - Mobile-first layout
 */
export default function SortControls({
  sortKey,
  sortDirection,
  viewMode,
  onSortChange,
  onViewModeChange,
}: SortControlsProps) {
  const sortKeys: SortBy[] = ["release_date", "price"];

  const handleSortClick = (key: SortBy) => {
    if (sortKey === key) {
      // Toggle direction if same key
      onSortChange(key, sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Set new key with default direction
      onSortChange(key, key === "price" ? "desc" : "desc");
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Sort Controls */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-sm font-semibold text-slate-800">Sort by:</span>
        <div className="flex gap-2">
          {sortKeys.map((key) => (
            <button
              key={key}
              onClick={() => handleSortClick(key)}
              className={`flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-1 rounded border text-sm font-medium transition-all active:scale-95 ${
                sortKey === key
                  ? "bg-purple-600 text-white border-purple-600"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-gray-50"
              }`}
            >
              {key === "release_date" ? "Release Date" : "Price"}
              {sortKey === key && (
                <span className="ml-1">
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">View:</span>
        <button
          onClick={() =>
            onViewModeChange(viewMode === "flat" ? "grouped" : "flat")
          }
          className="min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-1 rounded border text-sm font-medium bg-white text-slate-700 border-slate-300 hover:bg-gray-50 transition-all active:scale-95"
        >
          {viewMode === "flat" ? "📋 Flat" : "📁 Grouped"}
        </button>
      </div>
    </div>
  );
}
