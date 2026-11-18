interface EraNumberBadgeProps {
  eraNumber?: string | null;
  className?: string;
}

/**
 * Era set number shown next to a set name, e.g. "SV3.5" for 151. Renders
 * nothing when the set has none (or the database predates migration 0026).
 */
export default function EraNumberBadge({ eraNumber, className = "" }: EraNumberBadgeProps) {
  if (!eraNumber) return null;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 text-[11px] font-mono font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 ${className}`}
      title={`Era set number ${eraNumber}`}
    >
      {eraNumber}
    </span>
  );
}
