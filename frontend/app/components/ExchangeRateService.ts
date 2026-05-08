import { fetchLatestExchangeRateClient } from "../lib/exchangeRate";

/**
 * Fetches the latest USD->CAD exchange rate from Supabase.
 */
export async function fetchUSDToCADRate() {
  return fetchLatestExchangeRateClient();
}
