interface VariantBadgeProps {
  variant?: string;
}

export default function VariantBadge({ variant }: VariantBadgeProps) {
  if (!variant) return null;

  // Pokemon Center exclusives get a Pikachu-yellow accent.
  if (variant.toLowerCase().includes("pokemon center")) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-[var(--pf-pokeyellow)] text-slate-900 ring-1 ring-yellow-500/40 shadow-sm">
        <span aria-hidden>★</span>
        {variant}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200">
      {variant}
    </span>
  );
}
