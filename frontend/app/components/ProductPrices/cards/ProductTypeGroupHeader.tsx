interface ProductTypeGroupHeaderProps {
  productType: string;
  productCount: number;
  setCount: number;
}

/**
 * Group header for product-type view
 */
export default function ProductTypeGroupHeader({
  productType,
  productCount,
  setCount,
}: ProductTypeGroupHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <h2 className="text-xl md:text-2xl font-bold text-slate-900">{productType}</h2>
      <span className="text-xs md:text-sm text-slate-600">
        {productCount} {productCount === 1 ? "product" : "products"} across {setCount}{" "}
        {setCount === 1 ? "set" : "sets"}
      </span>
    </div>
  );
}
