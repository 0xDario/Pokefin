interface ProductTypeGroupHeaderProps {
  productType: string;
  productCount: number;
  setCount: number;
}

export default function ProductTypeGroupHeader({
  productType,
  productCount,
  setCount,
}: ProductTypeGroupHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-baseline gap-2">
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--pf-pokeblue)] self-center"
          aria-hidden
        />
        <h2 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
          {productType}
        </h2>
      </div>
      <span className="text-xs text-slate-500 tabular-nums">
        <span className="font-semibold text-slate-700">{productCount}</span>{" "}
        {productCount === 1 ? "product" : "products"} across{" "}
        <span className="font-semibold text-slate-700">{setCount}</span>{" "}
        {setCount === 1 ? "set" : "sets"}
      </span>
    </div>
  );
}
