"use client";

import { useMemo } from "react";
import CardRinkPromo from "../components/CardRinkPromo";
import { useProductData } from "../components/ProductPrices/hooks/useProductData";
import { PriceHistoryEntry } from "../components/ProductPrices/types";

const DAY_MS = 24 * 60 * 60 * 1000;

type SetStats = {
  key: string;
  name: string;
  code: string;
  generation: string;
  releaseDate: string | null;
  daysSinceRelease: number | null;
  productCount: number;
  avg30: number | null;
  avg90: number | null;
  avg365: number | null;
  median30: number | null;
  median90: number | null;
  median365: number | null;
  consistency90: number | null;
  consistency365: number | null;
  volatility90: number | null;
  maxDrawdown365: number | null;
  trend90: number | null;
  trend365: number | null;
  pricePerDay: number | null;
  momentumScore: number | null;
  investScore: number | null;
  rank: number | null;
};

type MetricKey =
  | "avg30"
  | "avg90"
  | "avg365"
  | "consistency90"
  | "consistency365"
  | "trend90"
  | "trend365"
  | "volatility90"
  | "maxDrawdown365";

type DailyPoint = {
  dateKey: string;
  price: number;
};

const STAT_TOOLTIPS = {
  rank: "Rank based on composite Invest Score (higher is better).",
  release: "Release date for the set.",
  days_since: "Days since release date (UTC).",
  products: "Number of products in the set with data.",
  avg30:
    "Average 30-day return across products (percent change from today to nearest price <= 30 days ago).",
  avg90:
    "Average 90-day return across products (percent change from today to nearest price <= 90 days ago).",
  avg365:
    "Average 365-day return across products (percent change from today to nearest price <= 365 days ago).",
  median30: "Median 30-day return across products.",
  median90: "Median 90-day return across products.",
  median365: "Median 365-day return across products.",
  consistency90: "Percent of products with positive 90-day return.",
  consistency365: "Percent of products with positive 365-day return.",
  volatility90:
    "Std dev of daily percent changes over last 90 days (lower is steadier).",
  maxDrawdown365:
    "Worst peak-to-trough drop over last 365 days (percent).",
  trend90:
    "Slope of linear regression over 90-day prices, normalized by mean price (percent per day).",
  trend365:
    "Slope of linear regression over 365-day prices, normalized by mean price (percent per day).",
  pricePerDay:
    "Average current price divided by days since release (USD per day).",
  momentum:
    "Weighted return score: 0.5*Avg 90D + 0.3*Avg 30D + 0.2*Avg 1Y.",
  investScore:
    "Composite z-score from returns, consistency, trends, with penalties for volatility and drawdown.",
};

