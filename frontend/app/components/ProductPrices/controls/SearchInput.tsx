interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * Search input - Mobile-first responsive with full width on mobile
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = "Search by name or variant...",
}: SearchInputProps) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full md:w-auto min-h-[44px] md:min-h-0 px-4 py-2.5 md:py-1 rounded border text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
    />
  );
}
