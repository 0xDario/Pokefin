import CardRinkPromo from "../components/CardRinkPromo";
import { getCachedSetAnalytics } from "../lib/serverMarketData";

const STAT_TOOLTIPS = {
  rank: "Rank based on composite Invest Score (higher is better).",
  release: "Release date for the set.",
  days_since: "Days since release date (UTC).",
  products: "Number of products with data in the set.",
  avg30: "Average 30-day return across products.",
  avg90: "Average 90-day return across products.",
  avg365: "Average 365-day return across products.",
  median30: "Median 30-day return across products.",
  median90: "Median 90-day return across products.",
  median365: "Median 365-day return across products.",
  consistency90: "Percent of products with positive 90-day return.",
  consistency365: "Percent of products with positive 365-day return.",
  volatility90: "Std dev of daily percent changes over last 90 days.",
  maxDrawdown365: "Worst peak-to-trough drop over the last 365 days.",
  trend90: "Normalized linear-regression trend over 90-day prices.",
  trend365: "Normalized linear-regression trend over 365-day prices.",
  pricePerDay: "Average current price divided by days since release.",
  momentum: "Weighted return score using 90D, 30D, and 1Y returns.",
  investScore: "Composite z-score with penalties for volatility and drawdown.",
};

function InfoIcon({ text }: { text: string }) {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300"
      title={text}
      aria-label={text}
      role="img"
      tabIndex={0}
    >
      i
    </span>
  );
}

function StatHeader({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      <InfoIcon text={tooltip} />
    </span>
  );
}

function formatReleaseDate(releaseDate?: string | null) {
  if (!releaseDate) return "Unknown";
  return new Date(`${releaseDate}T00:00:00Z`).toLocaleDateString();
}

function formatPercent(value: number | null, signed = true) {
  if (value === null || Number.isNaN(value)) return "--";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatScore(value: number | null) {
  if (value === null || Number.isNaN(value)) return "--";
  return value.toFixed(2);
}

function formatCurrency(value: number | null) {
  if (value === null || Number.isNaN(value)) return "--";
  return `$${value.toFixed(2)}`;
}

export default async function StatsPage() {
  const stats = await getCachedSetAnalytics();
  const topRanked = stats.slice(0, 10);

  return (
    <main className="p-3 md:p-6">
      <div className="mb-4 flex flex-col gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">
            Set Analytics
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Deep set analytics based on price history and release dates.
          </p>
        </div>
      </div>

      {stats.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Set analytics are unavailable until the latest Supabase analytics
          function migration has been applied.
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                Top Sets by Composite Score
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-3 text-left"><StatHeader label="Rank" tooltip={STAT_TOOLTIPS.rank} /></th>
                    <th className="px-3 py-3 text-left">Set</th>
                    <th className="px-3 py-3 text-left"><StatHeader label="Release" tooltip={STAT_TOOLTIPS.release} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Products" tooltip={STAT_TOOLTIPS.products} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Avg 90D" tooltip={STAT_TOOLTIPS.avg90} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Avg 1Y" tooltip={STAT_TOOLTIPS.avg365} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Consistency 90D" tooltip={STAT_TOOLTIPS.consistency90} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Volatility 90D" tooltip={STAT_TOOLTIPS.volatility90} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Invest Score" tooltip={STAT_TOOLTIPS.investScore} /></th>
                  </tr>
                </thead>
                <tbody>
                  {topRanked.map((set) => (
                    <tr key={`top-${set.key}`} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-3 text-slate-400 dark:text-slate-500">{set.rank ?? "--"}</td>
                      <td className="px-3 py-3">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{set.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{set.generation} / {set.code}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{formatReleaseDate(set.releaseDate)}</td>
                      <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-300">{set.productCount}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.avg90)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.avg365)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.consistency90, false)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.volatility90, false)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">{formatScore(set.investScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-100">All Set Metrics</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Returns and trends use USD price history. Composite score is z-score weighted with drawdown and volatility penalties.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1680px] w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-3 text-left"><StatHeader label="Rank" tooltip={STAT_TOOLTIPS.rank} /></th>
                    <th className="px-3 py-3 text-left">Set</th>
                    <th className="px-3 py-3 text-left"><StatHeader label="Release" tooltip={STAT_TOOLTIPS.release} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Days Since" tooltip={STAT_TOOLTIPS.days_since} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Products" tooltip={STAT_TOOLTIPS.products} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Avg 30D" tooltip={STAT_TOOLTIPS.avg30} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Avg 90D" tooltip={STAT_TOOLTIPS.avg90} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Avg 1Y" tooltip={STAT_TOOLTIPS.avg365} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Med 30D" tooltip={STAT_TOOLTIPS.median30} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Med 90D" tooltip={STAT_TOOLTIPS.median90} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Med 1Y" tooltip={STAT_TOOLTIPS.median365} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Consistency 90D" tooltip={STAT_TOOLTIPS.consistency90} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Consistency 1Y" tooltip={STAT_TOOLTIPS.consistency365} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Volatility 90D" tooltip={STAT_TOOLTIPS.volatility90} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Max Drawdown 1Y" tooltip={STAT_TOOLTIPS.maxDrawdown365} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Trend 90D" tooltip={STAT_TOOLTIPS.trend90} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Trend 1Y" tooltip={STAT_TOOLTIPS.trend365} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Price/Day" tooltip={STAT_TOOLTIPS.pricePerDay} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Momentum" tooltip={STAT_TOOLTIPS.momentum} /></th>
                    <th className="px-3 py-3 text-right"><StatHeader label="Invest Score" tooltip={STAT_TOOLTIPS.investScore} /></th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((set) => (
                    <tr key={set.key} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-3 text-slate-400 dark:text-slate-500">{set.rank ?? "--"}</td>
                      <td className="px-3 py-3">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{set.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{set.generation} / {set.code}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{formatReleaseDate(set.releaseDate)}</td>
                      <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-300">{set.daysSinceRelease ?? "--"}</td>
                      <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-300">{set.productCount}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.avg30)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.avg90)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.avg365)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.median30)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.median90)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.median365)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.consistency90, false)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.consistency365, false)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.volatility90, false)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.maxDrawdown365, false)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.trend90)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.trend365)}</td>
                      <td className="px-3 py-3 text-right">{formatCurrency(set.pricePerDay)}</td>
                      <td className="px-3 py-3 text-right">{formatPercent(set.momentumScore)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">{formatScore(set.investScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <CardRinkPromo variant="footer" />
    </main>
  );
}
