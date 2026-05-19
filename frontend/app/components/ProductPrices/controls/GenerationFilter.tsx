interface GenerationFilterProps {
  selectedGeneration: string;
  availableGenerations: string[];
  onChange: (generation: string) => void;
}

export default function GenerationFilter({
  selectedGeneration,
  availableGenerations,
  onChange,
}: GenerationFilterProps) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Generation
      </label>
      <select
        value={selectedGeneration}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-auto min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)]"
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
