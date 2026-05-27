import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hardenCookieOptions } from "./cookieOptions";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.invalid";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_KEY || "placeholder-key";

/**
 * Build a Supabase server client for a Next.js Route Handler. All
 * `setAll` writes are hardened with HttpOnly + Secure (see
 * cookieOptions.ts), so any session cookie that originates here is
 * never JS-readable.
 */
export async function createRouteSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: CookieOptions;
        }>
      ) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, hardenCookieOptions(options));
        });
      },
    },
  });
}
