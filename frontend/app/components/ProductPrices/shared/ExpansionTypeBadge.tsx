interface ExpansionTypeBadgeProps {
  type?: string;
}

/**
 * Badge component for displaying expansion types with color-coded styling
 *
 * @param type - Expansion type (Main Series, Special Expansion, Subset, Starter Set)
 */
export default function ExpansionTypeBadge({ type }: ExpansionTypeBadgeProps) {
  if (!type) return null;

  const badgeColors = {
    "Main Series": "bg-blue-100 text-blue-800 border-blue-200",
    "Special Expansion": "bg-purple-100 text-purple-800 border-purple-200",
    Subset: "bg-amber-100 text-amber-800 border-amber-200",
    "Starter Set": "bg-green-100 text-green-800 border-green-200",
  };

  const color =
    badgeColors[type as keyof typeof badgeColors] ||
    "bg-gray-100 text-gray-800 border-gray-200";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}
    >
      {type}
    </span>
  );
}
