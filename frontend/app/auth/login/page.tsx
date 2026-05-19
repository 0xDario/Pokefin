"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Turnstile } from "@marsidev/react-turnstile";
import { useAuth } from "../../context/AuthContext";

function PokeballGlyph({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <path
        d="M1 16 A15 15 0 0 1 31 16 Z"
        fill="#dc2626"
        stroke="#0f172a"
        strokeWidth="1.5"
      />
      <rect x="1" y="15" width="30" height="2" fill="#0f172a" />
      <circle cx="16" cy="16" r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="1.8" fill="#0f172a" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>();
  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await signIn(email, password, captchaToken);

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8">
          <div className="flex flex-col items-center mb-6">
            <PokeballGlyph className="w-10 h-10" />
            <h1 className="mt-3 text-2xl font-bold text-slate-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to your Pokéfin account.</p>
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

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)] transition-colors"
                placeholder="••••••••"
              />
            </div>

            <Turnstile
              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
              onSuccess={(token) => setCaptchaToken(token)}
            />

            <button
              type="submit"
              disabled={loading || !captchaToken}
              className="w-full bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-semibold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center space-y-2">
            <Link
              href="/auth/forgot-password"
              className="text-sm font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)]"
            >
              Forgot your password?
            </Link>
            <p className="text-sm text-slate-500">
              Don&apos;t have an account?{" "}
              <Link
                href="/auth/signup"
                className="font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)]"
              >
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
