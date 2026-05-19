"use client";

import { useState } from "react";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await resetPassword(email);

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 text-[var(--pf-pokeblue)] flex items-center justify-center text-2xl mb-4">
              ✉
            </div>
            <h1 className="text-2xl font-bold mb-3 text-slate-900">Check your email</h1>
            <p className="text-slate-600 mb-6">
              If an account exists for <strong className="text-slate-900">{email}</strong>, we&apos;ve sent a
              password reset link.
            </p>
            <Link
              href="/auth/login"
              className="font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)]"
            >
              Return to Sign In
            </Link>
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
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Reset password</h1>
            <p className="mt-1 text-sm text-slate-500 text-center">
              Enter your email and we&apos;ll send you a reset link.
            </p>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)] transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-semibold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {loading ? "Sending…" : "Send Reset Link"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/auth/login"
              className="text-sm font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)]"
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
