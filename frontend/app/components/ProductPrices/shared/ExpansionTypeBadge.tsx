interface ExpansionTypeBadgeProps {
  type?: string;
}

const BADGE_COLORS: Record<string, string> = {
  "Main Series": "bg-blue-50 text-blue-700 ring-blue-200",
  "Special Expansion": "bg-amber-50 text-amber-800 ring-amber-200",
  Subset: "bg-violet-50 text-violet-700 ring-violet-200",
  "Starter Set": "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export default function ExpansionTypeBadge({ type }: ExpansionTypeBadgeProps) {
  if (!type) return null;

  const color = BADGE_COLORS[type] || "bg-slate-100 text-slate-700 ring-slate-200";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${color}`}
    >
      {type}
    </span>
  );
}
