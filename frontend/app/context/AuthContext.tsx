"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { User, AuthError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

interface UserProfile {
  id: string;
  username: string | null;
  email: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string, captchaToken?: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const FETCH_HEADERS = {
  "Content-Type": "application/json",
  "x-pokefin-request": "1",
} as const;

/**
 * Coerce an arbitrary thrown value or fetch error into the shape the
 * UI expects (`AuthError | null`). We only need a `.message` string,
 * but keep the AuthError type for backwards-compat with the auth pages.
 */
function asAuthError(message: string): AuthError {
  return { name: "AuthError", message, status: 0 } as AuthError;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") return data.error;
  } catch {
    /* ignore parse errors */
  }
  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile rows are created server-side by the on_auth_user_created
  // trigger; this client only reads them.
  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, email")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("profile_fetch_failed", { code: error.code });
      return;
    }

    if (data) setProfile(data);
  }, []);

  // Authoritative source of "am I signed in?" is the HttpOnly session
  // cookie, which the browser client cannot read. Ask the server via
  // /api/auth/me instead.
  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        setUser(null);
        setProfile(null);
        return;
      }
      const { user: fetchedUser } = (await res.json()) as { user: User | null };
      setUser(fetchedUser);
      if (fetchedUser) {
        await fetchProfile(fetchedUser.id);
      } else {
        setProfile(null);
      }
    } catch {
      setUser(null);
      setProfile(null);
    }
  }, [fetchProfile]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshSession();
      if (!cancelled) setLoading(false);
    })();

    // Refresh on window focus catches: "I returned to the tab after my
    // session expired" and "I signed out / in from another tab".
    const onFocus = () => {
      refreshSession().catch(() => {});
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshSession]);

  const signUp = async (
    email: string,
    password: string,
    username: string,
    captchaToken?: string
  ) => {
    try {
      const res = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: FETCH_HEADERS,
        credentials: "same-origin",
        body: JSON.stringify({ email, password, username, captchaToken }),
      });
      if (!res.ok) {
        const message = await readErrorMessage(res, "Sign-up failed");
        return { error: asAuthError(message) };
      }
      const { user: signedUpUser } = (await res.json()) as { user: User | null };
      setUser(signedUpUser);
      if (signedUpUser) await fetchProfile(signedUpUser.id);
      return { error: null };
    } catch {
      return { error: asAuthError("Network error") };
    }
  };

  const signIn = async (email: string, password: string, captchaToken?: string) => {
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: FETCH_HEADERS,
        credentials: "same-origin",
        body: JSON.stringify({ email, password, captchaToken }),
      });
      if (!res.ok) {
        const message = await readErrorMessage(res, "Sign-in failed");
        return { error: asAuthError(message) };
      }
      const { user: signedInUser } = (await res.json()) as { user: User | null };
      setUser(signedInUser);
      if (signedInUser) await fetchProfile(signedInUser.id);
      return { error: null };
    } catch {
      return { error: asAuthError("Network error") };
    }
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: FETCH_HEADERS,
        credentials: "same-origin",
      });
    } finally {
      setUser(null);
      setProfile(null);
    }
  };

  const resetPassword = async (email: string) => {
    // resetPasswordForEmail just sends an email - no session change,
    // safe to call from the browser client. Server-side hardening
    // would just add a hop with no security benefit.
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
  };

  const updatePassword = async (newPassword: string) => {
    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: FETCH_HEADERS,
        credentials: "same-origin",
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const message = await readErrorMessage(res, "Failed to update password");
        return { error: asAuthError(message) };
      }
      return { error: null };
    } catch {
      return { error: asAuthError("Network error") };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signUp,
        signIn,
        signOut,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
