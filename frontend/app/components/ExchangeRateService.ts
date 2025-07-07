import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetches the latest USD→CAD exchange rate from Supabase.
 */
export async function fetchUSDToCADRate() {
  try {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("usd_to_cad, recorded_at")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;
    if (!data) throw new Error("No exchange rate data found.");

    return {
      rate: data.usd_to_cad,
      date: data.recorded_at,
    };
  } catch (err) {
    console.error("[ExchangeRateService] Failed to fetch exchange rate:", err);
    // fallback value to avoid breaking the UI
    return {
      rate: 1.3600,
      date: null,
    };
  }
}
