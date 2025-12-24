interface GenerationFilterProps {
  selectedGeneration: string;
  availableGenerations: string[];
  onChange: (generation: string) => void;
}

/**
 * Generation filter dropdown - Mobile-first responsive
 */
export default function GenerationFilter({
  selectedGeneration,
  availableGenerations,
  onChange,
}: GenerationFilterProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto">
      <span className="text-sm font-semibold text-slate-800">Generation:</span>
      <select
        value={selectedGeneration}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-1 rounded border text-sm font-medium bg-white text-slate-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
      >
        <option value="all">All Generations</option>
        {availableGenerations.map((generation) => (
          <option key={generation} value={generation}>
            {generation}
          </option>
        ))}
      </select>
    </div>
  );
}
