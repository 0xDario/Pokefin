interface ProductTypeFilterProps {
  selectedProductType: string;
  availableProductTypes: string[];
  onChange: (productType: string) => void;
}

/**
 * Product type filter dropdown - Mobile-first responsive
 */
export default function ProductTypeFilter({
  selectedProductType,
  availableProductTypes,
  onChange,
}: ProductTypeFilterProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto">
      <span className="text-sm font-semibold text-slate-800">Product Type:</span>
      <select
        value={selectedProductType}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2.5 sm:py-1 rounded border text-sm font-medium bg-white text-slate-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
      >
        <option value="all">All Product Types</option>
        {availableProductTypes.map((productType) => (
          <option key={productType} value={productType}>
            {productType}
          </option>
        ))}
      </select>
    </div>
  );
}
