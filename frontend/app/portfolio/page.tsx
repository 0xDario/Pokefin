"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import PortfolioDashboard from "../components/Portfolio/PortfolioDashboard";
import { fetchLatestExchangeRateClient } from "../lib/exchangeRate";

export default function PortfolioPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Currency state
  const [currency, setCurrency] = useState<"USD" | "CAD">("USD");
  const [exchangeRate, setExchangeRate] = useState(1.36);

  // Fetch exchange rate
  useEffect(() => {
    let cancelled = false;

    async function fetchExchangeRate() {
      const data = await fetchLatestExchangeRateClient();
      if (!cancelled) {
        setExchangeRate(data.rate);
      }
    }
    fetchExchangeRate();

    return () => {
      cancelled = true;
    };
  }, []);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/auth/login?redirect=/portfolio");
    }
  }, [authLoading, user, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--pf-pokeball)]"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--pf-pokeball)]"></div>
          <span>Redirecting to login…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-5 md:mb-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-pokeball)]">
              Pokéfin
            </p>
            <h1 className="mt-1 text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
              My Portfolio
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Track holdings, returns, and allocation across your sealed collection.
            </p>
          </div>

          {/* Currency Toggle */}
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 self-start sm:self-auto">
            {(["USD", "CAD"] as const).map((c) => {
              const active = currency === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:ring-offset-1 ${
                    active
                      ? "bg-[var(--pf-pokeblue)] text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  {c === "USD" ? "🇺🇸 USD" : "🇨🇦 CAD"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dashboard */}
        <PortfolioDashboard currency={currency} exchangeRate={exchangeRate} />
      </div>
    </div>
  );
}
