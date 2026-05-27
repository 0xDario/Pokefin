import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Placeholder fallbacks so module load succeeds during page-data
// collection. Runtime calls fail loudly when env vars are absent.
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
    "[serverSupabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_KEY is unset; using placeholders, runtime calls will fail."
  );
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // cookieStore.set throws in Server Components; middleware
          // refreshes session cookies in that case.
        }
      },
    },
  });
}
