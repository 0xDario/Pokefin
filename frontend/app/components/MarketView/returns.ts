import { PriceHistoryEntry } from "../ProductPrices/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function toDailyPoints(
  history: PriceHistoryEntry[] | undefined,
  convertPrice: (usdPrice: number) => number
) {
  if (!history || history.length === 0) return [];

  const byDay = new Map<string, number>();
  for (const entry of history) {
    const dayKey = entry.recorded_at.slice(0, 10);
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, convertPrice(entry.usd_price));
    }
  }

  return Array.from(byDay.entries())
    .map(([dateKey, price]) => ({ dateKey, price }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function getReturnPercent(
  history: PriceHistoryEntry[] | undefined,
  days: number,
  convertPrice: (usdPrice: number) => number,
  referenceDate: Date = new Date()
): number | null {
  if (!history || history.length < 2) return null;

  // History is normalized to oldest -> newest in useProductData.
  const latestEntry = history[history.length - 1];
  const latestEntryDate = new Date(latestEntry.recorded_at);

  const targetDate = new Date(referenceDate);
  targetDate.setDate(targetDate.getDate() - days);

  // If the latest point is already older than the target window,
  // there is not enough recent data to compute that return.
  if (latestEntryDate <= targetDate) return null;

  let pastEntry: PriceHistoryEntry | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const entryDate = new Date(history[i].recorded_at);
    if (entryDate <= targetDate) {
      pastEntry = history[i];
      break;
    }
  }

  if (!pastEntry) return null;

  const currentPrice = convertPrice(latestEntry.usd_price);
  const pastPrice = convertPrice(pastEntry.usd_price);
  if (pastPrice === 0) return null;

  return ((currentPrice - pastPrice) / pastPrice) * 100;
}

export function getCagrPercent(
  history: PriceHistoryEntry[] | undefined,
  convertPrice: (usdPrice: number) => number
): number | null {
  if (!history || history.length < 2) return null;

  const first = history[0];
  const last = history[history.length - 1];

  const startPrice = convertPrice(first.usd_price);
  const endPrice = convertPrice(last.usd_price);
  if (startPrice <= 0 || endPrice <= 0) return null;

  const startMs = new Date(first.recorded_at).getTime();
  const endMs = new Date(last.recorded_at).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  const years = (endMs - startMs) / (365 * DAY_MS);
  if (years <= 0) return null;

  return (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100;
}

export function getMaxDrawdownPercent(
  history: PriceHistoryEntry[] | undefined,
  convertPrice: (usdPrice: number) => number
): number | null {
  const points = toDailyPoints(history, convertPrice);
  if (points.length < 2) return null;

  let peak = points[0].price;
  let maxDrawdown = 0;

  for (const point of points) {
    if (point.price > peak) {
      peak = point.price;
      continue;
    }

    if (peak <= 0) continue;
    const drawdown = ((point.price - peak) / peak) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return Math.abs(maxDrawdown);
}

export function getVolatilityPercent(
  history: PriceHistoryEntry[] | undefined,
  convertPrice: (usdPrice: number) => number,
  lookbackDays = 30
): number | null {
  const points = toDailyPoints(history, convertPrice);
  if (points.length < 3) return null;

  const recentPoints = points.slice(-Math.max(lookbackDays, 3));
  const dailyChanges: number[] = [];

  for (let i = 1; i < recentPoints.length; i += 1) {
    const prev = recentPoints[i - 1].price;
    const curr = recentPoints[i].price;
    if (prev <= 0) continue;
    dailyChanges.push(((curr - prev) / prev) * 100);
  }

  if (dailyChanges.length < 2) return null;

  const mean =
    dailyChanges.reduce((sum, change) => sum + change, 0) / dailyChanges.length;
  const variance =
    dailyChanges.reduce((sum, change) => sum + (change - mean) ** 2, 0) /
    dailyChanges.length;
  const dailyVolatility = Math.sqrt(variance);

  return dailyVolatility * Math.sqrt(365);
}
