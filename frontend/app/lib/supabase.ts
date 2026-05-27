import { createBrowserClient } from "@supabase/ssr";

// Use placeholder values when env vars are missing so the client can
// be constructed without throwing at module load (Next.js page-data
// collection imports this on every page during builds). Runtime calls
// will fail loudly with DNS/auth errors, surfacing the real
// misconfiguration where it matters - in actual requests.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.invalid";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_KEY || "placeholder-key";

if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_KEY
) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_KEY is unset; using placeholders, runtime calls will fail."
  );
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  auth: { flowType: "pkce" },
});
