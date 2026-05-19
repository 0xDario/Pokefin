interface AgeFilterOption {
  label: string;
  value: string;
}

interface AgeFilterProps {
  selectedAgeFilter: string;
  options: AgeFilterOption[];
  onChange: (ageFilter: string) => void;
}

export default function AgeFilter({
  selectedAgeFilter,
  options,
  onChange,
}: AgeFilterProps) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Min Age
      </label>
      <select
        value={selectedAgeFilter}
        onChange={(event) => onChange(event.target.value)}
        className="w-full sm:w-auto min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
