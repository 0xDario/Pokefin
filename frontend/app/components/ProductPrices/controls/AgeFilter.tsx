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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto">
      <span className="text-sm font-semibold text-slate-800">Min Age:</span>
      <select
        value={selectedAgeFilter}
        onChange={(event) => onChange(event.target.value)}
        className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-1 rounded border text-sm font-medium bg-white text-slate-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
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
