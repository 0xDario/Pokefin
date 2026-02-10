import { PriceHistoryEntry } from "../ProductPrices/types";

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