function InfoIcon({ text }: { text: string }) {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-500"
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

function getReleaseMs(releaseDate?: string | null) {
  if (!releaseDate) return null;
  const dateKey = releaseDate.split("T")[0].split(" ")[0];
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateRegex.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
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

function buildDailySeries(
  history: PriceHistoryEntry[] | undefined,
  maxDays?: number
): DailyPoint[] {
  if (!history || history.length === 0) return [];

  const map = new Map<string, number>();
  for (const entry of history) {
    const dateKey = new Date(entry.recorded_at).toISOString().split("T")[0];
    if (!map.has(dateKey)) {
      map.set(dateKey, entry.usd_price);
    }
  }

  const points = Array.from(map.entries())
    .map(([dateKey, price]) => ({ dateKey, price }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  if (maxDays && points.length > maxDays) {
    return points.slice(-maxDays);
  }

  return points;
}

function getReturnPercent(
  history: PriceHistoryEntry[] | undefined,
  days: number
): number | null {
  if (!history || history.length < 2) return null;

  const currentPrice = history[0].usd_price;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - days);

  const pastEntry = history.find((entry) => {
    const entryDate = new Date(entry.recorded_at);
    return entryDate <= targetDate;
  });

  if (!pastEntry) return null;

  const pastPrice = pastEntry.usd_price;
  if (pastPrice === 0) return null;

  return ((currentPrice - pastPrice) / pastPrice) * 100;
}

function getDailyChanges(points: DailyPoint[]) {
  const changes: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1].price;
    const current = points[i].price;
    if (previous === 0) continue;
    changes.push(((current - previous) / previous) * 100);
  }
  return changes;
}

function getVolatility(points: DailyPoint[]) {
  const changes = getDailyChanges(points);
  if (changes.length < 2) return null;

  const mean =
    changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const variance =
    changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    changes.length;
  return Math.sqrt(variance);
}

function getMaxDrawdown(points: DailyPoint[]) {
  if (points.length < 2) return null;
  let peak = points[0].price;
  let maxDrawdown = 0;

  for (const point of points) {
    if (point.price > peak) {
      peak = point.price;
      continue;
    }

    const drawdown = ((point.price - peak) / peak) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return Math.abs(maxDrawdown);
}

function getTrendSlope(points: DailyPoint[]) {
  if (points.length < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const n = points.length;

  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = points[i].price;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const meanPrice = sumY / n;
  if (meanPrice === 0) return null;

  return (slope / meanPrice) * 100;
}

function getMedian(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function getAverage(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getConsistency(values: number[]) {
  if (values.length === 0) return null;
  const positives = values.filter((value) => value > 0).length;
  return (positives / values.length) * 100;
}

function computeZScore(value: number | null, mean: number, std: number) {
  if (value === null || std === 0) return 0;
  return (value - mean) / std;
}

export default function StatsPage() {
  const { products, priceHistory, loading } = useProductData("1Y");

  const setStats = useMemo(() => {
    const setMap = new Map<
      string,
      {
        productCount: number;
        name: string;
        code: string;
        generation: string;
        releaseDate: string | null;
        returns30: number[];
        returns90: number[];
        returns365: number[];
        vol90: number[];
        drawdown365: number[];
        trend90: number[];
        trend365: number[];
        pricePerDay: number[];
      }
    >();

    for (const product of products) {
      const set = product.sets;
      if (!set) continue;

      const setKey = `${set.code || "unknown"}:${set.name || "Unknown Set"}`;
      if (!setMap.has(setKey)) {
        setMap.set(setKey, {
          productCount: 0,
          name: set.name || "Unknown Set",
          code: set.code || "N/A",
          generation: set.generations?.name || "Unknown",
          releaseDate: set.release_date || null,
          returns30: [],
          returns90: [],
          returns365: [],
          vol90: [],
          drawdown365: [],
          trend90: [],
          trend365: [],
          pricePerDay: [],
        });
      }

      const entry = setMap.get(setKey)!;
      entry.productCount += 1;

      const history = priceHistory[product.id];
      const ret30 = getReturnPercent(history, 30);
      const ret90 = getReturnPercent(history, 90);
      const ret365 = getReturnPercent(history, 365);

      if (ret30 !== null) entry.returns30.push(ret30);
      if (ret90 !== null) entry.returns90.push(ret90);
      if (ret365 !== null) entry.returns365.push(ret365);

      const series90 = buildDailySeries(history, 90);
      const series365 = buildDailySeries(history, 365);

      const vol90 = getVolatility(series90);
      if (vol90 !== null) entry.vol90.push(vol90);

      const drawdown365 = getMaxDrawdown(series365);
      if (drawdown365 !== null) entry.drawdown365.push(drawdown365);

      const trend90 = getTrendSlope(series90);
      if (trend90 !== null) entry.trend90.push(trend90);

      const trend365 = getTrendSlope(series365);
      if (trend365 !== null) entry.trend365.push(trend365);

      const releaseMs = getReleaseMs(set.release_date);
      if (
        releaseMs !== null &&
        typeof product.usd_price === "number" &&
        product.usd_price > 0
      ) {
        const today = new Date();
        const todayUtcMs = Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate()
        );
        const daysSinceRelease = Math.max(
          0,
          Math.floor((todayUtcMs - releaseMs) / DAY_MS)
        );
        if (daysSinceRelease > 0) {
          entry.pricePerDay.push(product.usd_price / daysSinceRelease);
        }
      }
    }

    const today = new Date();
    const todayUtcMs = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate()
    );

    const stats: SetStats[] = [];
    for (const [key, entry] of setMap.entries()) {
      const releaseMs = getReleaseMs(entry.releaseDate);
      const daysSinceRelease =
        releaseMs === null
          ? null
          : Math.max(0, Math.floor((todayUtcMs - releaseMs) / DAY_MS));

      const avg30 = getAverage(entry.returns30);
      const avg90 = getAverage(entry.returns90);
      const avg365 = getAverage(entry.returns365);

      const median30 = getMedian(entry.returns30);
      const median90 = getMedian(entry.returns90);
      const median365 = getMedian(entry.returns365);

      const consistency90 = getConsistency(entry.returns90);
      const consistency365 = getConsistency(entry.returns365);

      const volatility90 = getAverage(entry.vol90);
      const maxDrawdown365 = getAverage(entry.drawdown365);

      const trend90 = getAverage(entry.trend90);
      const trend365 = getAverage(entry.trend365);

      const pricePerDay = getAverage(entry.pricePerDay);

      const momentumScore =
        avg90 !== null || avg30 !== null || avg365 !== null
          ? (avg90 ?? 0) * 0.5 + (avg30 ?? 0) * 0.3 + (avg365 ?? 0) * 0.2
          : null;

      stats.push({
        key,
        name: entry.name,
        code: entry.code,
        generation: entry.generation,
        releaseDate: entry.releaseDate,
        daysSinceRelease,
        productCount: entry.productCount,
        avg30,
        avg90,
        avg365,
        median30,
        median90,
        median365,
        consistency90,
        consistency365,
        volatility90,
        maxDrawdown365,
        trend90,
        trend365,
        pricePerDay,
        momentumScore,
        investScore: null,
        rank: null,
      });
    }

    return stats;
  }, [products, priceHistory]);

  const statsWithScores = useMemo(() => {
    const metrics: Record<
      MetricKey,
      { mean: number; std: number }
    > = {
      avg30: { mean: 0, std: 0 },
      avg90: { mean: 0, std: 0 },
      avg365: { mean: 0, std: 0 },
      consistency90: { mean: 0, std: 0 },
      consistency365: { mean: 0, std: 0 },
      trend90: { mean: 0, std: 0 },
      trend365: { mean: 0, std: 0 },
      volatility90: { mean: 0, std: 0 },
      maxDrawdown365: { mean: 0, std: 0 },
    };

    const metricValues = (key: MetricKey) =>
      setStats
        .map((set) => set[key])
        .filter((value): value is number => value !== null);

    (Object.keys(metrics) as MetricKey[]).forEach((key) => {
      const values = metricValues(key);
      if (values.length === 0) return;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length;
      metrics[key] = { mean, std: Math.sqrt(variance) };
    });

    const scoreWeights: Record<MetricKey, number> = {
      avg30: 0.2,
      avg90: 0.4,
      avg365: 0.2,
      consistency90: 0.15,
      consistency365: 0.1,
      trend90: 0.1,
      trend365: 0.05,
      volatility90: -0.2,
      maxDrawdown365: -0.15,
    };

    const scored = setStats.map((set) => {
      let score = 0;
      (Object.keys(scoreWeights) as MetricKey[]).forEach((key) => {
        const { mean, std } = metrics[key];
        const z = computeZScore(set[key], mean, std);
        score += scoreWeights[key] * z;
      });

      return { ...set, investScore: score };
    });

    const sorted = [...scored].sort((a, b) => {
      if (a.investScore === null && b.investScore === null) return 0;
      if (a.investScore === null) return 1;
      if (b.investScore === null) return -1;
      return b.investScore - a.investScore;
    });

    return sorted.map((set, index) => ({
      ...set,
      rank: set.investScore === null ? null : index + 1,
    }));
  }, [setStats]);

  const topRanked = useMemo(() => statsWithScores.slice(0, 10), [statsWithScores]);

  return (
    <main className="p-3 md:p-6">
      <div className="mb-4 flex flex-col gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">
            Stats
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Deep set analytics based on price history and release dates.
          </p>
        </div>
      </div>

      {loading && <div className="text-slate-600">Loading stats...</div>}

      {!loading && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">
                Top Sets by Composite Score
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3 text-left">
                      <StatHeader label="Rank" tooltip={STAT_TOOLTIPS.rank} />
                    </th>
                    <th className="px-3 py-3 text-left">Set</th>
                    <th className="px-3 py-3 text-left">
                      <StatHeader
                        label="Release"
                        tooltip={STAT_TOOLTIPS.release}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Products"
                        tooltip={STAT_TOOLTIPS.products}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader label="Avg 90D" tooltip={STAT_TOOLTIPS.avg90} />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Avg 1Y"
                        tooltip={STAT_TOOLTIPS.avg365}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Consistency 90D"
                        tooltip={STAT_TOOLTIPS.consistency90}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Volatility 90D"
                        tooltip={STAT_TOOLTIPS.volatility90}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Invest Score"
                        tooltip={STAT_TOOLTIPS.investScore}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topRanked.map((set) => (
                    <tr key={`top-${set.key}`} className="border-t border-slate-100">
                      <td className="px-3 py-3 text-slate-400">
                        {set.rank ?? "--"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-sm font-semibold text-slate-900">
                          {set.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {set.generation} / {set.code}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {formatReleaseDate(set.releaseDate)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {set.productCount}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.avg90)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.avg365)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.consistency90, false)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.volatility90, false)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900">
                        {formatScore(set.investScore)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">
                All Set Metrics
              </h2>
              <p className="text-xs text-slate-500">
                Returns and trends use USD price history. Composite score is
                z-score weighted with drawdown and volatility penalties.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1680px] w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3 text-left">
                      <StatHeader label="Rank" tooltip={STAT_TOOLTIPS.rank} />
                    </th>
                    <th className="px-3 py-3 text-left">Set</th>
                    <th className="px-3 py-3 text-left">
                      <StatHeader
                        label="Release"
                        tooltip={STAT_TOOLTIPS.release}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Days Since"
                        tooltip={STAT_TOOLTIPS.days_since}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Products"
                        tooltip={STAT_TOOLTIPS.products}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader label="Avg 30D" tooltip={STAT_TOOLTIPS.avg30} />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader label="Avg 90D" tooltip={STAT_TOOLTIPS.avg90} />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader label="Avg 1Y" tooltip={STAT_TOOLTIPS.avg365} />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Med 30D"
                        tooltip={STAT_TOOLTIPS.median30}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Med 90D"
                        tooltip={STAT_TOOLTIPS.median90}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Med 1Y"
                        tooltip={STAT_TOOLTIPS.median365}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Consistency 90D"
                        tooltip={STAT_TOOLTIPS.consistency90}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Consistency 1Y"
                        tooltip={STAT_TOOLTIPS.consistency365}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Volatility 90D"
                        tooltip={STAT_TOOLTIPS.volatility90}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Max Drawdown 1Y"
                        tooltip={STAT_TOOLTIPS.maxDrawdown365}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Trend 90D"
                        tooltip={STAT_TOOLTIPS.trend90}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Trend 1Y"
                        tooltip={STAT_TOOLTIPS.trend365}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Price/Day"
                        tooltip={STAT_TOOLTIPS.pricePerDay}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Momentum"
                        tooltip={STAT_TOOLTIPS.momentum}
                      />
                    </th>
                    <th className="px-3 py-3 text-right">
                      <StatHeader
                        label="Invest Score"
                        tooltip={STAT_TOOLTIPS.investScore}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {statsWithScores.map((set) => (
                    <tr key={set.key} className="border-t border-slate-100">
                      <td className="px-3 py-3 text-slate-400">
                        {set.rank ?? "--"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-sm font-semibold text-slate-900">
                          {set.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {set.generation} / {set.code}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {formatReleaseDate(set.releaseDate)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {set.daysSinceRelease ?? "--"}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {set.productCount}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.avg30)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.avg90)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.avg365)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.median30)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.median90)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.median365)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.consistency90, false)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.consistency365, false)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.volatility90, false)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.maxDrawdown365, false)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.trend90)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.trend365)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatCurrency(set.pricePerDay)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatPercent(set.momentumScore)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900">
                        {formatScore(set.investScore)}
                      </td>
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
