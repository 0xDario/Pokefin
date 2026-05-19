import ExpansionTypeBadge from "../shared/ExpansionTypeBadge";

interface GroupHeaderProps {
  setName: string;
  setCode: string;
  generation: string;
  expansionType?: string;
  releaseDate: string;
}

export default function GroupHeader({
  setName,
  setCode,
  generation,
  expansionType,
  releaseDate,
}: GroupHeaderProps) {
  const formattedDate = releaseDate
    ? new Date(releaseDate + "T00:00:00Z").toLocaleDateString()
    : "Unknown";

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--pf-pokeball)] self-center" aria-hidden />
          <h2 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
            {setName}
          </h2>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {generation}
        </span>
        <span className="text-[11px] font-mono text-slate-400">{setCode}</span>
        {expansionType && <ExpansionTypeBadge type={expansionType} />}
      </div>

      <span className="text-xs text-slate-500">
        Released <span className="font-semibold text-slate-700">{formattedDate}</span>
      </span>
    </div>
  );
}
