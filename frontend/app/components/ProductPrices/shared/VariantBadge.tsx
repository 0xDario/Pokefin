interface VariantBadgeProps {
  variant?: string;
}

/**
 * Badge component for displaying product variants
 * Special styling for Pokemon Center exclusives
 *
 * @param variant - Product variant name
 */
export default function VariantBadge({ variant }: VariantBadgeProps) {
  if (!variant) return null;

  // Special styling for Pokemon Center exclusives
  if (variant.toLowerCase().includes("pokemon center")) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm">
        ⭐ {variant}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300">
      {variant}
    </span>
  );
}
