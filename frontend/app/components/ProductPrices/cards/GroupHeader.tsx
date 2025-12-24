import ExpansionTypeBadge from "../shared/ExpansionTypeBadge";

interface GroupHeaderProps {
  setName: string;
  setCode: string;
  generation: string;
  expansionType?: string;
  releaseDate: string;
}

/**
 * Group header for grouped view - Mobile-first responsive layout
 */
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
    <div className="mb-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* Left side: Name, code, generation, badge */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl md:text-2xl font-bold text-slate-900">
            {setName}
          </h2>
          <span className="text-xs md:text-sm text-slate-600">
            ({setCode}) - {generation}
          </span>
          {expansionType && <ExpansionTypeBadge type={expansionType} />}
        </div>

        {/* Right side: Release date */}
        <span className="text-xs md:text-sm text-slate-500 sm:ml-auto">
          Release: {formattedDate}
        </span>
      </div>
    </div>
  );
}
