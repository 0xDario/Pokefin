"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";

function PokeballGlyph({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <path d="M1 16 A15 15 0 0 1 31 16 Z" fill="#dc2626" stroke="#0f172a" strokeWidth="1.5" />
      <rect x="1" y="15" width="30" height="2" fill="#0f172a" />
      <circle cx="16" cy="16" r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="1.8" fill="#0f172a" />
    </svg>
  );
}

const fieldClass =
  "w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)] transition-colors";

const labelClass =
  "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5";

export default function ResetPasswordPage() {
  const { user, loading: authLoading, updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Recovery flow: the email link points at /auth/callback?code=…&type=recovery,
  // which exchanges the PKCE code for a session (HttpOnly cookies) and
  // redirects here. We just check whether AuthContext sees a user.
  //
  // The old implicit-flow branch that parsed access_token from
  // window.location.hash and called supabase.auth.setSession() was
  // removed (audit finding session-cookie F-3) - PKCE is the only
  // supported flow now and the access token is never in JS-land.

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    setLoading(true);

    const { error } = await updatePassword(password);

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--pf-pokeball)] mx-auto" />
          <p className="mt-4 text-slate-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 text-[var(--pf-loss)] flex items-center justify-center text-2xl font-bold mb-4">
              !
            </div>
            <h1 className="text-2xl font-bold mb-3 text-slate-900">Link invalid or expired</h1>
            <p className="text-slate-600 mb-6">
              This password reset link is invalid or has expired. Please request a new one.
            </p>
            <Link
              href="/auth/forgot-password"
              className="inline-block bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-semibold py-2.5 px-6 rounded-lg transition-colors shadow-sm"
            >
              Request New Link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl mb-4">
              ✓
            </div>
            <h1 className="text-2xl font-bold mb-3 text-slate-900">Password updated</h1>
            <p className="text-slate-600 mb-6">
              Your password has been successfully updated.
            </p>
            <button
              onClick={() => router.push("/")}
              className="inline-block bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-semibold py-2.5 px-6 rounded-lg transition-colors shadow-sm"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
          <div className="flex flex-col items-center mb-6">
            <PokeballGlyph className="w-10 h-10" />
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Set new password</h1>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className={labelClass}>New Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={fieldClass}
                placeholder="••••••••"
              />
              <p className="text-xs text-slate-500 mt-1">At least 8 characters</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className={labelClass}>Confirm New Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className={fieldClass}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-semibold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {loading ? "Updating…" : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
